import { Injectable, Logger } from '@nestjs/common';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';
import { AuthMethod } from '@prisma/client';
import { escapeLdapFilter } from './ldap.utils';
import { LdapProviderConfig } from './types/auth-provider.types';
// `ldapauth-fork` is a CommonJS module whose `module.exports` IS the
// constructor function — not a namespace. With `esModuleInterop: true`
// the default-import form is the correct way to get the callable;
// `import * as` returns a namespace object `{default: fn, ...}` whose
// `new` invocation throws "is not a constructor" at runtime. The spec
// file mirrored the broken form and silently failed long before LDAP
// was ever exercised against a real directory.
import LdapAuth from 'ldapauth-fork';

interface LdapOptions {
  url: string;
  searchBase: string;
  searchFilter: string;
  bindProperty: string;
  bindDN?: string;
  bindCredentials?: string;
  searchAttributes?: string[];
  tlsOptions?: Record<string, unknown>;
}

interface LdapUser {
  dn?: string;
  mail?: string;
  proxyAddresses?: string | string[];
  // Display handle attributes — preference order matches AD / OpenLDAP /
  // Authentik. Falls back to the identifier the user typed at the login
  // screen if none of these come back.
  sAMAccountName?: string;
  uid?: string;
  cn?: string;
  displayName?: string;
  // Group membership — `memberOf` is the AD default and is also exposed
  // by OpenLDAP with the `memberof` overlay enabled. May be a single
  // string (one group), an array (multiple), or absent. Other schemas
  // can be opted in via `groupsAttribute` on the provider config.
  memberOf?: string | string[];
  [key: string]: unknown;
}

const DEFAULT_LDAP_GROUPS_ATTRIBUTE = 'memberOf';
const DEFAULT_LDAP_GROUPS_SEARCH_FILTER =
  '(&(objectClass=groupOfNames)(member={{userDn}}))';

