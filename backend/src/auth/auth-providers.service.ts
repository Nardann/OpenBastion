import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthProviderType, Prisma } from '@prisma/client';
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

  /**
   * Public, anonymous list shown on the login page. Returns only the
   * minimum needed to render a provider picker — never any secret. Includes
   * an `issuerHost` hint for OIDC so the login UI can display "Sign in via
   * keycloak.acme.com".
   */
  async findAllPublic(): Promise<
    Array<{
      id: string;
      name: string;
      type: AuthProviderType;
      enabled: boolean;
      issuerHost?: string;
    }>
  > {
    const providers = await this.prisma.authProvider.findMany({
      where: { enabled: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return providers.map((p) => {
      const out: {
        id: string;
        name: string;
        type: AuthProviderType;
        enabled: boolean;
        issuerHost?: string;
      } = {
        id: p.id,
        name: p.name,
        type: p.type,
        enabled: p.enabled,
      };
      if (p.type === 'OIDC') {
        const cfg = this.decryptConfig(p.config, p.id) as OidcProviderConfig;
        if (cfg?.issuer) {
          try {
            out.issuerHost = new URL(cfg.issuer).hostname;
          } catch {
            /* malformed issuer, just omit the hint */
          }
        }
      }
      return out;
    });
  }

  /**
   * Admin-only: full list with decrypted config so the table can render
   * details and the edit modal can pre-fill.
   */
  async findAllForAdmin() {
    const providers = await this.prisma.authProvider.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return providers.map((p) => ({
      ...p,
      config: this.decryptConfig(p.config, p.id),
    }));
  }

  async findById(id: string) {
    const provider = await this.prisma.authProvider.findUnique({
      where: { id },
    });
    if (!provider) return null;
    return {
      ...provider,
      config: this.decryptConfig(provider.config, provider.id),
    };
  }

  /**
   * SECURITY: also checks `enabled` because a disabled provider must not be
   * usable for login even if a stale `providerId` was supplied.
   */
  async findEnabledById(id: string) {
    const provider = await this.findById(id);
    if (!provider || !provider.enabled) return null;
    return provider;
  }

  /**
   * Legacy helper kept for the single-OIDC redirect path
   * (`GET /auth/oidc/login` without an id). Returns the first enabled
   * provider of the requested type, or null. Not safe to use anywhere else
   * — new code paths take an explicit `providerId`.
   */
  async findFirstEnabledByType(type: AuthProviderType) {
    const provider = await this.prisma.authProvider.findFirst({
      where: { type, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!provider) return null;
    return {
      ...provider,
      config: this.decryptConfig(provider.config, provider.id),
    };
  }

  async create(data: AuthProviderCreateDto) {
    const trimmedName = (data.name ?? '').trim();
    if (!trimmedName) throw new BadRequestException('Le nom est requis');

    const id = crypto.randomUUID();
    try {
      return await this.prisma.authProvider.create({
        data: {
          id,
          name: trimmedName,
          type: data.type as AuthProviderType,
          enabled: data.enabled ?? true,
          config: this.encryptConfig(data.config, id),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Un provider porte déjà ce nom');
      }
      throw e;
    }
  }

  async update(id: string, data: AuthProviderUpdateDto) {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (!trimmed) throw new BadRequestException('Le nom ne peut pas être vide');
      updateData['name'] = trimmed;
    }
    if (data.config !== undefined) {
      updateData['config'] = this.encryptConfig(data.config, id);
    }
    if (data.enabled !== undefined) {
      updateData['enabled'] = data.enabled;
    }
    try {
      return await this.prisma.authProvider.update({
        where: { id },
        data: updateData,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') {
          throw new NotFoundException('Provider introuvable');
        }
        if (e.code === 'P2002') {
          throw new ConflictException('Un provider porte déjà ce nom');
        }
      }
      throw e;
    }
  }

  /**
   * Refuses deletion when users are still attached to the provider —
   * dropping the row would orphan them (their `authProviderId` would
   * become NULL via the FK SET NULL, but they would no longer be able to
   * log in). The admin must reassign or delete those users first.
   */
  async delete(id: string): Promise<{ id: string; name: string; type: AuthProviderType }> {
    const provider = await this.prisma.authProvider.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!provider) throw new NotFoundException('Provider introuvable');

    if (provider._count.users > 0) {
      throw new ConflictException(
        `Impossible de supprimer ce provider : ${provider._count.users} utilisateur(s) y sont rattaché(s).`,
      );
    }

    await this.prisma.authProvider.delete({ where: { id } });
    return { id: provider.id, name: provider.name, type: provider.type };
  }
}
