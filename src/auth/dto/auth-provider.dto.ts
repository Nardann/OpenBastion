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
}

export class OidcProviderConfigDto {
  // Force https for issuer + redirectUri (only http://localhost is acceptable
  // and only when the operator opts in via OIDC_ALLOW_INSECURE_TLS).
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(512)
  issuer!: string;

  @IsString()
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9._\-:]+$/, { message: 'clientId invalide' })
  clientId!: string;

  @IsString()
  @MaxLength(2048)
  clientSecret!: string;

  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(512)
  redirectUri!: string;

  @IsOptional()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsObject()
  claimsMapping?: { email?: string; sub?: string };
}

/**
 * Body of POST /auth/providers/upsert and PATCH /auth/providers/:id.
 * `config` is validated structurally below in the controller depending on
 * `type`, since `class-validator` doesn't have native discriminated union
 * support and we want a single endpoint for both protocols.
 */
export class UpsertAuthProviderDto {
  @IsEnum(AuthProviderType, { message: 'type doit être LDAP ou OIDC' })
  type!: AuthProviderType;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsObject()
  config!: Record<string, unknown>;
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
