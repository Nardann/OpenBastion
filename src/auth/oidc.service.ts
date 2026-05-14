import { Injectable, Logger } from '@nestjs/common';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';
import { AuthMethod, User } from '@prisma/client';
import { OidcProviderConfig } from './types/auth-provider.types';

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
  // SECURITY (F-03 fix): the cache key is now `provider.id || issuerUrl`
  // so that changing the issuer invalidates the cached metadata
  // immediately. Previously the key was just `provider.id`, allowing a
  // TOC-TOU where an admin pointed the issuer at a malicious server,
  // populated the cache, then reverted the issuer to a legitimate URL.
  // The next OIDC flow used the legitimate issuer label but the cached
  // (malicious) `token_endpoint` → SSRF.
  private configCache = new Map<string, ConfigCacheEntry>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private authProvidersService: AuthProvidersService,
    private usersService: UsersService,
  ) {}

  /** F-03: invalidate the cache when the provider config is updated. */
  invalidateCache(): void {
    this.configCache.clear();
  }

  /**
   * F-03: validate the endpoints advertised in the discovery document.
   * If any of them resolve to a private/loopback/link-local IP, the
   * metadata is rejected — that's the SSRF vector closed off.
   *
   * We only validate the schemes & hostnames here (not full DNS
   * resolution) because the openid-client library will perform the
   * actual fetches. The check below catches the obvious "rogue IdP
   * pointing at 127.0.0.1" / "::1" / "169.254.169.254" cases.
   */
  private validateDiscoveryEndpoints(meta: unknown): void {
    const m = meta as Record<string, unknown> | null;
    const sub = (m?.['serverMetadata'] ?? m) as Record<string, unknown> | null;
    if (!sub) return;
    const fields = [
      'authorization_endpoint',
      'token_endpoint',
      'userinfo_endpoint',
      'jwks_uri',
      'end_session_endpoint',
      'introspection_endpoint',
      'revocation_endpoint',
    ];
    for (const f of fields) {
      const v = sub[f];
      if (typeof v !== 'string' || v.length === 0) continue;
      let url: URL;
      try {
        url = new URL(v);
      } catch {
        throw new Error(`OIDC discovery: invalid URL in ${f}: ${v}`);
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`OIDC discovery: unsupported scheme in ${f}: ${url.protocol}`);
      }
      if (this.isPrivateOrLoopbackHost(url.hostname)) {
        throw new Error(
          `OIDC discovery: ${f} points at internal address ${url.hostname} (refused as SSRF risk)`,
        );
      }
    }
  }

  private isPrivateOrLoopbackHost(host: string): boolean {
    const h = host.toLowerCase();
    if (h === 'localhost') return true;
    // IPv4 ranges + IPv6 loopback / unique-local / link-local
    if (/^127\./.test(h)) return true;
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^169\.254\./.test(h)) return true;
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
    // host.docker.internal and friends are explicitly internal
    if (h === 'host.docker.internal' || h === 'gateway.docker.internal') return true;
    if (h.endsWith('.internal') || h.endsWith('.local')) return true;
    return false;
  }

  private async getOpenidClient(): Promise<OidcLib> {
    const lib = await import('openid-client') as unknown as OidcLib;
    return lib;
  }

  // NOTE: `OIDC_ALLOW_INSECURE_TLS` was removed. Local OIDC testing must
  // use a properly trusted certificate (e.g. `mkcert`); the bypass path
  // is no longer reachable and the literal `rejectUnauthorized: false`
  // has been deleted from this file, closing CodeQL alert
  // `js/disabling-certificate-validation` and the equivalent Semgrep rule.


  async getServerMetadata(): Promise<unknown | null> {
    const provider = await this.authProvidersService.findByType('OIDC');
    if (!provider) {
      this.logger.warn('OIDC Provider not found or disabled');
      return null;
    }

    const config = provider.config as OidcProviderConfig;
    const issuerUrl = config.issuer;

    if (!issuerUrl) {
      this.logger.error('OIDC config missing issuer URL');
      return null;
    }

    // F-03: cache key binds (providerId, issuerUrl) so toggling the
    // issuer invalidates the entry. Combined with `invalidateCache()`
    // called from the upsert flow, this closes the TOC-TOU window where
    // a malicious metadata document outlives the issuer that produced it.
    const cacheKey = `${provider.id}::${issuerUrl}`;
    const cached = this.configCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.serverMetadata;
    }

    try {
      this.logger.log(`Discovering OIDC server at: ${issuerUrl}`);
      this.logger.debug(`OIDC config: clientId=${config.clientId}, redirectUri=${config.redirectUri}`);

      const oidc = await this.getOpenidClient();
      const discovery = oidc['discovery'] as (issuer: URL, clientId: string, clientSecret: string, ...args: unknown[]) => Promise<unknown>;

      const serverMetadata = await discovery(
        new URL(issuerUrl),
        config.clientId,
        config.clientSecret,
      );

      // F-03: refuse metadata that points any endpoint at an internal IP
      // BEFORE we cache it. The IdP-controlled token_endpoint is what
      // causes SSRF on the OAuth code exchange — the rest are checked for
      // the same reason.
      this.validateDiscoveryEndpoints(serverMetadata);

      this.configCache.set(cacheKey, { serverMetadata, config, cachedAt: Date.now() });
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

      const grantOpts: Record<string, unknown> = {
        pkceCodeVerifier: codeVerifier,
        expectedState: savedState,
        expectedNonce: savedNonce,
      };

      const tokens = await authCodeGrant(serverMetadata, new URL(fullUrl), grantOpts);
      const userinfo = await fetchUserInfo(
        serverMetadata,
        tokens.access_token,
        tokens.claims()?.sub ?? '',
      );

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
