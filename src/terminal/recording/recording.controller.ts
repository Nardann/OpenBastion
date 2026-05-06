import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  Req,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AuditCategory } from '../../audit/audit.service';
import type { Response } from 'express';
import * as fs from 'node:fs';

@UseGuards(JwtAuthGuard)
@Controller('recordings')
export class RecordingController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get()
  async list(
    @Req() req: any,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('userId') filterUserId?: string,
    @Query('machineId') filterMachineId?: string,
  ) {
    const isAdmin = req.user.role === Role.ADMIN && req.user.isAdminMode;
    const take = Math.min(Number(limit) || 20, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const where: Record<string, unknown> = { endedAt: { not: null } };

    if (!isAdmin) {
      where['userId'] = req.user.sub;
    } else {
      if (filterUserId) where['userId'] = filterUserId;
      if (filterMachineId) where['machineId'] = filterMachineId;
    }

    const [total, recordings] = await Promise.all([
      this.prisma.sessionRecording.count({ where }),
      this.prisma.sessionRecording.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          sessionId: true,
          userId: true,
          machineId: true,
          sizeBytes: true,
          sha256: true,
          startedAt: true,
          endedAt: true,
        },
      }),
    ]);

    const userIds = [...new Set(recordings.map((r) => r.userId))];
    const machineIds = [...new Set(recordings.map((r) => r.machineId))];

    const [users, machines] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, username: true },
      }),
      this.prisma.machine.findMany({
        where: { id: { in: machineIds } },
        select: { id: true, name: true },
      }),
    ]);

    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    const machineMap = Object.fromEntries(machines.map((m) => [m.id, m.name]));

    const items = recordings.map((r) => ({
      ...r,
      user: userMap[r.userId] ?? null,
      machineName: machineMap[r.machineId] ?? null,
    }));

    return { total, page: Number(page), items };
  }

  @Get(':id/metadata')
  async metadata(@Param('id') id: string, @Req() req: any) {
    const rec = await this.prisma.sessionRecording.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException();

    const isAdmin = req.user.role === Role.ADMIN && req.user.isAdminMode;
    if (!isAdmin && rec.userId !== req.user.sub) throw new ForbiddenException();

    return rec;
  }

  @Get(':id/stream')
  async stream(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const rec = await this.prisma.sessionRecording.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException();

    const isAdmin = req.user.role === Role.ADMIN && req.user.isAdminMode;
    if (!isAdmin && rec.userId !== req.user.sub) throw new ForbiddenException();

    if (!rec.filePath || !fs.existsSync(rec.filePath)) {
      throw new NotFoundException('Recording file not found');
    }

    // Audit: log every time a recording is consulted
    void this.audit.logAction(
      req.user.sub,
      'RECORDING_VIEWED',
      {
        recordingId: rec.id,
        sessionId: rec.sessionId,
        machineId: rec.machineId,
        recordingOwner: rec.userId,
        viewedByAdmin: isAdmin,
      },
      undefined,
      req.ip,
      AuditCategory.TERMINAL,
    );

    res.setHeader('Content-Type', 'application/x-asciicast');
    res.setHeader('Cache-Control', 'no-store');

    const fileStream = fs.createReadStream(rec.filePath);
    fileStream.pipe(res);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Get('admin/all')
  async adminList(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('userId') userId?: string,
    @Query('machineId') machineId?: string,
  ) {
    const take = Math.min(Number(limit) || 20, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const where: Record<string, unknown> = {};
    if (userId) where['userId'] = userId;
    if (machineId) where['machineId'] = machineId;

    const [total, items] = await Promise.all([
      this.prisma.sessionRecording.count({ where }),
      this.prisma.sessionRecording.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take,
        skip,
      }),
    ]);

    return { total, page: Number(page), items };
  }
}
