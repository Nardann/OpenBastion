import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '../config/config.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthProvidersService } from './auth-providers.service';
import { LdapService } from './ldap.service';
import { OidcService } from './oidc.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TokenBlacklistService } from './token-blacklist.service';
import { OtpLockoutService } from './otp-lockout.service';
import { RefreshTokenService } from './refresh-token.service';
import { JWT_EXPIRATION_STRING } from '../common/constants/security.constants';
import { UsersModule } from '../users/users.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: JWT_EXPIRATION_STRING },
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtAuthGuard,
    AuthProvidersService,
    LdapService,
    OidcService,
    TokenBlacklistService,
    OtpLockoutService,
    RefreshTokenService,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    AuthProvidersService,
    OidcService,
    TokenBlacklistService,
    OtpLockoutService,
    RefreshTokenService,
    JwtAuthGuard,
    JwtModule,
    UsersModule,
  ],
})
export class AuthModule {}
