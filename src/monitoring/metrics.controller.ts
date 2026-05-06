import { Controller, Get, Res, UnauthorizedException, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response, Request } from 'express';
import { MetricsService } from './metrics.service';

const METRICS_TOKEN = process.env['METRICS_TOKEN'];

@Controller('metrics')
@SkipThrottle()
export class MetricsController {
  constructor(private metrics: MetricsService) {}

  @Get()
  async getMetrics(@Req() req: Request, @Res() res: Response) {
    if (METRICS_TOKEN) {
      const auth = req.headers['authorization'];
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
      if (token !== METRICS_TOKEN) throw new UnauthorizedException();
    }

    const data = await this.metrics.getMetrics();
    res.setHeader('Content-Type', this.metrics.getContentType());
    res.send(data);
  }
}
