import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SettingsService } from './settings/settings.service';

@Controller()
export class AppController {
  constructor(private readonly settings: SettingsService) {}

  @Get('health')
  healthCheck(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @SkipThrottle()
  @Get('features')
  getFeatures(): { defaultLang: string } {
    return {
      defaultLang: this.settings.getDefaultLang(),
    };
  }
}
