import { Injectable, Logger } from '@nestjs/common';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';
import { AuthMethod } from '@prisma/client';
import * as https from 'node:https';

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private configCache: Map<
    string,
    { serverMetadata: any; config: any; cachedAt: number }
  > = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private authProvidersService: AuthProvidersService,
    private usersService: UsersService,
  ) {}

  private async getOpenidClient(): Promise<any> {
    const lib: any = await import('openid-client');
    return lib;
  }

  private isInternalIssuer(issuerUrl: string): boolean {
    return (
      issuerUrl.includes('localhost') ||
      issuerUrl.includes('127.0.0.1') ||
      issuerUrl.includes('192.168.') ||
      issuerUrl.includes('host.docker.internal')
    );
  }

  /**
   * Builds a custom fetch function that bypasses TLS verification.
   * Uses node:https under the hood — zero extra npm dependencies.
   * Only called in non-production environments with internal issuers.
   */
  private buildInsecureFetch(): typeof fetch {
    const agent = new https.Agent({ rejectUnauthorized: false });

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input.toString() : input.toString();

      // For http URLs, fall through to globalThis.fetch normally
      if (!url.startsWith('https://')) {
        return globalThis.fetch(input, init);
      }

      // Use node:https.request to bypass TLS verification
      return new Promise<Response>((resolve, reject) => {
        const parsed = new URL(url);
        const options: https.RequestOptions = {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: (init?.method as string) || 'GET',
          headers: init?.headers as any,
          agent,
        };

        const req = https.request(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            resolve(
              new Response(body, {
                status: res.statusCode ?? 200,
                statusText: res.statusMessage ?? '',
                headers: res.headers as any,
              }),
            );
          });
        });

        req.on('error', reject);

        if (init?.body) {
          // Normalize body to string — openid-client passes URLSearchParams for token requests
          let bodyData: string | Buffer;
          if (init.body instanceof URLSearchParams) {
            bodyData = init.body.toString();
          } else if (typeof init.body === 'string') {
            bodyData = init.body;
          } else if (Buffer.isBuffer(init.body)) {
            bodyData = init.body;
          } else {
            bodyData = String(init.body);
          }
          req.write(bodyData);
        }
        req.end();
      });
    };
  }

  async getServerMetadata(): Promise<any | null> {
    const provider = await this.authProvidersService.findByType('OIDC');
    if (!provider) {
      this.logger.warn('OIDC Provider not found or disabled');
      return null;
    }

    const cached = this.configCache.get(provider.id);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.serverMetadata;
    }

    const config = provider.config as any;
    const issuerUrl = config.issuer || config.issuerUrl;

    if (!issuerUrl) {
      this.logger.error('OIDC config missing issuer URL');
      return null;
    }

    try {
      this.logger.log(`Discovering OIDC server at: ${issuerUrl}`);
      this.logger.debug(
        `OIDC config: clientId=${config.clientId}, callbackUrl=${config.callbackUrl}`,
      );

      const oidc = await this.getOpenidClient();
      const isInternal = this.isInternalIssuer(issuerUrl);
      const isDevEnv = process.env.NODE_ENV !== 'production';
      const useInsecure = isInternal && isDevEnv;

      let serverMetadata: any;

      if (useInsecure) {
        this.logger.warn(
          'Using insecure TLS fetch for internal OIDC issuer — dev only',
        );
        const insecureFetch = this.buildInsecureFetch();
        // openid-client v6 / oauth4webapi: pass [customFetch] symbol in options
        const customFetchSym = oidc.customFetch ?? Symbol.for('customFetch');
        serverMetadata = await oidc.discovery(
          new URL(issuerUrl),
          config.clientId,
          config.clientSecret,
          undefined,
          { [customFetchSym]: insecureFetch },
        );
      } else {
        serverMetadata = await oidc.discovery(
          new URL(issuerUrl),
          config.clientId,
          config.clientSecret,
        );
      }

      this.configCache.set(provider.id, {
        serverMetadata,
        config,
        cachedAt: Date.now(),
      });
      this.logger.log('OIDC discovery successful');
      return serverMetadata;
    } catch (error: any) {
      this.logger.error(
        `OIDC discovery failed for ${issuerUrl}: ${error?.message || error}`,
      );
      if (error?.cause) {
        this.logger.debug(`Error cause: ${error.cause}`);
      }
      return null;
    }
  }

  async getAuthorizationUrl(
    state: string,
    nonce: string,
  ): Promise<string | null> {
    const serverMetadata = await this.getServerMetadata();
    if (!serverMetadata) return null;

    const provider = await this.authProvidersService.findByType('OIDC');
    const config = provider!.config as any;

    try {
      const oidc = await this.getOpenidClient();

      // openid-client v6: buildAuthorizationUrl
      // clientId is embedded in serverMetadata via discovery()
      const authorizationUrl = oidc.buildAuthorizationUrl(serverMetadata, {
        scope: 'openid email profile',
        state,
        nonce,
        redirect_uri: config.callbackUrl,
      });

      this.logger.log(`OIDC Authorization URL: ${authorizationUrl.href}`);
      return authorizationUrl.href;
    } catch (error: any) {
      this.logger.error(
        `Failed to generate OIDC authorization URL: ${error.message}`,
      );
      return null;
    }
  }

  async validateCallback(
    fullUrl: string,
    savedState: string,
    savedNonce: string,
  ): Promise<any> {
    try {
      this.logger.log('Validating OIDC callback...');

      const serverMetadata = await this.getServerMetadata();
      if (!serverMetadata) {
        throw new Error('Could not load OIDC server metadata');
      }

      const oidc = await this.getOpenidClient();
      const currentUrl = new URL(fullUrl);

      const provider = await this.authProvidersService.findByType('OIDC');
      const config = provider!.config as any;
      const issuerUrl = config.issuer || config.issuerUrl;
      const isInternal = this.isInternalIssuer(issuerUrl);
      const isDevEnv = process.env.NODE_ENV !== 'production';
      const useInsecure = isInternal && isDevEnv;

      // openid-client v6: authorizationCodeGrant validates state, nonce and id_token
      let tokens: any;
      if (useInsecure) {
        const insecureFetch = this.buildInsecureFetch();
        const customFetchSym = oidc.customFetch ?? Symbol.for('customFetch');
        tokens = await oidc.authorizationCodeGrant(
          serverMetadata,
          currentUrl,
          {
            pkceCodeVerifier: undefined,
            expectedState: savedState,
            expectedNonce: savedNonce,
          },
          undefined,
          { [customFetchSym]: insecureFetch },
        );
      } else {
        tokens = await oidc.authorizationCodeGrant(
          serverMetadata,
          currentUrl,
          {
            pkceCodeVerifier: undefined,
            expectedState: savedState,
            expectedNonce: savedNonce,
          },
        );
      }

      this.logger.log('Tokens received, fetching user info...');

      // openid-client v6: fetchUserInfo
      let userinfo: any;
      if (useInsecure) {
        const insecureFetch = this.buildInsecureFetch();
        const customFetchSym = oidc.customFetch ?? Symbol.for('customFetch');
        userinfo = await oidc.fetchUserInfo(
          serverMetadata,
          tokens.access_token,
          tokens.claims()?.sub as string,
          { [customFetchSym]: insecureFetch },
        );
      } else {
        userinfo = await oidc.fetchUserInfo(
          serverMetadata,
          tokens.access_token,
          tokens.claims()?.sub as string,
        );
      }

      if (!userinfo.email) {
        this.logger.error('OIDC user has no email claim');
        return null;
      }

      if (!userinfo.sub) {
        this.logger.error('OIDC user has no sub claim');
        return null;
      }

      this.logger.log(`OIDC login successful for ${userinfo.email}`);

      // JIT Provisioning
      const user = await this.usersService.findOrCreateExternalUser(
        userinfo.email as string,
        userinfo.sub as string,
        AuthMethod.OIDC,
      );
      return user;
    } catch (error: any) {
      this.logger.error(
        `OIDC callback validation failed: ${error?.message || error}`,
      );
      if (error?.response) {
        try {
          const body = await error.response.text();
          this.logger.error(`OIDC Provider Error Body: ${body}`);
        } catch {
          this.logger.error('Could not read OIDC error body');
        }
      }
      return null;
    }
  }
}