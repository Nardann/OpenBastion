import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthProviderType } from '@prisma/client';
import { VaultService } from '../vault/vault.service';
import {
  AuthProviderCreateDto,
  AuthProviderUpdateDto,
  LdapProviderConfig,
  OidcProviderConfig,
} from './types/auth-provider.types';
import * as crypto from 'node:crypto';

type ProviderConfig = LdapProviderConfig | OidcProviderConfig;

@Injectable()
export class AuthProvidersService {
  private readonly logger = new Logger(AuthProvidersService.name);

  constructor(
    private prisma: PrismaService,
    private vaultService: VaultService,
  ) {}

  private encryptConfig(config: ProviderConfig, providerId: string): string {
    return this.vaultService.encrypt(
      JSON.stringify(config),
      `auth-provider:${providerId}`,
    );
  }

  decryptConfig(encrypted: unknown, providerId: string): ProviderConfig {
    const AES_GCM_PATTERN = /^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/;
    if (typeof encrypted !== 'string' || !AES_GCM_PATTERN.test(encrypted)) {
      this.logger.error(
        `SECURITY: Auth provider ${providerId} has unencrypted config. ` +
          `Manual re-encryption is required. Returning empty config.`,
      );
      return {} as ProviderConfig;
    }

    try {
      return JSON.parse(
        this.vaultService.decrypt(encrypted, `auth-provider:${providerId}`),
      ) as ProviderConfig;
    } catch (e) {
      this.logger.error(
        `SECURITY: Failed to decrypt config for provider ${providerId}: ${e}`,
      );
      return {} as ProviderConfig;
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

  async create(data: AuthProviderCreateDto) {
    const id = crypto.randomUUID();
    return this.prisma.authProvider.create({
      data: {
        id,
        name: data.name,
        type: data.type as AuthProviderType,
        config: this.encryptConfig(data.config, id),
      },
    });
  }

  async update(id: string, data: AuthProviderUpdateDto) {
    const updateData: Record<string, unknown> = {};
    if (data.config !== undefined) {
      updateData['config'] = this.encryptConfig(data.config, id);
    }
    if (data.enabled !== undefined) {
      updateData['enabled'] = data.enabled;
    }
    return this.prisma.authProvider.update({ where: { id }, data: updateData });
  }
}
