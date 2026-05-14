import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  BadRequestException,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CreatePermissionDto } from './dto/permissions.dto';

@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PermissionsController {
  constructor(private prisma: PrismaService) {}

  @Get('machine/:machineId')
  @SkipThrottle()
  @Roles(Role.ADMIN)
  findByMachine(@Param('machineId', ParseUUIDPipe) machineId: string) {
    return this.prisma.permission.findMany({
      where: { machineId },
      include: {
        user: { select: { id: true, email: true, username: true } },
        group: { select: { id: true, name: true } },
      },
    });
  }

  @Get('machine-group/:machineGroupId')
  @SkipThrottle()
  @Roles(Role.ADMIN)
  findByMachineGroup(
    @Param('machineGroupId', ParseUUIDPipe) machineGroupId: string,
  ) {
    return this.prisma.permission.findMany({
      where: { machineGroupId },
      include: {
        user: { select: { id: true, email: true, username: true } },
        group: { select: { id: true, name: true } },
      },
    });
  }

  @Post()
  @Roles(Role.ADMIN)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async create(@Body() data: CreatePermissionDto) {
    // SECURITY FIX: Exactly one of userId or groupId must be provided (handled by DTO but good to double check)
    if ((!!data.userId && !!data.groupId) || (!data.userId && !data.groupId)) {
      throw new BadRequestException(
        'Exactly one of userId or groupId must be provided',
      );
    }

    // SECURITY FIX: Exactly one of machineId or machineGroupId must be provided
    if (
      (!!data.machineId && !!data.machineGroupId) ||
      (!data.machineId && !data.machineGroupId)
    ) {
      throw new BadRequestException(
        'Exactly one of machineId or machineGroupId must be provided',
      );
    }

    // Resolve User/Group if name/email provided
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (data.userId && !uuidRegex.test(data.userId)) {
      const user = await this.prisma.user.findFirst({
        where: { OR: [{ email: data.userId }, { username: data.userId }] },
        select: { id: true },
      });
      if (!user)
        throw new BadRequestException(`User "${data.userId}" not found`);
      data.userId = user.id;
    }

    if (data.groupId && !uuidRegex.test(data.groupId)) {
      const group = await this.prisma.group.findUnique({
        where: { name: data.groupId },
        select: { id: true },
      });
      if (!group)
        throw new BadRequestException(`Group "${data.groupId}" not found`);
      data.groupId = group.id;
    }

    // Verify Machine/MachineGroup existence
    if (data.machineId) {
      const machine = await this.prisma.machine.findUnique({
        where: { id: data.machineId },
        select: { id: true },
      });
      if (!machine)
        throw new BadRequestException(`Machine "${data.machineId}" not found`);
    }

    if (data.machineGroupId) {
      const machineGroup = await this.prisma.machineGroup.findUnique({
        where: { id: data.machineGroupId },
        select: { id: true },
      });
      if (!machineGroup)
        throw new BadRequestException(
          `Machine Group "${data.machineGroupId}" not found`,
        );
    }

    return this.prisma.permission.create({ data });
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.permission.delete({ where: { id } });
  }
}
