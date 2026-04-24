import { Controller, Get, Patch, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { IsIn, IsString } from 'class-validator';

class SetLangDto {
  @IsString()
  @IsIn(['fr', 'en'])
  lang!: string;
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
}