// Minimal structural types for the ldapjs v3 API we use. The package
// ships no `.d.ts` and DefinitelyTyped tracks v2 — declaring only what
// we touch keeps the surface area small.
interface LdapjsEntry {
  pojo?: Record<string, unknown> & {
    attributes?: Array<{ type: string; values: unknown[] }>;
  };
  object?: Record<string, unknown>;
}
interface LdapjsSearchEmitter {
  on(event: 'searchEntry', listener: (entry: LdapjsEntry) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'end', listener: () => void): this;
}
interface LdapjsClient {
  bind(dn: string, password: string, cb: (err: Error | null) => void): void;
  search(
    base: string,
    opts: { filter: string; scope: string; attributes?: string[] },
    cb: (err: Error | null, res: LdapjsSearchEmitter) => void,
  ): void;
  unbind(): void;
  on(event: 'error', listener: (err: Error) => void): this;
}

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(
    private authProvidersService: AuthProvidersService,
    private usersService: UsersService,
  ) {}

  /**
   * Authenticate against a specific LDAP provider. The caller MUST resolve
   * the provider id first (login DTO supplies it). We no longer fall back
   * to "the first enabled LDAP" — that path was ambiguous as soon as two
   * directories were configured.
   */
  async authenticate(
    providerId: string,
    username: string,
    pass: string,
  ): Promise<unknown> {
    const provider = await this.authProvidersService.findEnabledById(providerId);
    if (!provider || provider.type !== 'LDAP') {
      this.logger.warn(`LDAP provider ${providerId} not found or disabled`);
      return null;
    }

    const config = provider.config as LdapProviderConfig;
    const escapedUsername = escapeLdapFilter(username);

    const defaultFilter = config.isActiveDirectory
      ? '(sAMAccountName={{username}})'
      : '(uid={{username}})';

    const searchFilter = config.searchFilter || defaultFilter;
    let finalFilter = searchFilter.replace(/{{username}}/g, escapedUsername);

    if (config.isActiveDirectory && !finalFilter.includes('userAccountControl')) {
      finalFilter = `(&${finalFilter}(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`;
    }

    const ldapOptions: LdapOptions = {
      url: config.url,
      searchBase: config.searchBase,
      searchFilter: finalFilter,
      bindProperty: 'dn',
    };

    if (config.bindDn && config.bindPassword) {
      ldapOptions.bindDN = config.bindDn;
      ldapOptions.bindCredentials = config.bindPassword;
    }

    if (config.tlsOptions) {
      ldapOptions.tlsOptions = config.tlsOptions as Record<string, unknown>;
    }

    type LdapAuthInstance = {
      authenticate: (
        u: string,
        p: string,
        cb: (err: Error | null, user: LdapUser | null) => void,
      ) => void;
      close: (cb: (err?: Error) => void) => void;
    };
    type LdapAuthCtor = new (opts: LdapOptions) => LdapAuthInstance;

    return new Promise((resolve) => {
      const Ctor = LdapAuth as unknown as LdapAuthCtor;
      const ldap = new Ctor(ldapOptions);

      ldap.authenticate(username, pass, async (err, ldapUser) => {
        ldap.close((closeErr) => {
          if (closeErr) {
            this.logger.warn(`LDAP connection close error: ${closeErr.message}`);
          }
        });

        if (err) {
          this.logger.error(
            `LDAP auth failed on provider ${provider.name}: ${err.message}`,
          );
          return resolve(null);
        }

        if (ldapUser) {
          this.logger.log(`LDAP auth successful on provider ${provider.name}`);

          let email = ldapUser.mail as string | undefined;
          if (!email && ldapUser.proxyAddresses) {
            const addrs = Array.isArray(ldapUser.proxyAddresses)
              ? ldapUser.proxyAddresses
              : [ldapUser.proxyAddresses];
            const smtpAddr = addrs.find((addr) => addr.toLowerCase().startsWith('smtp:'));
            if (smtpAddr) email = smtpAddr.substring(5);
          }

          if (!email) {
            this.logger.error('LDAP user has no email attribute. Access denied.');
            return resolve(null);
          }

          const externalId = ldapUser.dn ?? username;
          const candidateUsername =
            (typeof ldapUser.sAMAccountName === 'string' && ldapUser.sAMAccountName.trim())
            || (typeof ldapUser.uid === 'string' && ldapUser.uid.trim())
            || (typeof ldapUser.cn === 'string' && ldapUser.cn.trim())
            || (typeof ldapUser.displayName === 'string' && ldapUser.displayName.trim())
            || username;
          const user = await this.usersService.findOrCreateExternalUser(
            email,
            externalId,
            AuthMethod.LDAP,
            provider.id,
            candidateUsername || null,
          );

          // Group sync — additive only, identical contract to OIDC.
          // Default ON, configurable per provider so an admin who
          // manages bastion groups by hand can keep the IdP out of it.
          if (config.syncGroups !== false) {
            const attrName =
              (config.groupsAttribute || DEFAULT_LDAP_GROUPS_ATTRIBUTE).trim();
            let groupNames = this.extractGroupAttribute(
              (ldapUser as unknown as Record<string, unknown>)[attrName],
            );

            // Fallback path: OpenLDAP without the memberof overlay
            // doesn't populate `memberOf` on the user — group entries
            // only carry a `member` pointing at the user DN. Do the
            // reverse search ourselves so admins don't have to twist
            // their schema for sync to work. Requires `bindDn` /
            // `bindPassword` for the read; without them we silently
            // skip (no anonymous group enumeration).
            if (groupNames.length === 0 && ldapUser.dn) {
              if (config.bindDn && config.bindPassword) {
                try {
                  groupNames = await this.reverseGroupSearch(
                    ldapUser.dn,
                    config,
                  );
                  if (groupNames.length > 0) {
                    this.logger.log(
                      `LDAP reverse search found ${groupNames.length} group(s) for ${email}`,
                    );
                  }
                } catch (e) {
                  this.logger.warn(
                    `LDAP reverse group search failed for ${email} on ${provider.name}: ${(e as Error).message}`,
                  );
                }
              } else {
                this.logger.debug(
                  `LDAP user ${email}: "${attrName}" empty and no bindDn/bindPassword — skip reverse search`,
                );
              }
            }

            if (groupNames.length > 0) {
              try {
                await this.usersService.syncExternalGroups(
                  user.id,
                  groupNames,
                  {
                    providerId: provider.id,
                    ipAddress: null,
                    authMethod: AuthMethod.LDAP,
                  },
                );
              } catch (e) {
                // Don't break the login because the directory dropped a
                // weirdly-shaped group entry — log and move on. The
                // user is in; an admin sees the warning in the bastion
                // logs.
                this.logger.warn(
                  `LDAP group sync failed for ${user.id} on provider ${provider.name}: ${(e as Error).message}`,
                );
              }
            } else {
              this.logger.debug(
                `LDAP user ${email}: no groups found (attribute "${attrName}" empty and reverse search yielded nothing)`,
              );
            }
          }

          return resolve(user);
        }

        resolve(null);
      });
    });
  }

  /**
   * Reverse group search: opens a fresh authenticated connection to
   * the LDAP server, searches the configured groups subtree for
   * entries whose membership filter matches the user's DN, and
   * returns the `cn` values found.
   *
   * Used as a fallback when `memberOf` is empty on the user entry —
   * typical of OpenLDAP without the `memberof` overlay (the schema
   * keeps the relation only on the group side via `member`).
   *
   * We do NOT pass `tlsOptions` from the provider config to keep this
   * helper focused — the search account already authenticated in the
   * upstream bind path. If your LDAP server requires special TLS we
   * trust the original ldapauth-fork bind to have failed earlier.
   */
  private async reverseGroupSearch(
    userDn: string,
    config: LdapProviderConfig,
  ): Promise<string[]> {
    // `ldapjs` ships no type declarations and DefinitelyTyped's
    // package is wildly out-of-date vs. v3, so we go through the
    // node require + structural cast (dynamic `import()` types
    // can't be silenced cleanly without an ambient module decl).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ldap = require('ldapjs') as {
      createClient: (opts: Record<string, unknown>) => LdapjsClient;
    };
    const searchBase = (config.groupsSearchBase || config.searchBase).trim();
    const filterTemplate =
      config.groupsSearchFilter || DEFAULT_LDAP_GROUPS_SEARCH_FILTER;
    const filter = filterTemplate.replace(/{{userDn}}/g, escapeLdapFilter(userDn));

    // Diagnostic: an admin staring at "found 0 group(s)" needs to know
    // WHERE we searched and WHAT we asked for. Log at info level —
    // these are the exact two strings to paste into ldapsearch to
    // reproduce manually.
    this.logger.log(
      `LDAP group search: base="${searchBase}" filter="${filter}"`,
    );

    return new Promise<string[]>((resolve, reject) => {
      const client = ldap.createClient({
        url: config.url,
        // Default 5s — better to fail fast than block the login flow
        // on a misconfigured directory.
        connectTimeout: 5_000,
        timeout: 5_000,
      });

      let settled = false;
      const finish = (groups: string[]) => {
        if (settled) return;
        settled = true;
        try { client.unbind(); } catch { /* noop */ }
        resolve(groups);
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try { client.unbind(); } catch { /* noop */ }
        reject(err);
      };

      client.on('error', (err: Error) => fail(err));

      client.bind(config.bindDn!, config.bindPassword!, (bindErr: Error | null) => {
        if (bindErr) return fail(bindErr);

        client.search(
          searchBase,
          { filter, scope: 'sub', attributes: ['cn'] },
          (searchErr: Error | null, res: LdapjsSearchEmitter) => {
            if (searchErr) return fail(searchErr);

            const found: string[] = [];
            res.on('searchEntry', (entry: LdapjsEntry) => {
              // ldapjs v3: `pojo` holds attribute values as
              // `{type, values}` arrays. We accept either format
              // defensively because the public API changes shape
              // between v2 and v3.
              const pojo = (entry?.pojo ?? entry?.object ?? {}) as Record<
                string,
                unknown
              > & { attributes?: Array<{ type: string; values: unknown[] }> };
              const attrs = pojo.attributes;
              const cn: unknown =
                pojo.cn ??
                (Array.isArray(attrs)
                  ? attrs.find((a) => a.type?.toLowerCase() === 'cn')?.values
                  : undefined);
              if (Array.isArray(cn)) {
                cn.forEach((v) => typeof v === 'string' && found.push(v));
              } else if (typeof cn === 'string') {
                found.push(cn);
              }
            });
            res.on('error', (e: Error) => fail(e));
            res.on('end', () => {
              finish(
                Array.from(
                  new Set(found.map((g) => g.trim()).filter((g) => g.length > 0 && g.length <= 200)),
                ),
              );
            });
          },
        );
      });
    });
  }

  /**
   * Normalise an LDAP group attribute (typically `memberOf`) into a
   * list of trimmed, unique group names. Each entry can be either a
   * full DN (`cn=Admins,ou=groups,dc=corp,dc=local`) or a flat name
   * depending on the schema — we extract the CN component when present
   * so bastion `Group.name` stays human-readable, and fall back to the
   * raw value when the entry doesn't start with `cn=`.
   *
   * Guards:
   *  - non-string entries dropped
   *  - empty / 500+ char DNs ignored (defensive against junk data)
   *  - resulting names > 200 chars dropped (matches the upsert path)
   *  - duplicates removed
   */
  private extractGroupAttribute(raw: unknown): string[] {
    let entries: string[];
    if (Array.isArray(raw)) {
      entries = raw.filter((v): v is string => typeof v === 'string');
    } else if (typeof raw === 'string' && raw.trim().length > 0) {
      entries = [raw];
    } else {
      return [];
    }

    const out: string[] = [];
    for (const entry of entries) {
      const trimmed = entry.trim();
      if (!trimmed || trimmed.length > 500) continue;
      const cnMatch = /^cn=([^,]+)/i.exec(trimmed);
      const name = cnMatch ? (cnMatch[1] ?? '').trim() : trimmed;
      if (name && name.length <= 200) out.push(name);
    }
    return Array.from(new Set(out));
  }
}
