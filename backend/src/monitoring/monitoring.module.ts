import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MonitoringService } from './monitoring.service';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { AlertingService } from './alerting.service';
import { HealthController } from './health.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { VaultModule } from '../vault/vault.module';

@Module({
  imports: [PrismaModule, VaultModule, TerminusModule],
  providers: [MonitoringService, MetricsService, AlertingService],
  controllers: [MetricsController, HealthController],
  exports: [MetricsService, AlertingService],
})
export class MonitoringModule {}
