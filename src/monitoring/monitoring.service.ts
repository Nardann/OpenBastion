import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private healthTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private prisma: PrismaService,
    private vault: VaultService,
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
            5000,
          ),
        ),
      ]);

      const latency = Date.now() - startTime;
      if (latency > 2000) {
        this.logger.warn(`Database slow response: ${latency}ms`);
      } else {
        this.logger.debug(`Database latency: ${latency}ms`);
      }
    } catch (error: any) {
      throw new Error(`Database health check failed: ${error.message}`);
    }
  }

  private async checkVaultIntegrity(): Promise<void> {
    try {
      const testContext = 'system-health-check';
      const testData = 'bastion-integrity-test';
      const encrypted = this.vault.encrypt(testData, testContext);
      const decrypted = this.vault.decrypt(encrypted, testContext);

      if (decrypted !== testData) {
        throw new Error(
          'Vault integrity check failed: Data mismatch after decryption',
        );
      }

      this.logger.debug('Vault integrity: OK');
    } catch (error: any) {
      throw new Error(`Vault integrity check failed: ${error.message}`);
    }
  }
}
