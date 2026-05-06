import { Injectable, Logger } from '@nestjs/common';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';
import { AuthMethod, User } from '@prisma/client';
import { OidcProviderConfig } from './types/auth-provider.types';
import * as https from 'node:https';

interface OidcUserInfo {
  sub: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

interface OidcTokenSet {
  access_token: string;
  claims: () => { sub?: string } | null;
}

interface ConfigCacheEntry {
  serverMetadata: unknown;
  config: OidcProviderConfig;
  cachedAt: number;
}

// openid-client v6 is ESM-only; we use unknown + casts to avoid any types
type OidcLib = Record<string, unknown>;

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private configCache = new Map<string, ConfigCacheEntry>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private authProvidersService: AuthProvidersService,
    private usersService: UsersService,
  ) {}

  private async getOpenidClient(): Promise<OidcLib> {
    const lib = await import('openid-client') as unknown as OidcLib;
    return lib;
  }

  private isInternalIssuer(issuerUrl: string): boolean {
    try {
      const host = new URL(issuerUrl).hostname;
      return /^(localhost|127\.0\.0\.1|host\.docker\.internal|(192\.168\.\d{1,3}\.\d{1,3}))$/.test(host);
    } catch {
      return false;
    }
  }

  private buildInsecureFetch(): typeof fetch {
    const agent = new https.Agent({ rejectUnauthorized: false });

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input.toString() : String(input);

      if (!url.startsWith('https://')) {
        return globalThis.fetch(input, init);
      }

      return new Promise<Response>((resolve, reject) => {
        const parsed = new URL(url);
        const options: https.RequestOptions = {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: (init?.method as string) || 'GET',
          headers: init?.headers as Record<string, string>,
          agent,
        };

        const req = https.request(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            resolve(
              new Response(body, {
                status: res.statusCode ?? 200,
                statusText: res.statusMessage ?? '',
                headers: res.headers as Record<string, string>,
              }),
            );
          });
        });

        req.on('error', reject);

        if (init?.body) {
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

  async getServerMetadata(): Promise<unknown | null> {
    const provider = await this.authProvidersService.findByType('OIDC');
    if (!provider) {
      this.logger.warn('OIDC Provider not found or disabled');
      return null;
    }

    const cached = this.configCache.get(provider.id);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.serverMetadata;
    }

    const config = provider.config as OidcProviderConfig;
    const issuerUrl = config.issuer;

    if (!issuerUrl) {
      this.logger.error('OIDC config missing issuer URL');
      return null;
    }

    try {
      this.logger.log(`Discovering OIDC server at: ${issuerUrl}`);
      this.logger.debug(`OIDC config: clientId=${config.clientId}, redirectUri=${config.redirectUri}`);

      const oidc = await this.getOpenidClient();
      const discovery = oidc['discovery'] as (issuer: URL, clientId: string, clientSecret: string, ...args: unknown[]) => Promise<unknown>;
      const isInternal = this.isInternalIssuer(issuerUrl);
      const isDevEnv = process.env.NODE_ENV !== 'production';
      const useInsecure = isInternal && isDevEnv;

      let serverMetadata: unknown;
      if (useInsecure) {
        this.logger.warn('Using insecure TLS fetch for internal OIDC issuer — dev only');
        const insecureFetch = this.buildInsecureFetch();
        const customFetchSym = (oidc['customFetch'] as symbol) ?? Symbol.for('customFetch');
        serverMetadata = await discovery(new URL(issuerUrl), config.clientId, config.clientSecret, undefined, { [customFetchSym]: insecureFetch });
      } else {
        serverMetadata = await discovery(new URL(issuerUrl), config.clientId, config.clientSecret);
      }

      this.configCache.set(provider.id, { serverMetadata, config, cachedAt: Date.now() });
      this.logger.log('OIDC discovery successful');
      return serverMetadata;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`OIDC discovery failed for ${issuerUrl}: ${msg}`);
      return null;
    }
  }

  async getAuthorizationUrl(state: string, nonce: string, codeVerifier: string): Promise<string | null> {
    const serverMetadata = await this.getServerMetadata();
    if (!serverMetadata) return null;

    const provider = await this.authProvidersService.findByType('OIDC');
    const config = provider!.config as OidcProviderConfig;

    try {
      const oidc = await this.getOpenidClient();
      const calcChallenge = oidc['calculatePKCECodeChallenge'] as (v: string) => Promise<string>;
      const buildUrl = oidc['buildAuthorizationUrl'] as (meta: unknown, params: Record<string, string>) => URL;

      const codeChallenge = await calcChallenge(codeVerifier);
      const authorizationUrl = buildUrl(serverMetadata, {
        scope: 'openid email profile',
        state,
        nonce,
        redirect_uri: config.redirectUri,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
      });

      this.logger.log('OIDC Authorization URL generated with PKCE');
      return authorizationUrl.href;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate OIDC authorization URL: ${msg}`);
      return null;
    }
  }

  async validateCallback(
    fullUrl: string,
    savedState: string,
    savedNonce: string,
    codeVerifier: string,
  ): Promise<User | null> {
    try {
      this.logger.log('Validating OIDC callback...');

      const serverMetadata = await this.getServerMetadata();
      if (!serverMetadata) throw new Error('Could not load OIDC server metadata');

      const oidc = await this.getOpenidClient();
      const authCodeGrant = oidc['authorizationCodeGrant'] as (meta: unknown, url: URL, opts: Record<string, unknown>, ...rest: unknown[]) => Promise<OidcTokenSet>;
      const fetchUserInfo = oidc['fetchUserInfo'] as (meta: unknown, token: string, sub: string, ...rest: unknown[]) => Promise<OidcUserInfo>;
      const customFetchSym = (oidc['customFetch'] as symbol) ?? Symbol.for('customFetch');

      const provider = await this.authProvidersService.findByType('OIDC');
      const config = provider!.config as OidcProviderConfig;
      const issuerUrl = config.issuer;
      const useInsecure = this.isInternalIssuer(issuerUrl) && process.env.NODE_ENV !== 'production';

      const grantOpts: Record<string, unknown> = {
        pkceCodeVerifier: codeVerifier,
        expectedState: savedState,
        expectedNonce: savedNonce,
      };

      let tokens: OidcTokenSet;
      let userinfo: OidcUserInfo;

      if (useInsecure) {
        const insecureFetch = this.buildInsecureFetch();
        tokens = await authCodeGrant(serverMetadata, new URL(fullUrl), grantOpts, undefined, { [customFetchSym]: insecureFetch });
        userinfo = await fetchUserInfo(serverMetadata, tokens.access_token, tokens.claims()?.sub ?? '', { [customFetchSym]: insecureFetch });
      } else {
        tokens = await authCodeGrant(serverMetadata, new URL(fullUrl), grantOpts);
        userinfo = await fetchUserInfo(serverMetadata, tokens.access_token, tokens.claims()?.sub ?? '');
      }

      if (!userinfo.email) { this.logger.error('OIDC user has no email claim'); return null; }
      if (!userinfo.sub) { this.logger.error('OIDC user has no sub claim'); return null; }

      this.logger.log(`OIDC login successful for ${userinfo.email}`);
      return this.usersService.findOrCreateExternalUser(userinfo.email, userinfo.sub, AuthMethod.OIDC);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`OIDC callback validation failed: ${msg}`);
      return null;
    }
  }
}
