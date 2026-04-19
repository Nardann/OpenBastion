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

@Controller('machine-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MachineGroupsController {
  constructor(private readonly machineGroupsService: MachineGroupsService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() data: CreateMachineGroupDto) {
    return this.machineGroupsService.create(data);
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
  findOne(@Param('id') id: string) {
    return this.machineGroupsService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(@Param('id') id: string, @Body() data: UpdateMachineGroupDto) {
    return this.machineGroupsService.update(id, data);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Param('id') id: string) {
    return this.machineGroupsService.remove(id);
  }
}
