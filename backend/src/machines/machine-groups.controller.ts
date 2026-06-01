import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MachineGroupsService } from './machine-groups.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import {
  CreateMachineGroupDto,
  UpdateMachineGroupDto,
} from '../common/dto/machine-groups.dto';
import { AuditService, AuditCategory } from '../audit/audit.service';

@Controller('machine-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MachineGroupsController {
  constructor(
    private readonly machineGroupsService: MachineGroupsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() data: CreateMachineGroupDto, @Req() req: any) {
    const created = await this.machineGroupsService.create(data);
    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'MACHINE_GROUP: CREATED',
      category: AuditCategory.MACHINE_GROUP,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { machineGroupId: created.id, name: created.name },
      entities: { machineGroups: [created.id] },
    });
    return created;
  }

  @Get()
  @SkipThrottle()
  findAll(@Req() req: any) {
    return this.machineGroupsService.findAllAccessible(
      req.user.sub,
      req.user.role,
    );
  }

  @Get(':id')
  @SkipThrottle()
  @Roles(Role.ADMIN)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.machineGroupsService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() data: UpdateMachineGroupDto,
    @Req() req: any,
  ) {
    const result = await this.machineGroupsService.update(id, data);
    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'MACHINE_GROUP: UPDATED',
      category: AuditCategory.MACHINE_GROUP,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { machineGroupId: id, fields: Object.keys(data) },
      entities: { machineGroups: [id] },
    });
    return result;
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Param('id') id: string, @Req() req: any) {
    const result = await this.machineGroupsService.remove(id);
    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'MACHINE_GROUP: DELETED',
      category: AuditCategory.MACHINE_GROUP,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { machineGroupId: id, name: (result as any)?.name ?? null },
      entities: { machineGroups: [id] },
    });
    return result;
  }
}
