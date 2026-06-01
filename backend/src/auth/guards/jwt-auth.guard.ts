import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { TokenBlacklistService } from '../token-blacklist.service';
import { UsersService } from '../../users/users.service';

// Routes that remain reachable while `requiresPasswordChange` is true.
// Anything outside this list is rejected with 403 until the user rotates
// their bootstrap password.
const PASSWORD_CHANGE_ALLOWLIST: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/auth\/me\/?$/ },
  { method: 'POST', path: /^\/auth\/change-password\/?$/ },
  { method: 'POST', path: /^\/auth\/logout\/?$/ },
  { method: 'POST', path: /^\/auth\/refresh\/?$/ },
];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private tokenBlacklist: TokenBlacklistService,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token: string | undefined = (req as any).cookies?.jwt;

    if (!token) throw new UnauthorizedException('No token provided');

    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (await this.tokenBlacklist.isBlacklisted(token)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const user = await this.usersService.findOneById(payload.sub);
    if (!user) throw new UnauthorizedException('User no longer exists');

    const payloadVersion = payload.version ?? -1;
    if (user.tokenVersion !== payloadVersion) {
      throw new UnauthorizedException('Session expired / Token revoked');
    }

    // SECURITY: while a forced password rotation is pending, only the
    // allowlisted endpoints are reachable. Stops a leaked bootstrap password
    // from being used to call admin endpoints, sudo, providers/upsert, etc.
    if (user.requiresPasswordChange) {
      const url = new URL(req.url, 'http://internal');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const allowed = PASSWORD_CHANGE_ALLOWLIST.some(
        (rule) => rule.method === req.method && rule.path.test(path),
      );
      if (!allowed) {
        throw new ForbiddenException(
          'Password change required before any further action.',
        );
      }
    }

    (req as any)['user'] = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      authMethod: user.authMethod,
      // Needed by the sudo modal: an OIDC admin without OTP must be
      // redirected to `/auth/sudo/oidc/:providerId/start`, which only
      // works if the UI knows which provider provisioned them.
      authProviderId: user.authProviderId ?? null,
      requiresPasswordChange: user.requiresPasswordChange,
      isOtpEnabled: user.isOtpEnabled,
      isAdminMode: !!payload.isAdminMode,
    };

    return true;
  }
}
