import { Injectable, Logger } from '@nestjs/common';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';
import { AuthMethod, User } from '@prisma/client';
import { OidcProviderConfig } from './types/auth-provider.types';
import { Agent } from 'undici';

interface OidcUserInfo {
  sub: string;
  email?: string;
  name?: string;
  // Standard OIDC claims for a human-readable handle. We try them in
  // preference order — Authentik / Keycloak emit `preferred_username`,
  // some IdPs only emit `nickname` or `name`.
  preferred_username?: string;
  nickname?: string;
  // Authentik / Keycloak default to a `groups` claim — array of group
  // names. Other IdPs may use a different claim name; the per-provider
  // `groupsClaim` config picks where to read.
  groups?: unknown;
  [key: string]: unknown;
}

const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile', 'groups'];
const DEFAULT_GROUPS_CLAIM = 'groups';

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
  // SECURITY (F-03 fix): cache key binds (providerId, issuerUrl) so that
  // changing the issuer on the same provider invalidates the cached
  // metadata immediately. Previously the key was just `provider.id`,
  // allowing a TOC-TOU where an admin pointed the issuer at a malicious
  // server, populated the cache, then reverted the issuer to a legitimate
  // URL. The next OIDC flow would use the legitimate issuer label but the
  // cached (malicious) `token_endpoint` → SSRF.
  private configCache = new Map<string, ConfigCacheEntry>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private authProvidersService: AuthProvidersService,
    private usersService: UsersService,
  ) {}

  /** F-03: drop every cache entry when ANY provider is updated. */
  invalidateCache(): void {
    this.configCache.clear();
  }

  /**
   * Normalise the groups claim into a list of trimmed, unique strings.
   * Accepts:
   *   - `string[]` (Authentik / Keycloak default)
   *   - `string` containing comma- or space-delimited names (some IdPs)
   *   - anything else → empty list
   *
   * Silently filters out empty entries and anything > 200 chars to keep
   * a misconfigured IdP from blowing up the Group table on first login.
   */
  private extractGroupClaim(raw: unknown): string[] {
    let arr: unknown[];
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (typeof raw === 'string' && raw.trim().length > 0) {
      arr = raw.split(/[,\s]+/);
    } else {
      return [];
    }
    const cleaned = arr
      .filter((v): v is string => typeof v === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 200);
    return Array.from(new Set(cleaned));
  }

  /**
   * F-03: validate the endpoints advertised in the discovery document.
   * If any of them resolve to a private/loopback/link-local IP, the
   * metadata is rejected — that's the SSRF vector closed off.
   *
   * When the provider is in lab mode (`allowInsecureTls`), the
   * private-IP block is lifted because self-hosted IdPs live on the LAN
   * by design. The TLS check is bypassed elsewhere via a custom
   * dispatcher; this method only governs the metadata structure.
   */
  private validateDiscoveryEndpoints(meta: unknown, labMode: boolean): void {
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
      if (!labMode && this.isPrivateOrLoopbackHost(url.hostname)) {
        throw new Error(
          `OIDC discovery: ${f} points at internal address ${url.hostname} (refused as SSRF risk). ` +
            `If this is a self-hosted IdP on your LAN, enable "Lab mode" on the provider.`,
        );
      }
    }
  }

  private isPrivateOrLoopbackHost(host: string): boolean {
    const h = host.toLowerCase();
    if (h === 'localhost') return true;
    if (/^127\./.test(h)) return true;
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^169\.254\./.test(h)) return true;
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
    if (h === 'host.docker.internal' || h === 'gateway.docker.internal') return true;
    if (h.endsWith('.internal') || h.endsWith('.local')) return true;
    return false;
  }

  private async getOpenidClient(): Promise<OidcLib> {
    const lib = await import('openid-client') as unknown as OidcLib;
    return lib;
  }

  /**
   * Build an undici dispatcher that skips TLS verification, plus a
   * matching fetch wrapper to attach to the openid-client Configuration
   * via the library's `customFetch` symbol so token + userinfo calls
   * also bypass cert validation. Returns null when lab mode is off.
   */
  private buildInsecureFetch(): { dispatcher: Agent; fetchFn: typeof fetch } | null {
    // nosemgrep: javascript.express.security.audit.express-disabling-tls-verification.express-disabling-tls-verification
    // nosemgrep: bypass-tls-verification
    //
    // SECURITY: this disables TLS verification ON PURPOSE. It is the
    // implementation of the per-provider `allowInsecureTls` opt-in:
    //   - off by default everywhere
    //   - reachable only when an admin explicitly ticks the red
    //     "Lab mode — disable TLS verification" checkbox in the OIDC
    //     provider editor (`AdminProviders.tsx`)
    //   - scoped to a single provider via a dedicated undici Agent,
    //     never global / process-wide
    //   - documented as "homelab / self-hosted IdP with self-signed
    //     cert, NEVER use in production" in the UI hint + the
    //     `OidcProviderConfig.allowInsecureTls` doc comment
    // Static analysers flag this line because they can't see the
    // gating; the comment above keeps the audit conversation closed.
    const dispatcher = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    });
    const fetchFn: typeof fetch = (input, init) =>
      // The `dispatcher` option is undici-specific; Node accepts it but
      // the TS DOM lib doesn't list it.
      fetch(input as any, { ...(init ?? {}), dispatcher } as any);
    return { dispatcher, fetchFn };
  }

  /**
   * Surface the underlying cause of a `fetch failed` error so admins see
   * `SELF_SIGNED_CERT_IN_CHAIN`, `ECONNREFUSED`, `ETIMEDOUT`, etc. instead
   * of an opaque generic. Recurses one level into nested causes.
   */
  private formatFetchError(error: unknown): string {
    const seen: string[] = [];
    let cur: any = error;
    let depth = 0;
    while (cur && depth < 4) {
      const piece = cur?.code
        ? `${cur.code}${cur.message ? ': ' + cur.message : ''}`
        : (cur?.message ?? String(cur));
      if (piece) seen.push(piece);
      cur = cur?.cause;
      depth++;
    }
    return seen.length ? seen.join(' ← ') : 'fetch failed (no cause reported)';
  }

  /**
   * Manual discovery fetch used when the provider is in lab mode. We
   * can't rely on `openid-client.discovery()` for the initial fetch
   * because the library uses the global fetch and we need a custom
   * dispatcher to bypass TLS verification.
   */
  private async manualLabDiscovery(
    issuerUrl: string,
    config: OidcProviderConfig,
    insecure: { dispatcher: Agent; fetchFn: typeof fetch },
  ): Promise<unknown> {
    const wellKnown =
      issuerUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';

    const res = await insecure.fetchFn(wellKnown, { method: 'GET' });
    if (!res.ok) {
      throw new Error(
        `Discovery HTTP ${res.status} ${res.statusText} on ${wellKnown}`,
      );
    }
    const metadata = (await res.json()) as Record<string, unknown>;

    const oidc = await this.getOpenidClient();
    const Configuration = oidc['Configuration'] as
      | (new (
          meta: Record<string, unknown>,
          clientId: string,
          clientMetadata?: string | Record<string, unknown>,
        ) => unknown)
      | undefined;
    const customFetchSym = oidc['customFetch'] as symbol | undefined;

    if (!Configuration || !customFetchSym) {
      throw new Error(
        'openid-client does not expose Configuration/customFetch — cannot enable lab mode',
      );
    }

    const cfg = new Configuration(metadata, config.clientId, config.clientSecret) as any;
    cfg[customFetchSym] = insecure.fetchFn;
    return cfg;
  }

  /**
   * Loads (and caches) the discovery document for a specific provider.
   * Returns null when the provider doesn't exist, is disabled, has no
   * issuer, or its metadata fails the SSRF allow-list.
   *
   * Two paths:
   *  - Standard (production): openid-client v6 `discovery()` with the
   *    default fetch. Cert chain must be trusted.
   *  - Lab (`allowInsecureTls: true`): we fetch the well-known doc with
   *    a custom undici dispatcher (`rejectUnauthorized: false`) and
   *    build a `Configuration` manually so that subsequent token /
   *    userinfo calls also use the insecure fetch.
   */
  async getServerMetadata(providerId: string): Promise<unknown | null> {
    const provider = await this.authProvidersService.findEnabledById(providerId);
    if (!provider || provider.type !== 'OIDC') {
      this.logger.warn(`OIDC provider ${providerId} not found or disabled`);
      return null;
    }

    const config = provider.config as OidcProviderConfig;
    const issuerUrl = config.issuer;
    if (!issuerUrl) {
      this.logger.error(`OIDC provider ${provider.name} missing issuer URL`);
      return null;
    }

    const labMode = !!config.allowInsecureTls;
    // Cache key includes labMode so toggling the flag invalidates the
    // entry — important because the cached Configuration carries a
    // different `customFetch` depending on the mode.
    const cacheKey = `${provider.id}::${issuerUrl}::${labMode ? 'lab' : 'prod'}`;
    const cached = this.configCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.serverMetadata;
    }

    try {
      this.logger.log(
        `Discovering OIDC server (${provider.name}${labMode ? ', LAB MODE — TLS verification OFF' : ''}) at: ${issuerUrl}`,
      );

      let serverMetadata: unknown;
      if (labMode) {
        const insecure = this.buildInsecureFetch();
        if (!insecure) throw new Error('Failed to build insecure dispatcher');
        serverMetadata = await this.manualLabDiscovery(issuerUrl, config, insecure);
      } else {
        const oidc = await this.getOpenidClient();
        const discovery = oidc['discovery'] as (
          issuer: URL,
          clientId: string,
          clientSecret: string,
          ...args: unknown[]
        ) => Promise<unknown>;
        serverMetadata = await discovery(
          new URL(issuerUrl),
          config.clientId,
          config.clientSecret,
        );
      }

      // SSRF: in production we still refuse metadata pointing at private
      // ranges; in lab mode this check is lifted (the admin opted in).
      this.validateDiscoveryEndpoints(serverMetadata, labMode);

      this.configCache.set(cacheKey, { serverMetadata, config, cachedAt: Date.now() });
      this.logger.log(`OIDC discovery successful for ${provider.name}`);
      return serverMetadata;
    } catch (error: unknown) {
      // Surface the underlying cause (e.g. SELF_SIGNED_CERT_IN_CHAIN,
      // ECONNREFUSED, ETIMEDOUT) — bare `fetch failed` is useless to the
      // admin who needs to debug a homelab IdP.
      this.logger.error(
        `OIDC discovery failed for ${issuerUrl}: ${this.formatFetchError(error)}`,
      );
      return null;
    }
  }

  async getAuthorizationUrl(
    providerId: string,
    state: string,
    nonce: string,
    codeVerifier: string,
    extraParams?: Record<string, string>,
  ): Promise<string | null> {
    const serverMetadata = await this.getServerMetadata(providerId);
    if (!serverMetadata) return null;

    const provider = await this.authProvidersService.findEnabledById(providerId);
    if (!provider) return null;
    const config = provider.config as OidcProviderConfig;

    try {
      const oidc = await this.getOpenidClient();
      const calcChallenge = oidc['calculatePKCECodeChallenge'] as (v: string) => Promise<string>;
      const buildUrl = oidc['buildAuthorizationUrl'] as (meta: unknown, params: Record<string, string>) => URL;

      const codeChallenge = await calcChallenge(codeVerifier);
      // Use the per-provider scope list when configured; fall back to the
      // documented default. `openid` is always implied by the OIDC spec
      // but we keep it explicit so the IdP doesn't reject a missing
      // openid scope request.
      const scopeList =
        config.scopes && config.scopes.length > 0 ? config.scopes : DEFAULT_OIDC_SCOPES;
      // `extraParams` lets callers force `prompt=login` (sudo flow) or
      // override `max_age` for stronger freshness guarantees. Anything
      // unknown to the IdP is silently ignored per OIDC spec.
      const authorizationUrl = buildUrl(serverMetadata, {
        scope: scopeList.join(' '),
        state,
        nonce,
        redirect_uri: config.redirectUri,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        ...(extraParams ?? {}),
      });

      this.logger.log(`OIDC authorization URL generated for ${provider.name}`);
      return authorizationUrl.href;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate OIDC authorization URL: ${msg}`);
      return null;
    }
  }

  /**
   * Exchange + userinfo without any DB side-effect. Used by the sudo
   * flow, which needs to *verify* that the OIDC `sub` returned by the
   * IdP matches the currently-logged-in user's `externalId`, but must
   * not JIT-provision a new account if a different person happens to
   * complete the callback (would be a footgun otherwise).
   *
   * Returns the raw userinfo claims, or null on any verification
   * failure (state/nonce mismatch, PKCE failure, IdP error, etc.).
   */
  async verifyCallbackClaims(
    providerId: string,
    fullUrl: string,
    savedState: string,
    savedNonce: string,
    codeVerifier: string,
  ): Promise<OidcUserInfo | null> {
    try {
      this.logger.log(`Verifying OIDC sudo claims for provider ${providerId}...`);

      const serverMetadata = await this.getServerMetadata(providerId);
      if (!serverMetadata) throw new Error('Could not load OIDC server metadata');

      const oidc = await this.getOpenidClient();
      const authCodeGrant = oidc['authorizationCodeGrant'] as (
        meta: unknown,
        url: URL,
        opts: Record<string, unknown>,
        ...rest: unknown[]
      ) => Promise<OidcTokenSet>;
      const fetchUserInfo = oidc['fetchUserInfo'] as (
        meta: unknown,
        token: string,
        sub: string,
        ...rest: unknown[]
      ) => Promise<OidcUserInfo>;

      const tokens = await authCodeGrant(serverMetadata, new URL(fullUrl), {
        pkceCodeVerifier: codeVerifier,
        expectedState: savedState,
        expectedNonce: savedNonce,
      });
      return await fetchUserInfo(
        serverMetadata,
        tokens.access_token,
        tokens.claims()?.sub ?? '',
      );
    } catch (error: unknown) {
      this.logger.error(`OIDC sudo verification failed: ${this.formatFetchError(error)}`);
      return null;
    }
  }

  async validateCallback(
    providerId: string,
    fullUrl: string,
    savedState: string,
    savedNonce: string,
    codeVerifier: string,
  ): Promise<User | null> {
    try {
      this.logger.log(`Validating OIDC callback for provider ${providerId}...`);

      const serverMetadata = await this.getServerMetadata(providerId);
      if (!serverMetadata) throw new Error('Could not load OIDC server metadata');

      // Re-fetch the provider config so we can read sync-related options
      // (groupsClaim / syncGroups) without rebroadcasting them via the
      // already-cached server metadata.
      const provider = await this.authProvidersService.findEnabledById(providerId);
      const config = (provider?.config ?? {}) as OidcProviderConfig;

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

      // Pick the first non-empty handle we can find. `preferred_username`
      // is the OIDC standard for "the login name the IdP wants us to
      // display". We accept `nickname` and `name` as fallbacks for IdPs
      // that don't expose preferred_username (older Keycloak realms, some
      // hand-rolled IdPs).
      const candidateUsername =
        (typeof userinfo.preferred_username === 'string' && userinfo.preferred_username.trim())
        || (typeof userinfo.nickname === 'string' && userinfo.nickname.trim())
        || (typeof userinfo.name === 'string' && userinfo.name.trim())
        || null;

      this.logger.log(
        `OIDC login successful for ${userinfo.email}` +
          (candidateUsername ? ` (handle: ${candidateUsername})` : ''),
      );

      const user = await this.usersService.findOrCreateExternalUser(
        userinfo.email,
        userinfo.sub,
        AuthMethod.OIDC,
        providerId,
        candidateUsername || null,
      );

      // Group sync — additive only. We never remove a user from a group
      // they were attached to manually, even if the IdP no longer lists
      // it. This keeps the hybrid "IdP groups + local-only groups"
      // setup working out of the box.
      const syncGroups = config.syncGroups !== false; // default ON
      if (syncGroups) {
        const claimName = config.groupsClaim || DEFAULT_GROUPS_CLAIM;
        const groupNames = this.extractGroupClaim(userinfo[claimName]);
        if (groupNames.length > 0) {
          await this.usersService.syncExternalGroups(
            user.id,
            groupNames,
            { providerId, ipAddress: null, authMethod: AuthMethod.OIDC },
          );
        } else {
          this.logger.debug(
            `OIDC user ${userinfo.email}: claim "${claimName}" empty or missing — no group sync`,
          );
        }
      }

      return user;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`OIDC callback validation failed: ${msg}`);
      return null;
    }
  }
}
