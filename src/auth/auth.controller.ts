import {
  Controller,
  Post,
  Body,
  Res,
  UnauthorizedException,
  BadRequestException,
  Get,
  UseGuards,
  Req,
  Param,
  Patch,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import type { Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { OidcService } from './oidc.service';
import { AuthProvidersService } from './auth-providers.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { AuditService, AuditCategory } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { LoginOtpDto, SudoDto, VerifyOtpDto } from './dto/otp.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  JWT_COOKIE_MAX_AGE_MS,
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
    private prisma: PrismaService,
  ) {}

  @Get('providers')
  @SkipThrottle()
  async getProviders() {
    const providers = await this.authProvidersService.findAllEnabled();
    return providers.map((p: any) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      enabled: p.enabled,
      config: p.config,
    }));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('admin/providers')
  async getAllProviders() {
    const providers = await this.prisma.authProvider.findMany();
    return Promise.all(
      providers.map(async (p) => ({
        ...p,
        config: (this.authProvidersService as any).decryptConfig(p.config, p.id),
      })),
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('providers/:id')
  async updateProvider(@Param('id') id: string, @Body() body: any) {
    const result = await this.authProvidersService.update(id, body);
    
    await this.auditService.logAction(
      null as any, // Admin user sub will be added by interceptor if possible
      'AUTH: PROVIDER_UPDATED',
      { providerId: id, type: result.type, enabled: result.enabled },
      'ADMIN' as any,
      '',
      AuditCategory.AUTH,
    );
    
    return {
      ...result,
      config: (this.authProvidersService as any).decryptConfig(result.config, result.id),
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('providers/upsert')
  async upsertProvider(@Body() body: any) {
    const { type, config, enabled } = body;
    const existing = await this.prisma.authProvider.findFirst({
      where: { type },
    });

    let result;
    if (existing) {
      result = await this.authProvidersService.update(existing.id, { config, enabled });
    } else {
      result = await this.authProvidersService.create({
        name: type === 'LDAP' ? 'LDAP Provider' : 'OIDC Provider',
        type,
        config,
      });
      if (enabled !== undefined) {
        await this.authProvidersService.update(result.id, { enabled });
      }
    }

    return {
      ...result,
      config: (this.authProvidersService as any).decryptConfig(result.config, result.id),
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
      // Return a temporary token for OTP step
      const tempToken = await this.jwtService.signAsync(
        { sub: user.id, isPartial: true },
        { expiresIn: '5m' },
      );
      return {
        requiresOtp: true,
        tempToken,
      };
    }

    const { access_token } = await this.authService.login(user);

    await this.auditService.logAction(
      user.id,
      'AUTH: LOGIN_SUCCESS',
      { userId: user.id },
      user.authMethod,
      request.ip,
      AuditCategory.AUTH,
    );

    // SECURITY FIX: Set Cache-Control headers for sensitive auth responses
    response.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    );
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    response.cookie('jwt', access_token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'strict',
      maxAge: JWT_COOKIE_MAX_AGE_MS,
    });

    return {
      message: 'Login successful',
      requiresPasswordChange: user.requiresPasswordChange || false,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        authMethod: user.authMethod,
        isOtpEnabled: !!user.isOtpEnabled,
        isAdminMode: false, // Must use /sudo to elevate
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

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) throw new UnauthorizedException();

      const isValid = await this.authService.verifyOtp(user.id, body.code);
      if (!isValid) {
        throw new BadRequestException('Code OTP invalide');
      }

      const { access_token } = await this.authService.login(user, false);

      await this.auditService.logAction(
        user.id,
        'AUTH: LOGIN_OTP_SUCCESS',
        { userId: user.id },
        user.authMethod,
        request.ip,
        AuditCategory.AUTH,
      );

      response.cookie('jwt', access_token, {
        httpOnly: true,
        secure: this.isProduction,
        sameSite: 'strict',
        maxAge: JWT_COOKIE_MAX_AGE_MS,
      });

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
      if (e instanceof BadRequestException) throw e;
      throw new UnauthorizedException('Session OTP expirée ou invalide');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('sudo')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async sudo(
    @Req() req: any,
    @Body() body: SudoDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
    });
    if (!user || user.role !== 'ADMIN') {
      throw new UnauthorizedException('Accès refusé');
    }

    if (user.isOtpEnabled) {
      if (!body.code) throw new BadRequestException('Code OTP requis');
      const isValid = await this.authService.verifyOtp(user.id, body.code);
      if (!isValid) {
        throw new BadRequestException('Code OTP invalide');
      }
    }

    const { access_token } = await this.authService.login(user, true);

    await this.auditService.logAction(
      user.id,
      'AUTH: SUDO_MODE_ACTIVATED',
      { userId: user.id },
      user.authMethod,
      req.ip,
      AuditCategory.AUTH,
    );

    response.cookie('jwt', access_token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'strict',
      maxAge: JWT_COOKIE_MAX_AGE_MS,
    });

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

    // Refresh token to include isOtpEnabled: true
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
    });
    const { access_token } = await this.authService.login(user, req.user.isAdminMode);

    response.cookie('jwt', access_token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'strict',
      maxAge: JWT_COOKIE_MAX_AGE_MS,
    });

    return { message: 'OTP activé avec succès' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('otp/disable')
  @Throttle({ auth: { limit: 5, ttl: 300000 } }) // LOW-08 FIX: 5 attempts per 5 minutes
  async disableOtp(
    @Req() req: any,
    @Body() body: VerifyOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.disableOtp(req.user.sub, body.code);

    // Refresh token to include isOtpEnabled: false
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
    });
    const { access_token } = await this.authService.login(user, req.user.isAdminMode);

    response.cookie('jwt', access_token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'strict',
      maxAge: JWT_COOKIE_MAX_AGE_MS,
    });

    return { message: 'OTP désactivé avec succès' };
  }

  @Get('oidc/login')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async oidcLogin(@Res() res: Response) {
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');

    const url = await this.oidcService.getAuthorizationUrl(state, nonce);
    if (!url) throw new UnauthorizedException('OIDC not configured');

    const oidcCookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const, // 'lax' requis : 'strict' bloque le retour du callback OIDC (redirection cross-site)
      maxAge: 300000,
      secure: this.isProduction,
    };

    res.cookie('oidc_state', state, oidcCookieOptions);
    res.cookie('oidc_nonce', nonce, oidcCookieOptions);

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

    if (!savedState || savedState !== state) {
      throw new UnauthorizedException('Invalid OIDC state');
    }

    // Reconstruct the full public URL of the callback request.
    // Behind nginx, the /api/ prefix is stripped before reaching NestJS,
    // so we must re-add it to match the redirect_uri registered in authentik.
    const protocol =
      request.get('X-Forwarded-Proto') || (this.isProduction ? 'https' : 'http');
    const host = request.get('X-Forwarded-Host') || request.get('host');
    const fullUrl = `${protocol}://${host}/api${request.originalUrl}`;

    const user = await this.oidcService.validateCallback(
      fullUrl,
      savedState,
      savedNonce,
    );
    if (!user) throw new UnauthorizedException('OIDC authentication failed');

    const { access_token } = await this.authService.login(user);

    await this.auditService.logAction(
      user.id,
      'AUTH: OIDC_LOGIN_SUCCESS',
      { userId: user.id },
      'OIDC' as any,
      request.ip,
      AuditCategory.AUTH,
    );

    // SECURITY FIX: Set Cache-Control headers for sensitive auth responses
    response.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    );
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    response.cookie('jwt', access_token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'strict',
      maxAge: JWT_COOKIE_MAX_AGE_MS,
    });
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

    if (token) {
      await this.tokenBlacklistService.add(token);
    }

    if (user) {
      await this.auditService.logAction(
        user.sub,
        'AUTH: LOGOUT',
        { userId: user.sub },
        user.authMethod,
        req.ip,
        AuditCategory.AUTH,
      );
    }

    // SECURITY FIX: Set Cache-Control headers for logout response
    response.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    );
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    response.clearCookie('jwt');
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
    await this.authService.changePassword(
      user.sub,
      body.currentPassword,
      body.password,
    );

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