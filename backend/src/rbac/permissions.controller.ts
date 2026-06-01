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
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CreatePermissionDto } from './dto/permissions.dto';
import {
  AuditService,
  AuditCategory,
  AuditEntities,
} from '../audit/audit.service';

@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PermissionsController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

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
  async create(@Body() data: CreatePermissionDto, @Req() req: any) {
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

    const permission = await this.prisma.permission.create({ data });

    const entities: AuditEntities = { permissions: [permission.id] };
    if (data.userId) entities.users = [data.userId];
    if (data.groupId) entities.groups = [data.groupId];
    if (data.machineId) entities.machines = [data.machineId];
    if (data.machineGroupId) entities.machineGroups = [data.machineGroupId];

    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'PERMISSION: GRANTED',
      category: AuditCategory.PERMISSION,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: {
        permissionId: permission.id,
        level: permission.level,
        scope: data.machineId ? 'MACHINE' : 'MACHINE_GROUP',
        target: data.userId ? 'USER' : 'GROUP',
      },
      entities,
    });

    return permission;
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    // Read the row before deletion so the audit log knows what was revoked.
    const existing = await this.prisma.permission.findUnique({ where: { id } });
    const result = await this.prisma.permission.delete({ where: { id } });

    const entities: AuditEntities = { permissions: [id] };
    if (existing?.userId) entities.users = [existing.userId];
    if (existing?.groupId) entities.groups = [existing.groupId];
    if (existing?.machineId) entities.machines = [existing.machineId];
    if (existing?.machineGroupId) entities.machineGroups = [existing.machineGroupId];

    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'PERMISSION: REVOKED',
      category: AuditCategory.PERMISSION,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: {
        permissionId: id,
        level: existing?.level ?? null,
        scope: existing?.machineId ? 'MACHINE' : 'MACHINE_GROUP',
        target: existing?.userId ? 'USER' : 'GROUP',
      },
      entities,
    });

    return result;
  }
}
