import { IsString, MinLength, Matches, MaxLength } from 'class-validator';

/**
 * Multi-provider login DTO. `providerId` is either the literal string
 * `'local'` (built-in Argon2id auth) or the UUID of an enabled
 * `AuthProvider` row.
 */
export class LoginDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^(local|[0-9a-fA-F-]{36})$/, {
    message: 'providerId invalide',
  })
  providerId!: string;

  @IsString()
  @MinLength(3, { message: "L'identifiant doit faire au moins 3 caractères" })
  @MaxLength(254)
  identifier!: string;

  @IsString()
  @MinLength(1, { message: 'Le mot de passe est requis' })
  password!: string;
}
