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
        fs.mkdirSync(RECORDINGS_PATH!, { recursive: true });
        this.logger.log(`Session recording enabled → ${RECORDINGS_PATH}`);
      } catch (e) {
        this.logger.error(`Cannot create recordings directory (${RECORDINGS_PATH}): ${(e as Error).message} — recordings disabled`);
        RECORDINGS_ENABLED = false;
      }
    } else {
      this.logger.log('Session recording disabled (RECORDINGS_ENABLED=false or RECORDINGS_PATH unset)');
    }
  }

  async start(opts: {
    sessionId: string;
    userId: string;
    machineId: string;
    cols: number;
    rows: number;
    title?: string;
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
      },
    });
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
