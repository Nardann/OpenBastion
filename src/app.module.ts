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
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { RbacModule } from './rbac/rbac.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { SettingsModule } from './settings/settings.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import {
  THROTTLE_GLOBAL_TTL,
  THROTTLE_GLOBAL_LIMIT,
  THROTTLE_AUTH_TTL,
  THROTTLE_AUTH_LIMIT,
  THROTTLE_USER_TTL,
  THROTTLE_USER_LIMIT_USER,
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
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: THROTTLE_GLOBAL_TTL,
        limit: THROTTLE_GLOBAL_LIMIT,
      },
      {
        name: 'auth',
        ttl: THROTTLE_AUTH_TTL,
        limit: THROTTLE_AUTH_LIMIT,
      },
      {
        name: 'user',
        ttl: THROTTLE_USER_TTL,
        limit: THROTTLE_USER_LIMIT_USER,
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
