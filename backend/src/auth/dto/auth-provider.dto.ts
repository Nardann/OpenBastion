import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuthProviderType } from '@prisma/client';

class LdapTlsOptionsDto {
  @IsOptional()
  @IsBoolean()
  rejectUnauthorized?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(16384, { message: 'CA bundle trop volumineux' })
  ca?: string;
}

export class LdapProviderConfigDto {
  // ldap:// or ldaps:// only
  @IsString()
  @MaxLength(512)
  @Matches(/^ldaps?:\/\/[A-Za-z0-9._:\[\]\-]+(\/[^\s]*)?$/, {
    message: 'URL LDAP invalide (ldap:// ou ldaps:// uniquement)',
  })
  url!: string;

  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9 ,._=\-]+$/, { message: 'searchBase invalide' })
  searchBase!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  searchFilter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9 ,._=\-]+$/, { message: 'bindDn invalide' })
  bindDn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  bindPassword?: string;

  @IsOptional()
  @IsBoolean()
  isActiveDirectory?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => LdapTlsOptionsDto)
  tlsOptions?: LdapTlsOptionsDto;

  // Group sync — see LdapProviderConfig for semantics.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_\-]+$/, { message: 'groupsAttribute invalide' })
  groupsAttribute?: string;

  // Reverse-lookup fallback (used when `groupsAttribute` is empty on the
  // user entry — typical of OpenLDAP without the memberof overlay).
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9 ,._=\-]+$/, { message: 'groupsSearchBase invalide' })
  groupsSearchBase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  groupsSearchFilter?: string;

  @IsOptional()
  @IsBoolean()
  syncGroups?: boolean;
}

export class OidcProviderConfigDto {
  // SECURITY: HTTPS-only. The TLS-bypass dev helper is gone (CodeQL alert
  // dismissed by removal), so accepting `http://` here would silently
  // expose the OIDC handshake (state, code, client_secret in the body)
  // over plaintext. Self-signed certs are fine — unencrypted is not.
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] })
  @MaxLength(512)
  issuer!: string;

  @IsString()
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9._\-:]+$/, { message: 'clientId invalide' })
  clientId!: string;

  @IsString()
  @MaxLength(2048)
  clientSecret!: string;

  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] })
  @MaxLength(512)
  redirectUri!: string;

  @IsOptional()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsObject()
  claimsMapping?: { email?: string; sub?: string };

  /**
   * Lab mode: skip TLS verification + accept private-IP discovery
   * endpoints for THIS provider only. Use for self-hosted IdPs on a LAN
   * with a self-signed cert (Authentik / Keycloak / Authelia). Never set
   * this in production. See OidcProviderConfig for the security trade-off.
   */
  @IsOptional()
  @IsBoolean()
  allowInsecureTls?: boolean;

  // Groups sync — see OidcProviderConfig for semantics.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_\-]+$/, { message: 'groupsClaim invalide' })
  groupsClaim?: string;

  @IsOptional()
  @IsBoolean()
  syncGroups?: boolean;
}

/**
 * Body of POST /auth/admin/providers — create.
 * `config` is validated structurally by `validateProviderConfig` below
 * because `class-validator` lacks native discriminated-union support.
 */
export class CreateAuthProviderDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9 ._\-]+$/, {
    message: 'Le nom ne peut contenir que des lettres, chiffres, espaces, points, tirets ou underscores',
  })
  name!: string;

  @IsEnum(AuthProviderType, { message: 'type doit être LDAP ou OIDC' })
  type!: AuthProviderType;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsObject()
  config!: Record<string, unknown>;
}

/**
 * Body of PATCH /auth/admin/providers/:id — partial update.
 * `type` is intentionally NOT mutable: switching a provider's protocol
 * after users were JIT-provisioned against it would orphan them.
 */
export class UpdateAuthProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9 ._\-]+$/, {
    message: 'Le nom ne peut contenir que des lettres, chiffres, espaces, points, tirets ou underscores',
  })
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export const AUTH_PROVIDER_TYPES = ['LDAP', 'OIDC'] as const;
export type AuthProviderTypeName = typeof AUTH_PROVIDER_TYPES[number];

// Helper: enforce the right per-type DTO shape after class-validator on the
// outer object. Returns a typed config object, or throws the validation
// errors as a flat list of messages.
export async function validateProviderConfig(
  type: AuthProviderTypeName,
  raw: Record<string, unknown>,
): Promise<LdapProviderConfigDto | OidcProviderConfigDto> {
  const { plainToInstance } = await import('class-transformer');
  const { validate } = await import('class-validator');

  const instance: object =
    type === 'LDAP'
      ? plainToInstance(LdapProviderConfigDto, raw, {
          excludeExtraneousValues: false,
          enableImplicitConversion: true,
        })
      : plainToInstance(OidcProviderConfigDto, raw, {
          excludeExtraneousValues: false,
          enableImplicitConversion: true,
        });

  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length) {
    const messages = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .filter(Boolean);
    const err: Error & { details?: string[] } = new Error(
      'Configuration provider invalide',
    );
    err.details = messages;
    throw err;
  }
  return instance as LdapProviderConfigDto | OidcProviderConfigDto;
}

// Re-export the IsIn helper so callers can constrain enabled type strings.
export { IsIn };
