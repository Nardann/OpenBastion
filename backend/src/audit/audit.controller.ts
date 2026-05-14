import {
  Controller,
  Get,
  UseGuards,
  Query,
  BadRequestException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuditService, AuditCategory } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @SkipThrottle()
  @Roles(Role.ADMIN)
  async getLogs(
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = Math.min(limit ? parseInt(limit, 10) : 50, 200);
    if (isNaN(pageNumber) || pageNumber < 1)
      throw new BadRequestException('Page invalide');
    if (isNaN(limitNumber) || limitNumber < 1)
      throw new BadRequestException('Limit invalide');

    if (
      category &&
      !Object.values(AuditCategory).includes(category as AuditCategory)
    ) {
      throw new BadRequestException(`Catégorie d'audit invalide: ${category}`);
    }

    return this.auditService.getLogs(category, pageNumber, limitNumber);
  }

  @Get('verify-integrity')
  @Roles(Role.ADMIN)
  async verifyIntegrity(
    @Query('limit', new DefaultValuePipe(1000), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 10_000);
    return this.auditService.verifyIntegrity(safeLimit);
  }
}
