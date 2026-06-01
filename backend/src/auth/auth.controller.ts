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
  Delete,
  ParseUUIDPipe,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import type { Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { OidcService } from './oidc.service';
import { LdapService } from './ldap.service';
import { AuthProvidersService } from './auth-providers.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuditService, AuditCategory } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { LoginOtpDto, SudoDto, VerifyOtpDto } from './dto/otp.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  CreateAuthProviderDto,
  UpdateAuthProviderDto,
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
    private ldapService: LdapService,
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

  /**
   * Anonymous list shown on the login page. Always includes the synthetic
   * `local` provider first so the UI can render "Local" alongside the
   * configured LDAP/OIDC directories. Never returns secrets.
   */
  @Get('providers')
  @SkipThrottle()
  async getProviders() {
    const providers = await this.authProvidersService.findAllPublic();
    return [
      { id: 'local', name: 'Local', type: 'LOCAL', enabled: true },
      ...providers,
    ];
  }

  /** Admin-only: full list with decrypted config for the management table. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('admin/providers')
  async getAllProviders() {
    return this.authProvidersService.findAllForAdmin();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/providers')
  async createProvider(@Body() body: CreateAuthProviderDto, @Req() req: any) {
    const validatedConfig = await validateProviderConfig(
      body.type,
      body.config ?? {},
    ).catch((err) => {
      throw new BadRequestException({
        message: err.message,
        errors: (err as any).details ?? [],
      });
    });

    const createPayload: {
      name: string;
      type: typeof body.type;
      config: typeof validatedConfig;
      enabled?: boolean;
    } = {
      name: body.name,
      type: body.type,
      config: validatedConfig,
    };
    if (body.enabled !== undefined) createPayload.enabled = body.enabled;
    const created = await this.authProvidersService.create(createPayload);

    // F-03: drop cached discovery so the next flow re-discovers freshly.
    if (created.type === 'OIDC') this.oidcService.invalidateCache();

    await this.auditService.logAction(
      req.user?.sub ?? null,
      'AUTH: PROVIDER_CREATED',
      { providerId: created.id, name: created.name, type: created.type },
      req.user?.authMethod ?? null,
      req.ip,
      AuditCategory.AUTH,
    );

    return {
      ...created,
      config: this.authProvidersService.decryptConfig(created.config, created.id),
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('admin/providers/:id')
  async updateProvider(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateAuthProviderDto,
    @Req() req: any,
  ) {
    const existing = await this.authProvidersService.findById(id);
    if (!existing) throw new BadRequestException('Provider introuvable');

    const updatePayload: {
      name?: string;
      config?: ReturnType<typeof validateProviderConfig> extends Promise<infer C> ? C : never;
      enabled?: boolean;
    } = {};
    if (body.name !== undefined) updatePayload.name = body.name;
    if (body.enabled !== undefined) updatePayload.enabled = body.enabled;

    if (body.config !== undefined) {
      const validatedConfig = await validateProviderConfig(
        existing.type,
        body.config ?? {},
      ).catch((err) => {
        throw new BadRequestException({
          message: err.message,
          errors: (err as any).details ?? [],
        });
      });
      updatePayload.config = validatedConfig as any;
    }

    const result = await this.authProvidersService.update(id, updatePayload as any);

    // F-03: clear OIDC cache on any update; cheap and safer than tracking
    // exactly which fields changed.
    if (result.type === 'OIDC') this.oidcService.invalidateCache();

    await this.auditService.logAction(
      req.user?.sub ?? null,
      'AUTH: PROVIDER_UPDATED',
      {
        providerId: id,
        name: result.name,
        type: result.type,
        enabled: result.enabled,
        changed: Object.keys(updatePayload),
      },
      req.user?.authMethod ?? null,
      req.ip,
      AuditCategory.AUTH,
    );

    return {
      ...result,
      config: this.authProvidersService.decryptConfig(result.config, result.id),
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('admin/providers/:id')
  async deleteProvider(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    const removed = await this.authProvidersService.delete(id);

    if (removed.type === 'OIDC') this.oidcService.invalidateCache();

    await this.auditService.logAction(
      req.user?.sub ?? null,
      'AUTH: PROVIDER_DELETED',
      { providerId: removed.id, name: removed.name, type: removed.type },
      req.user?.authMethod ?? null,
      req.ip,
      AuditCategory.AUTH,
    );

    return { message: 'Provider supprimé', id: removed.id };
  }

  @Post('login')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: any,
  ) {
    const user = await this.authService.validateUser(
      loginDto.providerId,
      loginDto.identifier,
      loginDto.password,
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
      {
        userId: user.id,
        providerId: loginDto.providerId,
        authProviderId: user.authProviderId ?? null,
      },
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

    // SECURITY: sudo requires fresh proof of identity. The accepted proof
    // depends on the account's auth method and OTP state:
    //   1. OTP enabled (any auth method) → valid OTP code.
    //   2. LOCAL  + no OTP → current password (step-up).
    //   3. LDAP   + no OTP → re-bind against the directory with current
    //                        identifier + password. We verify the bound
    //                        user matches the calling JWT, so typing
    //                        someone else's LDAP credentials cannot
    //                        elevate the caller.
    //   4. OIDC   + no OTP → NOT handled here. The browser must hit
    //                        `GET /auth/sudo/oidc/:providerId/start`,
    //                        which forces an OIDC roundtrip with
    //                        `prompt=login` so the user re-proves
    //                        identity at the IdP.
    let sudoProof: 'OTP' | 'PASSWORD' | 'LDAP_REBIND';
    if (user.isOtpEnabled) {
      if (!body.code) throw new BadRequestException('Code OTP requis');
      const isValid = await this.authService.verifyOtp(user.id, body.code);
      if (!isValid) throw new BadRequestException('Code OTP invalide');
      sudoProof = 'OTP';
    } else if (user.authMethod === 'LOCAL') {
      if (!body.password)
        throw new BadRequestException(
          'Mot de passe requis pour entrer en mode admin (configurez l\'OTP pour éviter cette étape)',
        );
      if (!user.passwordHash)
        throw new UnauthorizedException('Compte sans mot de passe local');
      const ok = await argon2.verify(user.passwordHash, body.password);
      if (!ok) throw new BadRequestException('Mot de passe incorrect');
      sudoProof = 'PASSWORD';
    } else if (user.authMethod === 'LDAP') {
      if (!body.password) {
        throw new BadRequestException('Mot de passe LDAP requis');
      }
      if (!user.authProviderId) {
        throw new ForbiddenException(
          'Compte LDAP sans provider rattaché — activez l\'OTP',
        );
      }
      // SECURITY: the identifier comes from the JWT-bound user record,
      // NOT from the request body. Reading it from the body would let
      // an authenticated user re-bind as a *different* LDAP account
      // (their colleague's, say) and grant sudo to their own local
      // bastion id — the post-bind id-match check below would have
      // caught it, but defense in depth: make the misuse impossible to
      // express. Prefer the stored handle (sAMAccountName / uid)
      // because that's what the LDAP search filter expects; fall back
      // to email for legacy users whose handle is null.
      const identifier = user.username ?? user.email;
      if (!identifier) {
        throw new ForbiddenException(
          'Compte LDAP sans identifiant utilisable — activez l\'OTP',
        );
      }
      const bound = await this.ldapService.authenticate(
        user.authProviderId,
        identifier,
        body.password,
      );
      if (!bound) {
        throw new BadRequestException('Mot de passe LDAP invalide');
      }
      // Defence in depth: even with our own identifier, a misconfigured
      // search filter could resolve to a different DN. Refuse + audit
      // if the bound user is not who we asked for.
      if ((bound as { id?: string }).id !== user.id) {
        await this.auditService.log({
          actorId: user.id,
          action: 'AUTH: SUDO_LDAP_IDENTITY_MISMATCH',
          category: AuditCategory.AUTH,
          authMethod: 'LDAP' as any,
          ipAddress: req.ip,
          details: {
            calledBy: user.id,
            boundId: (bound as any).id,
            identifierUsed: identifier,
          },
          entities: {
            users: [user.id],
            ...(user.authProviderId ? { providers: [user.authProviderId] } : {}),
          },
        });
        throw new ForbiddenException(
          'Ré-authentification LDAP impossible pour ce compte',
        );
      }
      sudoProof = 'LDAP_REBIND';
    } else {
      // OIDC + no OTP: explicitly point the client at the browser flow.
      throw new ForbiddenException(
        'Compte OIDC : utilisez la ré-authentification SSO (GET /auth/sudo/oidc/{providerId}/start) ou activez l\'OTP.',
      );
    }

    const { access_token } = await this.authService.login(user, true);
    const refreshToken = await this.refreshTokenService.create(user.id);

    await this.auditService.logAction(
      user.id,
      'AUTH: SUDO_MODE_ACTIVATED',
      { userId: user.id, proof: sudoProof },
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

  private setOidcHandshakeCookies(
    res: Response,
    req: any,
    state: string,
    nonce: string,
    codeVerifier: string,
    providerId: string,
  ) {
    const isSecure =
      !!req?.secure ||
      req?.protocol === 'https' ||
      req?.headers?.['x-forwarded-proto'] === 'https';
    // Explicit `path: '/'` — Express defaults to '/' but being explicit
    // avoids any surprise when reverse proxies or middleware mutate paths.
    const opts = {
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: 300000,
      secure: isSecure || this.isProduction,
      path: '/',
    };
    res.cookie('oidc_state', state, opts);
    res.cookie('oidc_nonce', nonce, opts);
    res.cookie('oidc_code_verifier', codeVerifier, opts);
    // SECURITY: bind the in-flight OIDC handshake to a specific provider so
    // the callback can't be replayed against a different IdP. The cookie
    // is HttpOnly + SameSite=Lax + single-use (cleared in the callback).
    res.cookie('oidc_provider_id', providerId, opts);

    // DIAG: surface what we are about to ship so admins can compare with
    // the cookie header that arrives on the callback. We log presence and
    // length only — never the values themselves.
    // eslint-disable-next-line no-console
    console.log(
      `[OIDC START] providerId=${providerId} setCookies={state:${state.length}b, nonce:${nonce.length}b, codeVerifier:${codeVerifier.length}b} secure=${opts.secure} sameSite=${opts.sameSite}`,
    );
  }

  private clearOidcHandshakeCookies(response: Response) {
    response.clearCookie('oidc_state', { path: '/' });
    response.clearCookie('oidc_nonce', { path: '/' });
    response.clearCookie('oidc_code_verifier', { path: '/' });
    response.clearCookie('oidc_provider_id', { path: '/' });
  }

  /**
   * Provider-aware OIDC start: redirects the browser to the chosen IdP's
   * authorization endpoint and stores the handshake state in a short-lived
   * cookie scoped to the provider id.
   */
  @Get('oidc/:providerId/login')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async oidcLoginForProvider(
    @Param('providerId', new ParseUUIDPipe()) providerId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(48).toString('base64url');

    const url = await this.oidcService.getAuthorizationUrl(
      providerId,
      state,
      nonce,
      codeVerifier,
    );
    if (!url) throw new UnauthorizedException('OIDC not configured');

    this.setOidcHandshakeCookies(res, req, state, nonce, codeVerifier, providerId);
    res.redirect(url);
  }

  /**
   * Legacy shortcut for the single-OIDC case. Resolves the first enabled
   * OIDC provider and delegates to the id-scoped handler. Returns 404 when
   * no OIDC provider is enabled (UI should hide the SSO button instead).
   */
  @Get('oidc/login')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async oidcLoginLegacy(@Req() req: any, @Res() res: Response) {
    const provider = await this.authProvidersService.findFirstEnabledByType('OIDC');
    if (!provider) throw new UnauthorizedException('OIDC not configured');
    return this.oidcLoginForProvider(provider.id, req, res);
  }

  @Get('oidc/callback')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async oidcCallback(
    @Req() request: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    const state = request.query.state as string;

    // ─── Dispatch: sudo flow vs login flow ──────────────────────────
    // Both flows hit `/api/auth/oidc/callback` because the OIDC client
    // registered at the IdP only knows one redirect_uri. We pick the
    // branch by matching the URL state against the saved state cookies:
    // whichever cookie matches the URL state is the flow this callback
    // belongs to. This correctly handles the edge case where a user has
    // a stale sudo handshake AND opens a fresh login flow in another
    // tab — the URL state pinpoints exactly which one came back.
    const sudoStateCookie = request.cookies?.sudo_oidc_state;
    const loginStateCookie = request.cookies?.oidc_state;
    if (sudoStateCookie && sudoStateCookie === state) {
      return this.handleSudoOidcCallback(request, response, state);
    }
    // Defensive: if only sudo cookies exist (no login state at all),
    // route to sudo so the state-mismatch error message is correct.
    if (sudoStateCookie && !loginStateCookie) {
      return this.handleSudoOidcCallback(request, response, state);
    }

    const savedState = request.cookies?.oidc_state;
    const savedNonce = request.cookies?.oidc_nonce;
    const savedCodeVerifier = request.cookies?.oidc_code_verifier;
    const savedProviderId = request.cookies?.oidc_provider_id;

    // DIAG: when the callback fails with "Invalid OIDC state" the first
    // thing to know is whether cookies arrived at all and which ones the
    // proxy chain stripped. We log the cookie *names* the request carried
    // and the lengths of values — never the values themselves (they are
    // CSRF tokens and PKCE verifiers, log poisoning would defeat them).
    const cookieHeader: string | undefined = request.headers?.cookie;
    const presentNames = cookieHeader
      ? cookieHeader
          .split(';')
          .map((p: string) => p.trim().split('=')[0])
          .filter(Boolean)
      : [];
    // eslint-disable-next-line no-console
    console.log(
      `[OIDC CALLBACK] cookieHeaderPresent=${!!cookieHeader} ` +
        `parsedCount=${Object.keys(request.cookies ?? {}).length} ` +
        `names=[${presentNames.join(',')}] ` +
        `state.inUrl=${state ? state.length + 'b' : 'absent'} ` +
        `state.inCookie=${savedState ? savedState.length + 'b' : 'absent'} ` +
        `nonce=${savedNonce ? 'yes' : 'no'} ` +
        `codeVerifier=${savedCodeVerifier ? 'yes' : 'no'} ` +
        `providerId=${savedProviderId ? 'yes' : 'no'}`,
    );

    if (!savedState || savedState !== state) {
      throw new UnauthorizedException(
        `Invalid OIDC state (cookiePresent=${!!savedState}, matches=${savedState === state})`,
      );
    }
    if (!savedCodeVerifier) throw new UnauthorizedException('Missing PKCE code verifier');
    if (!savedProviderId || !/^[0-9a-fA-F-]{36}$/.test(savedProviderId)) {
      throw new UnauthorizedException('Missing OIDC provider context');
    }

    const protocol =
      request.get('X-Forwarded-Proto') || (this.isProduction ? 'https' : 'http');
    const host = request.get('X-Forwarded-Host') || request.get('host');
    const fullUrl = `${protocol}://${host}/api${request.originalUrl}`;

    const user = await this.oidcService.validateCallback(
      savedProviderId,
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
      { userId: user.id, providerId: savedProviderId },
      'OIDC' as any,
      request.ip,
      AuditCategory.AUTH,
    );

    this.setNoCacheHeaders(response);
    this.setAuthCookies(response, access_token, refreshToken, request);
    this.clearOidcHandshakeCookies(response);
    response.redirect('/');
  }

  // ─── OIDC sudo (admin mode step-up) ──────────────────────────────────
  //
  // For admins whose account is OIDC-managed and who don't have OTP set
  // up, the regular `/auth/sudo` POST has nothing to verify against (no
  // local password). Instead we trigger a full OIDC roundtrip with
  // `prompt=login` so the IdP asks for credentials again, then verify
  // that the returned `sub` still matches the calling user's
  // `externalId` and grant the elevated JWT.
  //
  // Cookies are deliberately namespaced `sudo_oidc_*` so they cannot
  // collide with an unrelated `oidc_*` flow that might be open in
  // another tab.

  private setSudoOidcHandshakeCookies(
    res: Response,
    req: any,
    state: string,
    nonce: string,
    codeVerifier: string,
    providerId: string,
    userId: string,
  ) {
    const isSecure =
      !!req?.secure ||
      req?.protocol === 'https' ||
      req?.headers?.['x-forwarded-proto'] === 'https';
    const opts = {
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: 300_000,
      secure: isSecure || this.isProduction,
      path: '/',
    };
    res.cookie('sudo_oidc_state', state, opts);
    res.cookie('sudo_oidc_nonce', nonce, opts);
    res.cookie('sudo_oidc_code_verifier', codeVerifier, opts);
    res.cookie('sudo_oidc_provider_id', providerId, opts);
    // Binds the in-flight handshake to the calling user — if the
    // callback completes for a different OIDC `sub`, we refuse to
    // elevate. This is the property that makes sudo actually mean
    // "fresh proof from the same person".
    res.cookie('sudo_oidc_user_id', userId, opts);
  }

  private clearSudoOidcHandshakeCookies(response: Response) {
    response.clearCookie('sudo_oidc_state', { path: '/' });
    response.clearCookie('sudo_oidc_nonce', { path: '/' });
    response.clearCookie('sudo_oidc_code_verifier', { path: '/' });
    response.clearCookie('sudo_oidc_provider_id', { path: '/' });
    response.clearCookie('sudo_oidc_user_id', { path: '/' });
  }

  @UseGuards(JwtAuthGuard)
  @Get('sudo/oidc/:providerId/start')
  @Throttle({ auth: { limit: THROTTLE_AUTH_LIMIT, ttl: THROTTLE_AUTH_TTL } })
  async sudoOidcStart(
    @Param('providerId', new ParseUUIDPipe()) providerId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Accès refusé');
    }
    // The chosen provider must be THIS user's own provider — we refuse
    // to elevate via Provider B if the user was provisioned by
    // Provider A. Otherwise an admin tab from a federation could grant
    // sudo while the IdP that owns the account is unreachable.
    const dbUser = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
    });
    if (!dbUser || dbUser.authMethod !== 'OIDC' || !dbUser.externalId) {
      throw new ForbiddenException('Le mode admin OIDC requiert un compte OIDC');
    }
    if (dbUser.authProviderId !== providerId) {
      throw new ForbiddenException(
        'Le provider choisi ne correspond pas à celui de votre compte',
      );
    }

    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(48).toString('base64url');

    // `prompt=login` forces the IdP to actually ask for credentials —
    // without it, an existing IdP session would silently re-issue a
    // code and the "fresh proof" property of sudo would be a lie.
    const url = await this.oidcService.getAuthorizationUrl(
      providerId,
      state,
      nonce,
      codeVerifier,
      { prompt: 'login' },
    );
    if (!url) throw new UnauthorizedException('OIDC not configured');

    this.setSudoOidcHandshakeCookies(
      res,
      req,
      state,
      nonce,
      codeVerifier,
      providerId,
      req.user.sub,
    );
    res.redirect(url);
  }

  /**
   * Internal handler for the sudo branch — called from `oidcCallback`
   * when `sudo_oidc_*` cookies are detected on the incoming request.
   * Not exposed as its own route because the OIDC client at the IdP is
   * only registered with the single `/api/auth/oidc/callback`
   * redirect_uri.
   */
  private async handleSudoOidcCallback(
    request: any,
    response: Response,
    state: string,
  ) {
    const savedState = request.cookies?.sudo_oidc_state;
    const savedNonce = request.cookies?.sudo_oidc_nonce;
    const savedCodeVerifier = request.cookies?.sudo_oidc_code_verifier;
    const savedProviderId = request.cookies?.sudo_oidc_provider_id;
    const savedUserId = request.cookies?.sudo_oidc_user_id;

    if (!savedState || savedState !== state) {
      this.clearSudoOidcHandshakeCookies(response);
      throw new UnauthorizedException('Invalid sudo OIDC state');
    }
    if (!savedCodeVerifier)
      throw new UnauthorizedException('Missing PKCE verifier');
    if (!savedProviderId || !/^[0-9a-fA-F-]{36}$/.test(savedProviderId))
      throw new UnauthorizedException('Missing OIDC provider context');
    if (!savedUserId || !/^[0-9a-fA-F-]{36}$/.test(savedUserId))
      throw new UnauthorizedException('Missing user binding');

    const protocol =
      request.get('X-Forwarded-Proto') || (this.isProduction ? 'https' : 'http');
    const host = request.get('X-Forwarded-Host') || request.get('host');
    const fullUrl = `${protocol}://${host}/api${request.originalUrl}`;

    const claims = await this.oidcService.verifyCallbackClaims(
      savedProviderId,
      fullUrl,
      savedState,
      savedNonce,
      savedCodeVerifier,
    );
    if (!claims) {
      this.clearSudoOidcHandshakeCookies(response);
      throw new UnauthorizedException('OIDC sudo verification failed');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: savedUserId },
    });
    if (!dbUser) {
      this.clearSudoOidcHandshakeCookies(response);
      throw new UnauthorizedException('Compte introuvable');
    }
    if (dbUser.role !== 'ADMIN') {
      this.clearSudoOidcHandshakeCookies(response);
      throw new ForbiddenException('Mode admin réservé aux administrateurs');
    }
    if (dbUser.externalId !== claims.sub) {
      // The IdP successfully authenticated *somebody*, just not the
      // person who initiated sudo. Audit it loudly so the admin sees
      // cross-account probes (someone leaving a session open, social
      // engineering, etc.) and refuse the elevation.
      await this.auditService.log({
        actorId: dbUser.id,
        action: 'AUTH: SUDO_OIDC_SUB_MISMATCH',
        category: AuditCategory.AUTH,
        authMethod: 'OIDC' as any,
        ipAddress: request.ip,
        details: { expected: dbUser.externalId, returned: claims.sub },
        entities: {
          users: [dbUser.id],
          ...(dbUser.authProviderId ? { providers: [dbUser.authProviderId] } : {}),
        },
      });
      this.clearSudoOidcHandshakeCookies(response);
      throw new ForbiddenException(
        'L\'identité OIDC retournée ne correspond pas à votre compte',
      );
    }

    const { access_token } = await this.authService.login(dbUser, true);
    const refreshToken = await this.refreshTokenService.create(dbUser.id);

    await this.auditService.log({
      actorId: dbUser.id,
      action: 'AUTH: SUDO_MODE_ACTIVATED',
      category: AuditCategory.AUTH,
      authMethod: 'OIDC' as any,
      ipAddress: request.ip,
      details: { userId: dbUser.id, proof: 'OIDC_REAUTH' },
      entities: {
        users: [dbUser.id],
        ...(dbUser.authProviderId ? { providers: [dbUser.authProviderId] } : {}),
      },
    });

    this.setNoCacheHeaders(response);
    this.setAuthCookies(response, access_token, refreshToken, request);
    this.clearSudoOidcHandshakeCookies(response);
    // Drop the caller back where they came from — for now, the admin
    // landing page. A future enhancement could carry an explicit
    // `return_to` cookie (validated against an allowlist) so users get
    // back to the exact admin sub-page they were trying to open.
    response.redirect('/administration');
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
