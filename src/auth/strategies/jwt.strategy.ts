import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { TokenBlacklistService } from '../token-blacklist.service';
import { UsersService } from '../../users/users.service';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private tokenBlacklistService: TokenBlacklistService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return request?.cookies?.jwt;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any) {
    const token = req.cookies?.jwt;

    // 1. Check blacklist (Logout/Revocation)
    if (token && (await this.tokenBlacklistService.isBlacklisted(token))) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // 2. Check user existence (Account deletion) and token version (Global revocation)
    const user = await this.usersService.findOneById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // MED-12 FIX: Mandatory version check, default to -1 if missing to force re-auth
    const payloadVersion = payload.version ?? -1;
    if (user.tokenVersion !== payloadVersion) {
      throw new UnauthorizedException('Session expired / Token revoked');
    }

    return {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      authMethod: user.authMethod,
      requiresPasswordChange: user.requiresPasswordChange,
      isOtpEnabled: user.isOtpEnabled,
      isAdminMode: !!payload.isAdminMode,
    };
  }
}
