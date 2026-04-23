import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '../config/config.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthProvidersService } from './auth-providers.service';
import { LdapService } from './ldap.service';
import { OidcService } from './oidc.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TokenBlacklistService } from './token-blacklist.service';
import { JWT_EXPIRATION_STRING } from '../common/constants/security.constants';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    PassportModule,
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
    JwtStrategy,
    AuthProvidersService,
    LdapService,
    OidcService,
    TokenBlacklistService,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    AuthProvidersService,
    OidcService,
    TokenBlacklistService,
  ],
})
export class AuthModule {}
