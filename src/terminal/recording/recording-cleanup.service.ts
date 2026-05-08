import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { SessionRecorderService } from './session-recorder.service';
import { AuditService, AuditCategory } from '../../audit/audit.service';
import * as fs from 'node:fs/promises';

const BATCH_SIZE = 200;

@Injectable()
export class RecordingCleanupService {
  private readonly logger = new Logger(RecordingCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly recorder: SessionRecorderService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const retentionMs = this.settings.getRecordingRetentionMs();
    if (!retentionMs) return; // retention not configured → nothing to do

    const cutoff = new Date(Date.now() - retentionMs);
    const activeIds = this.recorder.getActiveSessionIds();

    this.logger.log(`Recording sweep: cutoff=${cutoff.toISOString()}, active=${activeIds.size}`);

    const candidates = await this.prisma.sessionRecording.findMany({
      where: {
        pinned: false,
        endedAt: { not: null, lt: cutoff },
        sessionId: { notIn: [...activeIds] },
      },
      orderBy: { startedAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, sessionId: true, filePath: true, machineId: true, userId: true },
    });

    if (candidates.length === 0) return;

    this.logger.log(`Recording sweep: deleting ${candidates.length} expired recording(s)`);

    for (const rec of candidates) {
      try {
        // Delete the file first; tolerate missing files (ENOENT)
        if (rec.filePath) {
          await fs.unlink(rec.filePath).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') throw err;
          });
        }

        await this.prisma.sessionRecording.delete({ where: { id: rec.id } });

        void this.audit.logAction(
          null,
          'RECORDING_AUTO_DELETED',
          {
            recordingId: rec.id,
            sessionId: rec.sessionId,
            machineId: rec.machineId,
            userId: rec.userId,
            reason: 'retention_policy',
            cutoff: cutoff.toISOString(),
          },
          undefined,
          'internal',
          AuditCategory.SYSTEM,
        );
      } catch (err) {
        this.logger.error(
          `Failed to delete recording ${rec.id} (session ${rec.sessionId}): ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`Recording sweep: done (${candidates.length} deleted)`);
  }
}
