export interface LdapProviderConfig {
  url: string;
  searchBase: string;
  searchFilter?: string;
  bindDn?: string;
  bindPassword?: string;
  isActiveDirectory?: boolean;
  tlsOptions?: {
    rejectUnauthorized?: boolean;
    ca?: string;
  };
}

export interface OidcProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /**
   * Space-delimited scope list. Defaults to
   * `['openid', 'email', 'profile', 'groups']` — the `groups` scope is
   * what makes Authentik / Keycloak include the group memberships in the
   * userinfo response. Override only if your IdP uses a different name.
   */
  scopes?: string[];
  claimsMapping?: {
    email?: string;
    sub?: string;
  };
  /**
   * Userinfo claim that carries the group memberships. Defaults to
   * `groups`. Authentik / Keycloak emit `groups`; some hand-rolled IdPs
   * use `roles` or `memberOf`. The claim value must be an array of
   * strings (group names) for sync to take effect.
   */
  groupsClaim?: string;
  /**
   * When true (default), on every successful OIDC login we read the
   * group claim, create any Group rows that don't exist yet, and attach
   * the user to them. Membership is **additive** — locally-created
   * groups stay attached even if the IdP doesn't list them. Turn off to
   * manage group membership entirely from inside the bastion UI.
   */
  syncGroups?: boolean;
  /**
   * Lab / homelab opt-in. When `true` for a specific provider:
   *  - TLS certificate verification is **disabled** for OIDC discovery,
   *    token exchange and userinfo calls (custom undici dispatcher).
   *  - The SSRF block on private / loopback / link-local IPs in the
   *    discovery document is **lifted** for this provider only — needed
   *    for self-hosted IdPs (Authentik / Keycloak on the LAN).
   *
   * NEVER set this in production. Use a properly signed certificate and
   * a public hostname instead. Audit logs flag every login that goes
   * through an insecure provider so abuse stays visible.
   */
  allowInsecureTls?: boolean;
}

export interface AuthProviderRecord {
  id: string;
  name: string;
  type: 'LDAP' | 'OIDC';
  enabled: boolean;
  config: LdapProviderConfig | OidcProviderConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthProviderCreateDto {
  name: string;
  type: 'LDAP' | 'OIDC';
  enabled?: boolean;
  config: LdapProviderConfig | OidcProviderConfig;
}

export interface AuthProviderUpdateDto {
  name?: string;
  config?: LdapProviderConfig | OidcProviderConfig;
  enabled?: boolean;
}
