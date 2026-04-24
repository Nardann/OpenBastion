import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_LANGS = ['fr', 'en'];

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

  getDefaultLang(): string {
    const lang = this.cache['defaultLang'];
    return lang && ALLOWED_LANGS.includes(lang) ? lang : 'fr';
  }

  async setDefaultLang(lang: string): Promise<void> {
    if (!ALLOWED_LANGS.includes(lang)) throw new Error('Unsupported language');
    await this.set('defaultLang', lang);
  }
}
