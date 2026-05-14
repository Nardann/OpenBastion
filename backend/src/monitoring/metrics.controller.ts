import {
  Controller,
  Get,
  Res,
  UnauthorizedException,
  ServiceUnavailableException,
  Req,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response, Request } from 'express';
import * as crypto from 'node:crypto';
import { MetricsService } from './metrics.service';

const METRICS_TOKEN = process.env['METRICS_TOKEN'];
const NODE_ENV = process.env['NODE_ENV'] || 'development';

// SECURITY: enforce that production deployments configure METRICS_TOKEN.
// Without it, /metrics would otherwise be anonymous and leak runtime info.
if (NODE_ENV === 'production' && (!METRICS_TOKEN || METRICS_TOKEN.length < 16)) {
  throw new Error(
    'METRICS_TOKEN must be set (>= 16 chars) in production. ' +
      'Generate one with: openssl rand -hex 32',
  );
}

@Controller('metrics')
@SkipThrottle()
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private metrics: MetricsService) {}

  @Get()
  async getMetrics(@Req() req: Request, @Res() res: Response) {
    if (!METRICS_TOKEN) {
      // No-token deployments are refused rather than silently public.
      this.logger.warn(
        'Metrics scrape attempted without METRICS_TOKEN configured',
      );
      throw new ServiceUnavailableException(
        'Metrics endpoint disabled (METRICS_TOKEN unset)',
      );
    }

    const auth = req.headers['authorization'];
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();

    // Constant-time compare to avoid token-discovery via timing.
    const a = Buffer.from(token);
    const b = Buffer.from(METRICS_TOKEN);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }

    const data = await this.metrics.getMetrics();
    res.setHeader('Content-Type', this.metrics.getContentType());
    res.send(data);
  }
}
