import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthProviderType } from '@prisma/client';
import { VaultService } from '../vault/vault.service';
import * as crypto from 'node:crypto';

@Injectable()
export class AuthProvidersService {
  private readonly logger = new Logger(AuthProvidersService.name);

  constructor(
    private prisma: PrismaService,
    private vaultService: VaultService,
  ) {}

  private encryptConfig(config: any, providerId: string): string {
    return this.vaultService.encrypt(
      JSON.stringify(config),
      `auth-provider:${providerId}`,
    );
  }

  private decryptConfig(encrypted: any, providerId: string): any {
    if (typeof encrypted !== 'string' || !encrypted.includes(':')) {
      // HIGH-03 FIX: Critical alert for unencrypted config, refuse to serve
      this.logger.error(
        `SECURITY: Auth provider ${providerId} has unencrypted config. ` +
          `Manual re-encryption is required. Returning empty config.`,
      );
      return {};
    }

    try {
      return JSON.parse(
        this.vaultService.decrypt(encrypted, `auth-provider:${providerId}`),
      );
    } catch (e) {
      this.logger.error(
        `SECURITY: Failed to decrypt config for provider ${providerId}: ${e}`,
      );
      return {};
    }
  }

  async findAllEnabled() {
    const providers = await this.prisma.authProvider.findMany({
      where: { enabled: true },
    });
    return providers.map((p) => ({
      ...p,
      config: this.decryptConfig(p.config, p.id),
    }));
  }

  async findByType(type: AuthProviderType) {
    const provider = await this.prisma.authProvider.findFirst({
      where: { type, enabled: true },
    });
    if (!provider) return null;
    return {
      ...provider,
      config: this.decryptConfig(provider.config, provider.id),
    };
  }

  async create(data: { name: string; type: AuthProviderType; config: any }) {
    const id = crypto.randomUUID();
    return this.prisma.authProvider.create({
      data: {
        id,
        ...data,
        config: this.encryptConfig(data.config, id),
      },
    });
  }

  async update(id: string, data: any) {
    if (data.config) {
      data.config = this.encryptConfig(data.config, id);
    }
    return this.prisma.authProvider.update({
      where: { id },
      data,
    });
  }
}
