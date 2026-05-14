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
  scopes?: string[];
  claimsMapping?: {
    email?: string;
    sub?: string;
  };
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
  config: LdapProviderConfig | OidcProviderConfig;
}

export interface AuthProviderUpdateDto {
  config?: LdapProviderConfig | OidcProviderConfig;
  enabled?: boolean;
}
