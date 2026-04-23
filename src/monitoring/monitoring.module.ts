import { Module } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { PrismaModule } from '../prisma/prisma.module';
import { VaultModule } from '../vault/vault.module';

@Module({
  imports: [PrismaModule, VaultModule],
  providers: [MonitoringService],
})
export class MonitoringModule {}
