import { Controller, Get, Patch, Delete, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { IsIn, IsString, IsInt, Min, Max } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';

class SetLangDto {
  @IsString()
  @IsIn(['fr', 'en'])
  lang!: string;
}

class SetRetentionDto {
  @IsInt()
  @Min(1)
  @Max(365)
  value!: number;

  @IsString()
  @IsIn(['hour', 'day', 'month', 'year'])
  unit!: string;
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('public')
  getPublic() {
    return { defaultLang: this.settings.getDefaultLang() };
  }

  @Patch('lang')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async setLang(@Body() body: SetLangDto) {
    try {
      await this.settings.setDefaultLang(body.lang);
      return { defaultLang: body.lang };
    } catch {
      throw new BadRequestException('Langue non supportée');
    }
  }

  // ── Recording retention ───────────────────────────────────────────────────

  @Get('recording-retention')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @SkipThrottle({ user: true })
  getRetention() {
    const retention = this.settings.getRecordingRetention();
    return retention ?? { value: null, unit: null };
  }

  @Patch('recording-retention')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async setRetention(@Body() body: SetRetentionDto) {
    await this.settings.setRecordingRetention(body.value, body.unit);
    return { value: body.value, unit: body.unit };
  }

  @Delete('recording-retention')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async clearRetention() {
    await this.settings.clearRecordingRetention();
    return { value: null, unit: null };
  }
}
