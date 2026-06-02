import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RECORDING_EXTENSION,
  RECORDING_DEFAULT_COLS,
  RECORDING_DEFAULT_ROWS,
  RECORDING_VERSION,
} from '../../common/constants/recording.constants';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const RECORDINGS_PATH = process.env['RECORDINGS_PATH'];
let RECORDINGS_ENABLED = RECORDINGS_PATH && process.env['RECORDINGS_ENABLED'] !== 'false';

interface ActiveRecording {
  stream: fs.WriteStream;
  filePath: string;
  startedAt: number;
}

@Injectable()
export class SessionRecorderService {
  private readonly logger = new Logger(SessionRecorderService.name);
  private readonly active = new Map<string, ActiveRecording>();

  constructor(private prisma: PrismaService) {
    if (RECORDINGS_ENABLED) {
      try {
        fs.mkdirSync(RECORDINGS_PATH!, { recursive: true, mode: 0o777 });
        try { fs.chmodSync(RECORDINGS_PATH!, 0o777); } catch { /* ignore if already set */ }
        this.logger.log(`Session recording enabled → ${RECORDINGS_PATH}`);
      } catch (e) {
        this.logger.error(`Cannot create recordings directory (${RECORDINGS_PATH}): ${(e as Error).message} — recordings disabled`);
        RECORDINGS_ENABLED = false;
      }
    } else {
      this.logger.log('Session recording disabled (RECORDINGS_ENABLED=false or RECORDINGS_PATH unset)');
    }
  }

  /** Check if recording is globally enabled (env-based). Protocol-level checks are in the gateways via SettingsService. */
  isEnabled(): boolean {
    return !!RECORDINGS_ENABLED;
  }

  async start(opts: {
    sessionId: string;
    userId: string;
    machineId: string;
    cols: number;
    rows: number;
    title?: string;
    protocol?: 'ssh' | 'rdp';
  }): Promise<void> {
    if (!RECORDINGS_ENABLED) return;

    const filePath = path.join(RECORDINGS_PATH!, `${opts.sessionId}${RECORDING_EXTENSION}`);
    const stream = fs.createWriteStream(filePath, { encoding: 'utf8', flags: 'w' });
    const startedAt = Date.now();

    const header = JSON.stringify({
      version: RECORDING_VERSION,
      width: opts.cols || RECORDING_DEFAULT_COLS,
      height: opts.rows || RECORDING_DEFAULT_ROWS,
      timestamp: Math.floor(startedAt / 1000),
      title: opts.title ?? `Session ${opts.sessionId}`,
    });
    stream.write(header + '\n');

    this.active.set(opts.sessionId, { stream, filePath, startedAt });

    await this.prisma.sessionRecording.create({
      data: {
        sessionId: opts.sessionId,
        userId: opts.userId,
        machineId: opts.machineId,
        filePath,
        protocol: opts.protocol ?? 'ssh',
      },
    });
  }

  /** Register an RDP recording that was written directly by the gateway (no stream in service). */
  async registerRdp(opts: {
    sessionId: string;
    userId: string;
    machineId: string;
    filePath: string;
  }): Promise<void> {
    if (!RECORDINGS_ENABLED) return;
    await this.prisma.sessionRecording.create({
      data: {
        sessionId: opts.sessionId,
        userId: opts.userId,
        machineId: opts.machineId,
        filePath: opts.filePath,
        protocol: 'rdp',
      },
    });
  }

  async finalizeRdp(sessionId: string): Promise<void> {
    try {
      const record = await this.prisma.sessionRecording.findUnique({ where: { sessionId } });
      if (!record) return;

      let sizeBytes = 0;
      let sha256: string | undefined;
      try {
        const stat = fs.statSync(record.filePath);
        sizeBytes = stat.size;
        const hash = crypto.createHash('sha256');
        const readable = fs.createReadStream(record.filePath);
        await new Promise<void>((resolve, reject) => {
          readable.on('data', (chunk) => hash.update(chunk));
          readable.on('end', resolve);
          readable.on('error', reject);
        });
        sha256 = hash.digest('hex');
      } catch {
        // file may not exist if recording failed
      }

      await this.prisma.sessionRecording.update({
        where: { sessionId },
        data: { sizeBytes, sha256: sha256 ?? null, endedAt: new Date() },
      });
    } catch (e) {
      this.logger.error(`Failed to finalise RDP recording ${sessionId}: ${(e as Error).message}`);
    }
  }

  /** Returns the set of sessionIds currently being recorded (not yet ended). */
  getActiveSessionIds(): Set<string> {
    return new Set(this.active.keys());
  }

  writeOutput(sessionId: string, data: string): void {
    const rec = this.active.get(sessionId);
    if (!rec) return;
    const ts = ((Date.now() - rec.startedAt) / 1000).toFixed(6);
    rec.stream.write(JSON.stringify([parseFloat(ts), 'o', data]) + '\n');
  }

  async end(sessionId: string): Promise<void> {
    const rec = this.active.get(sessionId);
    if (!rec) return;

    await new Promise<void>((resolve) => rec.stream.end(resolve));
    this.active.delete(sessionId);

    try {
      const stat = fs.statSync(rec.filePath);
      const hash = crypto.createHash('sha256');
      const readable = fs.createReadStream(rec.filePath);
      await new Promise<void>((resolve, reject) => {
        readable.on('data', (chunk) => hash.update(chunk));
        readable.on('end', resolve);
        readable.on('error', reject);
      });
      const sha256 = hash.digest('hex');

      await this.prisma.sessionRecording.update({
        where: { sessionId },
        data: { sizeBytes: stat.size, sha256, endedAt: new Date() },
      });
    } catch (e) {
      this.logger.error(`Failed to finalise recording ${sessionId}: ${(e as Error).message}`);
    }
  }
}
