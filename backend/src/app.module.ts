import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { VaultModule } from './vault/vault.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MachinesModule } from './machines/machines.module';
import { TerminalModule } from './terminal/terminal.module';
import { AuditModule } from './audit/audit.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { RbacModule } from './rbac/rbac.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { SettingsModule } from './settings/settings.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import {
  THROTTLE_AUTH_TTL,
  THROTTLE_AUTH_LIMIT,
} from './common/constants/security.constants';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    VaultModule,
    AuthModule,
    UsersModule,
    MachinesModule,
    TerminalModule,
    AuditModule,
    RbacModule,
    MonitoringModule,
    SettingsModule,
    ScheduleModule.forRoot(),
    // SECURITY: rate limiting is now scoped to authentication only. The
    // previous `global` and `user` throttlers capped every authenticated
    // resource/log request; they have been removed so that logged-in users
    // hit no throttle when browsing machines, recordings or audit logs. Only
    // the `auth` throttler remains — it protects the login / OTP / sudo /
    // refresh endpoints (which carry `@Throttle({ auth: { ... } })`) against
    // brute force.
    ThrottlerModule.forRoot([
      {
        name: 'auth',
        ttl: THROTTLE_AUTH_TTL,
        limit: THROTTLE_AUTH_LIMIT,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
  ],
})
export class AppModule {}
