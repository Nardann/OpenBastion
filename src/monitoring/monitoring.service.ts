import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';
import { AlertingService } from './alerting.service';
import {
  HEALTH_CHECK_INTERVAL_MS,
  VAULT_INTEGRITY_TEST_TOKEN,
  VAULT_INTEGRITY_TEST_CONTEXT,
  DB_HEALTH_SLOW_THRESHOLD_MS,
  DB_HEALTH_TIMEOUT_MS,
} from '../common/constants/monitoring.constants';

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private healthTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private prisma: PrismaService,
    private vault: VaultService,
    private alerting: AlertingService,
  ) {}

  onModuleInit() {
    this.healthTimer = setInterval(() => void this.runHealthCheck(), HEALTH_CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.healthTimer !== undefined) clearInterval(this.healthTimer);
  }

  async runHealthCheck() {
    this.logger.log('Starting System Integrity Scan...');
    try {
      await this.checkDatabaseHealth();
      await this.checkVaultIntegrity();
      this.logger.log('System Integrity: OK');
    } catch (error: any) {
      this.logger.error(`SYSTEM HEALTH ALERT: ${error.message}`);
      await this.alerting.alert({
        title: 'System Health Check Failed',
        message: error.message,
        severity: 'critical',
        metadata: { component: 'health-check' },
      });
    }
  }

  private async checkDatabaseHealth(): Promise<void> {
    const startTime = Date.now();
    try {
      await Promise.race([
        this.prisma.user.count({ take: 1 }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Database health check timeout')),
            DB_HEALTH_TIMEOUT_MS,
          ),
        ),
      ]);

      const latency = Date.now() - startTime;
      if (latency > DB_HEALTH_SLOW_THRESHOLD_MS) {
        this.logger.warn(`Database slow response: ${latency}ms`);
        await this.alerting.alert({
          title: 'Database Slow Response',
          message: `Database latency: ${latency}ms (threshold: ${DB_HEALTH_SLOW_THRESHOLD_MS}ms)`,
          severity: 'warning',
        });
      } else {
        this.logger.debug(`Database latency: ${latency}ms`);
      }
    } catch (error: any) {
      throw new Error(`Database health check failed: ${error.message}`);
    }
  }

  private async checkVaultIntegrity(): Promise<void> {
    try {
      const encrypted = this.vault.encrypt(VAULT_INTEGRITY_TEST_TOKEN, VAULT_INTEGRITY_TEST_CONTEXT);
      const decrypted = this.vault.decrypt(encrypted, VAULT_INTEGRITY_TEST_CONTEXT);

      if (decrypted !== VAULT_INTEGRITY_TEST_TOKEN) {
        throw new Error('Vault integrity check failed: Data mismatch after decryption');
      }

      this.logger.debug('Vault integrity: OK');
    } catch (error: any) {
      throw new Error(`Vault integrity check failed: ${error.message}`);
    }
  }
}
