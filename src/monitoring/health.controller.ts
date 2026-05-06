import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';
import {
  VAULT_INTEGRITY_TEST_TOKEN,
  VAULT_INTEGRITY_TEST_CONTEXT,
} from '../common/constants/monitoring.constants';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private prisma: PrismaService,
    private vault: VaultService,
  ) {}

  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      async () => {
        const encrypted = this.vault.encrypt(VAULT_INTEGRITY_TEST_TOKEN, VAULT_INTEGRITY_TEST_CONTEXT);
        const decrypted = this.vault.decrypt(encrypted, VAULT_INTEGRITY_TEST_CONTEXT);
        const ok = decrypted === VAULT_INTEGRITY_TEST_TOKEN;
        return {
          vault: {
            status: ok ? 'up' : 'down',
          },
        };
      },
    ]);
  }
}
