import {
  Controller,
  Post,
  Body,
  Res,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Get,
  UseGuards,
  Req,
  Param,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import type { Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { OidcService } from './oidc.service';
import { AuthProvidersService } from './auth-providers.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuditService, AuditCategory } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { LoginOtpDto, SudoDto, VerifyOtpDto } from './dto/otp.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  UpsertAuthProviderDto,
  validateProviderConfig,
} from './dto/auth-provider.dto';
import {
  JWT_COOKIE_MAX_AGE_MS,
  JWT_REFRESH_COOKIE_MAX_AGE_MS,
  THROTTLE_AUTH_LIMIT,
  THROTTLE_AUTH_TTL,
} from '../common/constants/security.constants';
import * as crypto from 'node:crypto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('auth')
export class AuthController {
  private readonly isProduction = process.env['NODE_ENV'] === 'production';

  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
    private oidcService: OidcService,
    private authProvidersService: AuthProvidersService,
    private auditService: AuditService,
    private tokenBlacklistService: TokenBlacklistService,
    private refreshTokenService: RefreshTokenService,
    private prisma: PrismaService,
  ) {}

  /**
   * SECURITY: cookie hardening must be driven by the actual transport, not
   * by NODE_ENV. We mark Secure whenever the request reaches us over HTTPS
   * (either directly or via X-Forwarded-Proto from nginx, which we trust
   * thanks to `app.set('trust proxy', 1)`). We only allow the unsecured
   * fallback when explicitly running outside production over plain HTTP
   * for local dev — never silently for HTTPS clients.
   */
  private cookieBaseFor(req: any) {
    const isSecure =
      !!req?.secure ||
      (typeof req?.protocol === 'string' && req.protocol === 'https') ||
      req?.headers?.['x-forwarded-proto'] === 'https';
    return {
      httpOnly: true,
      secure: isSecure || this.isProduction,
      sameSite: 'strict' as const,
    };
  }

  private setAuthCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
    req?: any,
  ) {
    const base = this.cookieBaseFor(req);
    response.cookie('jwt', accessToken, {
      ...base,
      maxAge: JWT_COOKIE_MAX_AGE_MS,
    });
    response.cookie('refresh_token', refreshToken, {
      ...base,
      maxAge: JWT_REFRESH_COOKIE_MAX_AGE_MS,
      path: '/api/auth/refresh',
    });
  }

  private setNoCacheHeaders(response: Response) {
    response.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    );
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
  }

  @Get('providers')
  @SkipThrottle()
  async getProviders() {
    // SECURITY: this endpoint is anonymous (login screen needs to know which
    // providers are enabled). NEVER return decrypted credentials here. Only
    // a minimal projection — login UI only needs id/name/type/enabled and a
    // public OIDC redirect target when applicable.
    const providers = await this.authProvidersService.findAllEnabled();
    return providers.map((p: any) => {
      const out: Record<string, unknown> = {
        id: p.id,
        name: p.name,
        type: p.type,
        enabled: p.enabled,
      };
      // For OIDC, the login UI may need to render a "Sign in with …" button
      // pointing to /auth/oidc/login — issuer hostname is the only safe hint.
      if (p.type === 'OIDC' && p.config?.issuer) {
        try {
          out['issuerHost'] = new URL(p.config.issuer).hostname;
        } catch {
          /* ignore malformed issuer */
        }
      }
      return out;
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('admin/providers')
  async getAllProviders() {
    const providers = await this.prisma.authProvider.findMany();
    return Promise.all(
      providers.map(async (p) => ({
        ...p,
        config: this.authProvidersService.decryptConfig(p.config, p.id),
      })),
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('providers/:id')
  async updateProvider(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpsertAuthProviderDto,
  ) {
    const validatedConfig = await validateProviderConfig(
      body.type,
      body.config ?? {},
    ).catch((err) => {
      throw new BadRequestException({
        message: err.message,
        errors: (err as any).details ?? [],
      });
    });

    const updatePayload: { config: typeof validatedConfig; enabled?: boolean } = {
      config: validatedConfig,
    };
    if (body.enabled !== undefined) updatePayload.enabled = body.enabled;
    const result = await this.authProvidersService.update(id, updatePayload);

    await this.auditService.logAction(
      null as any,
      'AUTH: PROVIDER_UPDATED',
      { providerId: id, type: result.type, enabled: result.enabled },
      'ADMIN' as any,
      '',
      AuditCategory.AUTH,
    );

    return {
      ...result,
      config: this.authProvidersService.decryptConfig(result.config, result.id),
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('providers/upsert')
  async upsertProvider(@Body() body: UpsertAuthProviderDto) {
    // Validate the inner config against the per-type schema. Without this,
    // arbitrary objects could be persisted (CVE: stored config injection).
    const validatedConfig = await validateProviderConfig(
      body.type,
      body.config ?? {},
    ).catch((err) => {
      throw new BadRequestException({
        message: err.message,
        errors: (err as any).details ?? [],
      });
    });

    const existing = await this.prisma.authProvider.findFirst({
      where: { type: body.type },
    });

    let result;
    if (existing) {
      const upsertPayload: { config: typeof validatedConfig; enabled?: boolean } = {
        config: validatedConfig,
      };
      if (body.enabled !== undefined) upsertPayload.enabled = body.enabled;
      result = await this.authProvidersService.update(existing.id, upsertPayload);
    } else {
      result = await this.authProvidersService.create({
        name: body.type === 'LDAP' ? 'LDAP Provider' : 'OIDC Provider',
        type: body.type,
        config: validatedConfig,
      });
      if (body.enabled !== undefined) {
        await this.authProvidersService.update(result.id, {
          enabled: body.enabled,
        });
      }
    }

    return {
      ...result,
      config: this.authProvidersService.decryptConfig(result.config, result.id),
    };
  }

  @Post('login')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: any,
  ) {
    const user = await this.authService.validateUser(
      loginDto.identifier,
      loginDto.password,
      loginDto.authMethod,
    );
    if (!user) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (user.isOtpEnabled) {
      const tempToken = await this.jwtService.signAsync(
        { sub: user.id, isPartial: true },
        { expiresIn: '5m' },
      );
      return { requiresOtp: true, tempToken };
    }

    const { access_token } = await this.authService.login(user);
    const refreshToken = await this.refreshTokenService.create(user.id);

    await this.auditService.logAction(
      user.id,
      'AUTH: LOGIN_SUCCESS',
      { userId: user.id },
      user.authMethod,
      request.ip,
      AuditCategory.AUTH,
    );

    this.setNoCacheHeaders(response);
    this.setAuthCookies(response, access_token, refreshToken, request);

    return {
      message: 'Login successful',
      requiresPasswordChange: user.requiresPasswordChange || false,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        authMethod: user.authMethod,
        isOtpEnabled: !!user.isOtpEnabled,
        isAdminMode: false,
      },
    };
  }

  @Post('login-otp')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async loginOtp(
    @Body() body: LoginOtpDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: any,
  ) {
    try {
      const payload = await this.jwtService.verifyAsync(body.tempToken);
      if (!payload.isPartial) throw new UnauthorizedException();

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException();

      const isValid = await this.authService.verifyOtp(user.id, body.code);
      if (!isValid) throw new BadRequestException('Code OTP invalide');

      const { access_token } = await this.authService.login(user, false);
      const refreshToken = await this.refreshTokenService.create(user.id);

      await this.auditService.logAction(
        user.id,
        'AUTH: LOGIN_OTP_SUCCESS',
        { userId: user.id },
        user.authMethod,
        request.ip,
        AuditCategory.AUTH,
      );

      this.setAuthCookies(response, access_token, refreshToken, request);

      return {
        message: 'Login successful',
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          authMethod: user.authMethod,
          isOtpEnabled: true,
          isAdminMode: false,
        },
      };
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Session OTP expirée ou invalide');
    }
  }

  @Post('refresh')
  @Throttle({ auth: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Req() request: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.cookies?.refresh_token;
    if (!token) throw new UnauthorizedException('Refresh token manquant');

    const { userId, newToken } = await this.refreshTokenService.rotate(token);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const { access_token } = await this.authService.login(user);

    this.setNoCacheHeaders(response);
    this.setAuthCookies(response, access_token, newToken, request);

    return { message: 'Token refreshed' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('sudo')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async sudo(
    @Req() req: any,
    @Body() body: SudoDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user || user.role !== 'ADMIN') throw new UnauthorizedException('Accès refusé');

    // SECURITY: sudo requires fresh proof of identity. Order:
    //   1. If OTP enabled → require valid OTP.
    //   2. Else if LOCAL account → require current password (step-up).
    //   3. Else (LDAP/OIDC without OTP) → refuse: enable OTP first.
    if (user.isOtpEnabled) {
      if (!body.code) throw new BadRequestException('Code OTP requis');
      const isValid = await this.authService.verifyOtp(user.id, body.code);
      if (!isValid) throw new BadRequestException('Code OTP invalide');
    } else if (user.authMethod === 'LOCAL') {
      if (!body.password)
        throw new BadRequestException(
          'Mot de passe requis pour entrer en mode admin (configurez l\'OTP pour éviter cette étape)',
        );
      if (!user.passwordHash)
        throw new UnauthorizedException('Compte sans mot de passe local');
      const ok = await argon2.verify(user.passwordHash, body.password);
      if (!ok) throw new BadRequestException('Mot de passe incorrect');
    } else {
      throw new ForbiddenException(
        'Activez l\'OTP avant d\'utiliser le mode admin pour ce type de compte',
      );
    }

    const { access_token } = await this.authService.login(user, true);
    const refreshToken = await this.refreshTokenService.create(user.id);

    await this.auditService.logAction(
      user.id,
      'AUTH: SUDO_MODE_ACTIVATED',
      { userId: user.id },
      user.authMethod,
      req.ip,
      AuditCategory.AUTH,
    );

    this.setAuthCookies(response, access_token, refreshToken, req);
    return { message: 'Sudo mode activated' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('otp/generate')
  async generateOtp(@Req() req: any) {
    return this.authService.generateOtp(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('otp/enable')
  async enableOtp(
    @Req() req: any,
    @Body() body: VerifyOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.enableOtp(req.user.sub, body.code);

    const user = await this.prisma.user.findUnique({ where: { id: req.user.sub } });
    const { access_token } = await this.authService.login(user, req.user.isAdminMode);
    const refreshToken = await this.refreshTokenService.create(user!.id);

    this.setAuthCookies(response, access_token, refreshToken, req);
    return { message: 'OTP activé avec succès' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('otp/disable')
  @Throttle({ auth: { limit: 5, ttl: 300000 } })
  async disableOtp(
    @Req() req: any,
    @Body() body: VerifyOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.disableOtp(req.user.sub, body.code);

    const user = await this.prisma.user.findUnique({ where: { id: req.user.sub } });
    const { access_token } = await this.authService.login(user, req.user.isAdminMode);
    const refreshToken = await this.refreshTokenService.create(user!.id);

    this.setAuthCookies(response, access_token, refreshToken, req);
    return { message: 'OTP désactivé avec succès' };
  }

  @Get('oidc/login')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async oidcLogin(@Req() req: any, @Res() res: Response) {
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(48).toString('base64url');

    const url = await this.oidcService.getAuthorizationUrl(state, nonce, codeVerifier);
    if (!url) throw new UnauthorizedException('OIDC not configured');

    const isSecure =
      !!req?.secure ||
      req?.protocol === 'https' ||
      req?.headers?.['x-forwarded-proto'] === 'https';
    const oidcCookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: 300000,
      secure: isSecure || this.isProduction,
    };

    res.cookie('oidc_state', state, oidcCookieOptions);
    res.cookie('oidc_nonce', nonce, oidcCookieOptions);
    res.cookie('oidc_code_verifier', codeVerifier, oidcCookieOptions);
    res.redirect(url);
  }

  @Get('oidc/callback')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async oidcCallback(
    @Req() request: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const state = request.query.state as string;
    const savedState = request.cookies?.oidc_state;
    const savedNonce = request.cookies?.oidc_nonce;
    const savedCodeVerifier = request.cookies?.oidc_code_verifier;

    if (!savedState || savedState !== state) throw new UnauthorizedException('Invalid OIDC state');
    if (!savedCodeVerifier) throw new UnauthorizedException('Missing PKCE code verifier');

    const protocol =
      request.get('X-Forwarded-Proto') || (this.isProduction ? 'https' : 'http');
    const host = request.get('X-Forwarded-Host') || request.get('host');
    const fullUrl = `${protocol}://${host}/api${request.originalUrl}`;

    const user = await this.oidcService.validateCallback(
      fullUrl,
      savedState,
      savedNonce,
      savedCodeVerifier,
    );
    if (!user) throw new UnauthorizedException('OIDC authentication failed');

    const { access_token } = await this.authService.login(user);
    const refreshToken = await this.refreshTokenService.create(user.id);

    await this.auditService.logAction(
      user.id,
      'AUTH: OIDC_LOGIN_SUCCESS',
      { userId: user.id },
      'OIDC' as any,
      request.ip,
      AuditCategory.AUTH,
    );

    this.setNoCacheHeaders(response);
    this.setAuthCookies(response, access_token, refreshToken, request);
    // SECURITY: clear OIDC handshake cookies — single-use only.
    response.clearCookie('oidc_state');
    response.clearCookie('oidc_nonce');
    response.clearCookie('oidc_code_verifier');
    response.redirect('/');
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = req.cookies?.jwt;
    const user = req.user;

    if (token) await this.tokenBlacklistService.add(token);
    if (user) {
      await this.refreshTokenService.revokeAllForUser(user.sub);
      await this.auditService.logAction(
        user.sub,
        'AUTH: LOGOUT',
        { userId: user.sub },
        user.authMethod,
        req.ip,
        AuditCategory.AUTH,
      );
    }

    this.setNoCacheHeaders(response);
    response.clearCookie('jwt');
    response.clearCookie('refresh_token', { path: '/api/auth/refresh' });
    return { message: 'Logged out and session revoked' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @SkipThrottle()
  getProfile(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return {
      ...req.user,
      requiresPasswordChange: req.user.requiresPasswordChange || false,
      isOtpEnabled: !!req.user.isOtpEnabled,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Req() req: any, @Body() body: ChangePasswordDto) {
    const user = req.user;
    await this.authService.changePassword(user.sub, body.currentPassword, body.password);

    await this.auditService.logAction(
      user.sub,
      'AUTH: PASSWORD_CHANGED',
      { email: user.email },
      user.authMethod,
      req.ip,
      AuditCategory.AUTH,
    );

    return { message: 'Password changed successfully' };
  }
}
