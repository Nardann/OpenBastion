import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Patch,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AuditService, AuditCategory } from '../audit/audit.service';

@Controller('groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GroupsController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get()
  @SkipThrottle()
  @Roles(Role.ADMIN)
  findAll() {
    return this.prisma.group.findMany({
      include: {
        users: {
          select: { id: true, email: true, username: true },
        },
        _count: {
          select: { users: true },
        },
      },
    });
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(
    @Body() data: { name: string; description?: string },
    @Req() req: any,
  ) {
    const created = await this.prisma.group.create({ data });
    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'GROUP: CREATED',
      category: AuditCategory.GROUP,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { groupId: created.id, name: created.name },
      entities: { groups: [created.id] },
    });
    return created;
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() data: { name?: string; description?: string },
    @Req() req: any,
  ) {
    const result = await this.prisma.group.update({
      where: { id },
      data,
    });
    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'GROUP: UPDATED',
      category: AuditCategory.GROUP,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { groupId: id, fields: Object.keys(data) },
      entities: { groups: [id] },
    });
    return result;
  }

  @Post(':id/users')
  @Roles(Role.ADMIN)
  async addUser(
    @Param('id') id: string,
    @Body() data: { userId: string },
    @Req() req: any,
  ) {
    const result = await this.prisma.group.update({
      where: { id },
      data: {
        users: {
          connect: { id: data.userId },
        },
      },
    });
    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'GROUP: USER_ADDED',
      category: AuditCategory.GROUP,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { groupId: id, userId: data.userId },
      entities: { groups: [id], users: [data.userId] },
    });
    return result;
  }

  @Delete(':id/users/:userId')
  @Roles(Role.ADMIN)
  async removeUser(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: any,
  ) {
    const result = await this.prisma.group.update({
      where: { id },
      data: {
        users: {
          disconnect: { id: userId },
        },
      },
    });
    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'GROUP: USER_REMOVED',
      category: AuditCategory.GROUP,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { groupId: id, userId },
      entities: { groups: [id], users: [userId] },
    });
    return result;
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Param('id') id: string, @Req() req: any) {
    const result = await this.prisma.group.delete({ where: { id } });
    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'GROUP: DELETED',
      category: AuditCategory.GROUP,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { groupId: id, name: (result as any)?.name ?? null },
      entities: { groups: [id] },
    });
    return result;
  }
}
