import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { TokenBlacklistService } from '../token-blacklist.service';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private tokenBlacklist: TokenBlacklistService,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token: string | undefined = req.cookies?.jwt;

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

    (req as any)['user'] = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      authMethod: user.authMethod,
      requiresPasswordChange: user.requiresPasswordChange,
      isOtpEnabled: user.isOtpEnabled,
      isAdminMode: !!payload.isAdminMode,
    };

    return true;
  }
}
