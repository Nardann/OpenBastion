import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  /**
   * Simple configuration service that relies on process.env.
   * Environment variables are managed by Docker or the Node runtime.
   */
  get(key: string): string {
    const value = process.env[key];
    return value ?? '';
  }

  getOrThrow(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`Env var "${key}" is required but not set`);
    return value;
  }
}
