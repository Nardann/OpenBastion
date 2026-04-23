import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private prisma: PrismaService,
    private vault: VaultService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runHealthCheck() {
    this.logger.log('Starting System Integrity Scan...');

    try {
      // SECURITY FIX: Improved health check with timeout and performance monitoring
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
      // Test critical table accessibility with timeout
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
      // Vault Integrity Check
      // We try to encrypt/decrypt a test string to ensure Master Key is still functional
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
