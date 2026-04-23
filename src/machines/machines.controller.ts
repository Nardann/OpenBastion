import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Req,
  Patch,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MachinesService } from './machines.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RequireAccessLevel } from '../rbac/access-level.decorator';
import { Role, AccessLevel, Protocol } from '@prisma/client';
import { CreateMachineDto, UpdateMachineDto } from '../common/dto/security.dto';
import { AssignMachineGroupDto } from '../common/dto/machine-groups.dto';
import { ConfigService } from '../config/config.service';

const RDP_PROTOCOLS = [Protocol.RDP, Protocol.VNC];

@Controller('machines')
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
export class MachinesController {
  constructor(
    private readonly machinesService: MachinesService,
    private readonly config: ConfigService,
  ) {}

  private assertRdpAllowed(protocol?: string) {
    if (protocol && (RDP_PROTOCOLS as string[]).includes(protocol) && !this.config.isRdpEnabled()) {
      throw new BadRequestException(
        'Le protocole RDP/VNC est désactivé. Activez ENABLE_RDP=true et relancez avec --profile rdp.',
      );
    }
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() body: CreateMachineDto) {
    this.assertRdpAllowed(body.protocol);
    const { username, password, privateKey, ...machineData } = body;
    const secretData: {
      username: string;
      password?: string;
      privateKey?: string;
    } = { username };
    if (password) secretData.password = password;
    if (privateKey) secretData.privateKey = privateKey;

    return this.machinesService.createMachine(machineData as any, secretData);
  }

  @Post('probe-fingerprint')
  @Roles(Role.ADMIN)
  async probeFingerprint(@Body() body: { ip: string; port: number }) {
    try {
      const fingerprint = await this.machinesService.probeFingerprint(
        body.ip,
        body.port || 22,
      );
      return {
        fingerprint,
        warning:
          'Vérifiez cette empreinte manuellement avant de créer la machine. ' +
          'Ne confirmez que si elle correspond à ce que le serveur cible vous indique.',
      };
    } catch (e) {
      throw new BadRequestException(
        'Impossible de contacter le serveur SSH cible',
      );
    }
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMachineDto,
  ) {
    this.assertRdpAllowed(body.protocol);
    return this.machinesService.updateMachine(id, body);
  }

  @Patch(':id/assign-group')
  @Roles(Role.ADMIN)
  assignToGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignMachineGroupDto,
  ) {
    return this.machinesService.updateMachine(id, {
      machineGroupId: body.machineGroupId ?? null,
    });
  }

  @Get()
  @SkipThrottle()
  findAll(@Req() req: any) {
    return this.machinesService.findAllAccessible(req.user.sub, req.user.role);
  }

  @Get(':id')
  @SkipThrottle()
  @RequireAccessLevel(AccessLevel.VIEWER)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.machinesService.findOne(id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @RequireAccessLevel(AccessLevel.OWNER)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.machinesService.deleteMachine(id);
  }
}
