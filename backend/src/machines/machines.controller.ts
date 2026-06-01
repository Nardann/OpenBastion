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
import { AuditService, AuditCategory } from '../audit/audit.service';

const RDP_PROTOCOLS = [Protocol.RDP, Protocol.VNC];

@Controller('machines')
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
export class MachinesController {
  constructor(
    private readonly machinesService: MachinesService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
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
  async create(@Body() body: CreateMachineDto, @Req() req: any) {
    this.assertRdpAllowed(body.protocol);
    const { username, password, privateKey, ...machineData } = body;
    const secretData: {
      username: string;
      password?: string;
      privateKey?: string;
    } = { username };
    if (password) secretData.password = password;
    if (privateKey) secretData.privateKey = privateKey;

    const machine = await this.machinesService.createMachine(
      machineData as any,
      secretData,
    );

    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'MACHINE: CREATED',
      category: AuditCategory.MACHINE,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: {
        machineId: machine.id,
        name: machine.name,
        ip: machine.ip,
        port: machine.port,
        protocol: machine.protocol,
        hasPrivateKey: !!privateKey,
        sshUsername: username,
      },
      entities: {
        machines: [machine.id],
        ...(machine.machineGroupId ? { machineGroups: [machine.machineGroupId] } : {}),
      },
    });

    return machine;
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
    // SECURITY: bastion semantics — we ALLOW private RFC1918 / unique-local
    // IPv6 / public Internet (that is the product's purpose), and we BLOCK
    // dangerous ranges that should never be SSH-probed:
    //   - loopback                 (127/8, ::1)        — bastion itself
    //   - link-local + cloud meta  (169.254/16, fe80::/10) — IAM creds
    //   - carrier-grade NAT        (100.64/10)
    //   - multicast / broadcast / unspecified / reserved
    //   - 6to4 / teredo / rfc6052 / ipv4Mapped wrappings that smuggle a
    //     loopback IPv4 inside an IPv6 address
    //
    // Internal Docker services are blocked separately by hostname.
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
        'Cible interne refusée (service interne du bastion)',
      );
    }

    if (port < 1024 && port !== 22) {
      throw new ForbiddenException(
        'Seul le port 22 est autorisé pour les ports privilégiés',
      );
    }

    // Resolve hostname → list of IPs, then check each. Direct IPs are
    // checked as-is.
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
      if (this.isDangerousIp(ip)) {
        throw new ForbiddenException(
          `Cible refusée: ${ip} (loopback / link-local / metadata cloud / multicast)`,
        );
      }
    }
  }

  /**
   * Returns true ONLY for ranges that should never be SSH-probed (loopback,
   * link-local incl. cloud metadata, CGNAT, multicast/broadcast/reserved,
   * and IPv6 wrappings that hide a loopback IPv4).
   *
   * Returns false (allowed) for:
   *   - private RFC1918 (10/8, 172.16/12, 192.168/16)  — bastion targets
   *   - unique-local IPv6 (fc00::/7)                    — bastion targets
   *   - public unicast IPv4 + IPv6                      — bastion targets
   *
   * Canonicalisation via ipaddr.js makes hex IPv4-mapped IPv6 forms
   * (`::ffff:7f00:1` == `127.0.0.1`) be classified through the unwrapped
   * IPv4 — no bypass.
   */
  private isDangerousIp(ip: string): boolean {
    if (!ipaddr.isValid(ip)) return true; // unparseable → fail closed
    let parsed: ipaddr.IPv4 | ipaddr.IPv6 = ipaddr.parse(ip);

    if (parsed.kind() === 'ipv6') {
      const v6 = parsed as ipaddr.IPv6;
      if (v6.isIPv4MappedAddress()) {
        parsed = v6.toIPv4Address();
      }
    }

    const dangerous = new Set<string>([
      'unspecified',
      'broadcast',
      'multicast',
      'linkLocal',
      'loopback',
      'carrierGradeNat',
      'ipv4Mapped',
      'rfc6145',
      'rfc6052',
      '6to4',
      'teredo',
      'reserved',
    ]);
    return dangerous.has(parsed.range());
  }


  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMachineDto,
    @Req() req: any,
  ) {
    this.assertRdpAllowed(body.protocol);
    const result = await this.machinesService.updateMachine(id, body);

    // List fields touched (without their values — values may contain
    // secrets that the interceptor already strips, but we don't want them
    // duplicated here either).
    const fields = Object.keys(body);

    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'MACHINE: UPDATED',
      category: AuditCategory.MACHINE,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { machineId: id, name: result.name, fields },
      entities: {
        machines: [id],
        ...(result.machineGroupId ? { machineGroups: [result.machineGroupId] } : {}),
      },
    });

    return result;
  }

  @Patch(':id/assign-group')
  @Roles(Role.ADMIN)
  async assignToGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignMachineGroupDto,
    @Req() req: any,
  ) {
    const result = await this.machinesService.updateMachine(id, {
      machineGroupId: body.machineGroupId ?? null,
    });

    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: body.machineGroupId
        ? 'MACHINE: ASSIGNED_TO_GROUP'
        : 'MACHINE: REMOVED_FROM_GROUP',
      category: AuditCategory.MACHINE,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: {
        machineId: id,
        machineGroupId: body.machineGroupId ?? null,
      },
      entities: {
        machines: [id],
        ...(body.machineGroupId ? { machineGroups: [body.machineGroupId] } : {}),
      },
    });

    return result;
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
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const result = await this.machinesService.deleteMachine(id);

    await this.audit.log({
      actorId: req.user?.sub ?? null,
      action: 'MACHINE: DELETED',
      category: AuditCategory.MACHINE,
      authMethod: req.user?.authMethod ?? null,
      ipAddress: req.ip,
      details: { machineId: id, name: (result as any)?.name ?? null },
      entities: { machines: [id] },
    });

    return result;
  }
}
