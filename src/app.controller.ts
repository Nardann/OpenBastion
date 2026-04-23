import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from './config/config.service';

@Controller()
export class AppController {
  constructor(private readonly config: ConfigService) {}

  @Get('health')
  healthCheck(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @SkipThrottle()
  @Get('features')
  getFeatures(): { rdp: boolean } {
    return { rdp: this.config.isRdpEnabled() };
  }
}
