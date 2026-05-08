import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_LANGS = ['fr', 'en'];
const ALLOWED_RETENTION_UNITS = ['hour', 'day', 'month', 'year'] as const;
type RetentionUnit = typeof ALLOWED_RETENTION_UNITS[number];

const UNIT_TO_MS: Record<RetentionUnit, number> = {
  hour:  3_600_000,
  day:   86_400_000,
  month: 30 * 86_400_000,
  year:  365 * 86_400_000,
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache: Record<string, string> = {};

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    const rows = await this.prisma.globalSetting.findMany();
    for (const row of rows) this.cache[row.key] = row.value;
    if (!this.cache['defaultLang']) this.cache['defaultLang'] = process.env.DEFAULT_LANG || 'fr';
  }

  get(key: string): string {
    return this.cache[key] ?? '';
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.globalSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    this.cache[key] = value;
  }

  // ── Language ──────────────────────────────────────────────────────────────

  getDefaultLang(): string {
    const lang = this.cache['defaultLang'];
    return lang && ALLOWED_LANGS.includes(lang) ? lang : 'fr';
  }

  async setDefaultLang(lang: string): Promise<void> {
    if (!ALLOWED_LANGS.includes(lang)) throw new BadRequestException('Unsupported language');
    await this.set('defaultLang', lang);
  }

  // ── Recording retention ───────────────────────────────────────────────────

  getRecordingRetention(): { value: number; unit: RetentionUnit } | null {
    const raw = this.cache['recordingRetentionValue'];
    const unit = this.cache['recordingRetentionUnit'] as RetentionUnit | undefined;
    if (!raw || !unit || !ALLOWED_RETENTION_UNITS.includes(unit)) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return null;
    return { value, unit };
  }

  /** Returns retention in milliseconds, or null if disabled (no retention configured). */
  getRecordingRetentionMs(): number | null {
    const retention = this.getRecordingRetention();
    if (!retention) return null;
    return retention.value * UNIT_TO_MS[retention.unit];
  }

  async setRecordingRetention(value: number, unit: string): Promise<void> {
    if (!ALLOWED_RETENTION_UNITS.includes(unit as RetentionUnit)) {
      throw new BadRequestException(`Unit must be one of: ${ALLOWED_RETENTION_UNITS.join(', ')}`);
    }
    if (!Number.isFinite(value) || value < 1 || value > 365) {
      throw new BadRequestException('Value must be between 1 and 365');
    }
    await Promise.all([
      this.set('recordingRetentionValue', String(value)),
      this.set('recordingRetentionUnit', unit),
    ]);
  }

  async clearRecordingRetention(): Promise<void> {
    await this.prisma.globalSetting.deleteMany({
      where: { key: { in: ['recordingRetentionValue', 'recordingRetentionUnit'] } },
    });
    delete this.cache['recordingRetentionValue'];
    delete this.cache['recordingRetentionUnit'];
  }
}
