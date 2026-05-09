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
  ForbiddenException,
} from '@nestjs/common';
import * as net from 'node:net';
import * as dns from 'node:dns/promises';
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
    if (!body?.ip || typeof body.ip !== 'string' || body.ip.length > 255) {
      throw new BadRequestException('IP/host invalide');
    }
    const port = Number(body.port || 22);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException('Port invalide');
    }

    // SECURITY: prevent SSRF / internal port-scan via this admin endpoint.
    // Resolve the target and reject any address belonging to internal/
    // metadata/loopback ranges. Also block container service hostnames the
    // backend can reach but the operator should never SSH into.
    await this.assertProbeTargetAllowed(body.ip, port);

    try {
      const fingerprint = await this.machinesService.probeFingerprint(
        body.ip,
        port,
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

  private async assertProbeTargetAllowed(target: string, port: number): Promise<void> {
    const HOST_DENY = new Set([
      'localhost',
      'postgres',
      'guacd',
      'backend',
      'frontend',
      'bastion-postgres',
      'bastion-guacd',
      'bastion-backend',
      'bastion-frontend',
      'host.docker.internal',
    ]);
    if (HOST_DENY.has(target.toLowerCase())) {
      throw new ForbiddenException(
        'Cible interne refusée (boucle locale ou service interne du bastion)',
      );
    }

    // Ports privilégiés autres que 22 → suspect, refusés.
    if (port < 1024 && port !== 22) {
      throw new ForbiddenException(
        'Seul le port 22 est autorisé pour les ports privilégiés',
      );
    }

    let candidates: string[];
    if (net.isIP(target)) {
      candidates = [target];
    } else {
      try {
        const records = await dns.lookup(target, { all: true });
        candidates = records.map((r) => r.address);
      } catch {
        throw new BadRequestException('Impossible de résoudre le nom DNS');
      }
    }

    for (const ip of candidates) {
      if (this.isPrivateOrReservedIp(ip)) {
        throw new ForbiddenException(
          `Cible interne refusée: ${ip} (RFC1918 / loopback / link-local / metadata)`,
        );
      }
    }
  }

  private isPrivateOrReservedIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number);
      const [a, b] = parts;
      if (a === 10) return true;                          // 10.0.0.0/8
      if (a === 127) return true;                         // 127.0.0.0/8 loopback
      if (a === 169 && b === 254) return true;            // 169.254.0.0/16 link-local + AWS metadata
      if (a === 172 && b! >= 16 && b! <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true;            // 192.168.0.0/16
      if (a === 100 && b! >= 64 && b! <= 127) return true;// 100.64.0.0/10 CGNAT
      if (a === 0) return true;                           // 0.0.0.0/8
      if (a! >= 224) return true;                         // multicast + reserved
      return false;
    }
    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      if (lower === '::1' || lower === '::') return true;
      if (lower.startsWith('fe80:')) return true;          // link-local
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
      if (lower.startsWith('ff')) return true;             // multicast
      // IPv4-mapped IPv6 like ::ffff:127.0.0.1
      const m = lower.match(/^::ffff:([0-9.]+)$/);
      if (m && net.isIPv4(m[1]!)) return this.isPrivateOrReservedIp(m[1]!);
      return false;
    }
    return true;
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
  @SkipThrottle({ user: true })
  findAll(@Req() req: any) {
    return this.machinesService.findAllAccessible(req.user.sub, req.user.role);
  }

  @Get(':id')
  @SkipThrottle({ user: true })
  @RequireAccessLevel(AccessLevel.VIEWER)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.machinesService.findOne(id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.machinesService.deleteMachine(id);
  }
}
