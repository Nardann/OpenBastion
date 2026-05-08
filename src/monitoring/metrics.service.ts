import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly activeSessions = new Gauge({
    name: 'bastion_active_sessions',
    help: 'Number of active terminal sessions',
    labelNames: ['protocol'] as const,
    registers: [this.registry],
  });

  readonly sessionDuration = new Histogram({
    name: 'bastion_session_duration_seconds',
    help: 'Duration of terminal sessions in seconds',
    labelNames: ['protocol'] as const,
    buckets: [30, 60, 300, 600, 1800, 3600],
    registers: [this.registry],
  });

  readonly authAttempts = new Counter({
    name: 'bastion_auth_attempts_total',
    help: 'Total authentication attempts',
    labelNames: ['result', 'method'] as const,
    registers: [this.registry],
  });

  readonly otpFailures = new Counter({
    name: 'bastion_otp_failures_total',
    help: 'Total OTP verification failures',
    labelNames: ['role'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDuration = new Histogram({
    name: 'bastion_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  readonly vaultOperations = new Counter({
    name: 'bastion_vault_operations_total',
    help: 'Total vault operations',
    labelNames: ['op', 'result'] as const,
    registers: [this.registry],
  });

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry, prefix: 'bastion_' });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
