import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from './config/config.service';
import { SettingsService } from './settings/settings.service';

@Controller()
export class AppController {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  @Get('health')
  healthCheck(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @SkipThrottle()
  @Get('features')
  getFeatures(): { rdp: boolean; defaultLang: string } {
    return {
      rdp: this.config.isRdpEnabled(),
      defaultLang: this.settings.getDefaultLang(),
    };
  }
}
