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
import * as ipaddr from 'ipaddr.js';
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

  /**
   * SECURITY (F-05 fix): canonicalise the address through `ipaddr.js`
   * before classification, so that all equivalent representations of the
   * same destination map to the same answer:
   *
   *   ::ffff:127.0.0.1   →  loopback
   *   ::ffff:7f00:1      →  loopback   (was a bypass before this fix —
   *                                     the old hand-rolled regex only
   *                                     accepted decimal-dotted form)
   *   2002:7f00:1::      →  6to4 wrapping a private IPv4
   *   ::1                →  loopback
   *
   * `range()` returns a category like 'unicast', 'loopback', 'private',
   * 'linkLocal', 'uniqueLocal', 'multicast', 'reserved', etc. We block
   * everything that isn't a public unicast, with one extra rule for AWS
   * metadata (169.254.169.254) which is reported as 'linkLocal' by
   * ipaddr.js — already covered.
   */
  private isPrivateOrReservedIp(ip: string): boolean {
    if (!ipaddr.isValid(ip)) return true; // unparseable → fail closed
    let parsed: ipaddr.IPv4 | ipaddr.IPv6 = ipaddr.parse(ip);

    // Unwrap IPv4-mapped IPv6 to the underlying IPv4 so the IPv4 ranges
    // (RFC 1918, CGNAT, loopback) are consistently applied.
    if (parsed.kind() === 'ipv6') {
      const v6 = parsed as ipaddr.IPv6;
      if (v6.isIPv4MappedAddress()) {
        parsed = v6.toIPv4Address();
      }
    }

    const range = parsed.range(); // string label
    const blockedRanges = new Set<string>([
      'unspecified',     // 0.0.0.0 / ::
      'broadcast',       // 255.255.255.255
      'multicast',       // 224.0.0.0/4 / ff00::/8
      'linkLocal',       // 169.254/16 / fe80::/10  (incl. AWS metadata)
      'loopback',        // 127/8 / ::1
      'carrierGradeNat', // 100.64/10
      'private',         // 10/8, 172.16/12, 192.168/16
      'uniqueLocal',     // fc00::/7
      'ipv4Mapped',      // ::ffff:0:0/96 (should already be unwrapped)
      'rfc6145',         // 64:ff9b::/96
      'rfc6052',         // 64:ff9b::/96 alias
      '6to4',            // 2002::/16
      'teredo',          // 2001::/32
      'reserved',        // misc reserved blocks
    ]);
    return blockedRanges.has(range);
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
