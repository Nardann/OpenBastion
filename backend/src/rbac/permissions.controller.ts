import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from './rbac.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, AccessLevel } from '@prisma/client';
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
    private rbac: RbacService,
    private audit: AuditService,
  ) {}

  /**
   * Returns true if the caller is a global admin, otherwise asserts that they
   * hold the OWNER access level on the given machine (throws if not). Lets a
   * machine owner manage that machine's permissions from the dashboard "edit
   * mode" without being a global admin.
   */
  private async assertMachineManager(
    req: any,
    machineId: string,
  ): Promise<boolean> {
    if (req.user?.role === 'ADMIN') return true;
    const owner = await this.rbac.hasAccess(
      req.user.sub,
      machineId,
      AccessLevel.OWNER,
    );
    if (!owner) {
      throw new ForbiddenException('You must be OWNER of this machine');
    }
    return false;
  }

  /**
   * Anti-lockout / anti-escalation guard for non-admin owners: they may never
   * touch their OWN permission, nor the permission of a group they belong to
   * (the group they may inherit their owner status from).
   */
  private async assertTargetAllowedForOwner(
    actorId: string,
    target: { userId?: string | null; groupId?: string | null },
  ): Promise<void> {
    if (target.userId && target.userId === actorId) {
      throw new ForbiddenException('You cannot change your own access level');
    }
    if (target.groupId) {
      const member = await this.prisma.group.findFirst({
        where: { id: target.groupId, users: { some: { id: actorId } } },
        select: { id: true },
      });
      if (member) {
        throw new ForbiddenException(
          'You cannot change the access of a group you belong to',
        );
      }
    }
  }

  /** Caller must be admin OR own at least one machine (directory access). */
  private async assertOwnerOrAdmin(req: any): Promise<void> {
    if (req.user?.role === 'ADMIN') return;
    const count = await this.prisma.permission.count({
      where: {
        level: AccessLevel.OWNER,
        OR: [
          { userId: req.user.sub },
          { group: { users: { some: { id: req.user.sub } } } },
        ],
      },
    });
    if (count === 0) {
      throw new ForbiddenException('Owner access required');
    }
  }

  // Minimal directory search so machine owners (not just admins) can find
  // users/groups to grant permissions to. Returns only id + display fields.
  @Get('directory/users')
  @SkipThrottle()
  async searchUsers(@Query('q') q: string, @Req() req: any) {
    await this.assertOwnerOrAdmin(req);
    const query = (q ?? '').trim();
    if (query.length < 1) return [];
    return this.prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, username: true },
      take: 10,
    });
  }

  @Get('directory/groups')
  @SkipThrottle()
  async searchGroups(@Query('q') q: string, @Req() req: any) {
    await this.assertOwnerOrAdmin(req);
    const query = (q ?? '').trim();
    if (query.length < 1) return [];
    return this.prisma.group.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      select: { id: true, name: true, description: true },
      take: 10,
    });
  }

  @Get('machine/:machineId')
  @SkipThrottle()
  async findByMachine(
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Req() req: any,
  ) {
    await this.assertMachineManager(req, machineId);
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
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async create(@Body() data: CreatePermissionDto, @Req() req: any) {
    const isAdmin = req.user?.role === 'ADMIN';

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

    // Non-admin authorization: a machine OWNER may only manage MACHINE-scoped
    // permissions on machines they own, and may never change their own access
    // nor that of a group they belong to (anti-lockout / anti-escalation).
    if (!isAdmin) {
      if (data.machineGroupId) {
        throw new ForbiddenException(
          'Only admins can manage machine-group permissions',
        );
      }
      await this.assertMachineManager(req, data.machineId!);
      await this.assertTargetAllowedForOwner(req.user.sub, {
        userId: data.userId ?? null,
        groupId: data.groupId ?? null,
      });
    }

    // Upsert semantics: if a permission already exists for this exact
    // target/scope pair, update its level instead of failing the unique
    // constraint. This lets the "edit mode" UI change an existing role.
    const existingPerm = await this.prisma.permission.findFirst({
      where: {
        userId: data.userId ?? null,
        groupId: data.groupId ?? null,
        machineId: data.machineId ?? null,
        machineGroupId: data.machineGroupId ?? null,
      },
      select: { id: true },
    });

    const permission = existingPerm
      ? await this.prisma.permission.update({
          where: { id: existingPerm.id },
          data: { level: data.level },
        })
      : await this.prisma.permission.create({ data });

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
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    // Read the row before deletion so the audit log knows what was revoked.
    const existing = await this.prisma.permission.findUnique({ where: { id } });

    // Non-admin authorization: machine OWNERs may only revoke MACHINE-scoped
    // permissions on machines they own, and never their own or a group they
    // belong to (anti-lockout / anti-escalation).
    if (req.user?.role !== 'ADMIN') {
      if (!existing) {
        throw new ForbiddenException('Owner access required');
      }
      if (!existing.machineId) {
        throw new ForbiddenException(
          'Only admins can manage machine-group permissions',
        );
      }
      await this.assertMachineManager(req, existing.machineId);
      await this.assertTargetAllowedForOwner(req.user.sub, {
        userId: existing.userId,
        groupId: existing.groupId,
      });
    }

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
