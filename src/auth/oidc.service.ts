import { Injectable, Logger } from '@nestjs/common';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';
import { AuthMethod } from '@prisma/client';

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private oidcModule: any = null;
  private configCache: Map<string, { config: any; cachedAt: number }> =
    new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private authProvidersService: AuthProvidersService,
    private usersService: UsersService,
  ) {}

  private async getOidc() {
    if (!this.oidcModule) {
      this.oidcModule = await import('openid-client');
    }
    return this.oidcModule;
  }

  async getConfig(): Promise<any | null> {
    const provider = await this.authProvidersService.findByType('OIDC');
    if (!provider) return null;

    const cached = this.configCache.get(provider.id);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.config;
    }

    const config = provider.config as any;
    const oidc = await this.getOidc();

    try {
      const serverMetadata = await oidc.discovery(
        new URL(config.issuerUrl),
        config.clientId,
        config.clientSecret,
      );

      this.configCache.set(provider.id, {
        config: serverMetadata,
        cachedAt: Date.now(),
      });
      return serverMetadata;
    } catch (error: any) {
      this.logger.error(`OIDC discovery failed: ${error.message}`);
      return null;
    }
  }

  async getAuthorizationUrl(
    state: string,
    nonce: string,
  ): Promise<string | null> {
    const config = await this.getConfig();
    if (!config) return null;

    const provider = await this.authProvidersService.findByType('OIDC');
    const providerConfig = provider!.config as any;
    const oidc = await this.getOidc();

    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      scope: 'openid email profile',
      state,
      nonce,
      redirect_uri: providerConfig.callbackUrl,
    });

    return authorizationUrl.href;
  }

  async validateCallback(
    fullUrl: string,
    savedState: string,
    savedNonce: string,
  ): Promise<any> {
    const config = await this.getConfig();
    if (!config) return null;

    const oidc = await this.getOidc();

    try {
      const currentUrl = new URL(fullUrl);
      const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
        expectedState: savedState,
        expectedNonce: savedNonce,
      });

      const userinfo = await oidc.fetchUserInfo(
        config,
        tokens.access_token,
        tokens.claims()?.sub!,
      );

      this.logger.log(`OIDC login successful for ${userinfo.email}`);

      // JIT Provisioning
      const user = await this.usersService.findOrCreateExternalUser(
        userinfo.email as string,
        userinfo.sub as string,
        AuthMethod.OIDC,
      );
      return user;
    } catch (error: any) {
      this.logger.error(`OIDC callback failed: ${error.message}`);
      return null;
    }
  }
}
