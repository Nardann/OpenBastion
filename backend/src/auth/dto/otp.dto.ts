import { IsString, Matches, IsOptional } from 'class-validator';

export class LoginOtpDto {
  @IsString()
  tempToken!: string;

  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'Le code OTP doit être composé de 6 chiffres',
  })
  code!: string;
}

export class SudoDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'Le code OTP doit être composé de 6 chiffres',
  })
  code?: string;

  // SECURITY: when OTP is not enabled, the admin must re-prove identity to
  // get the elevated isAdminMode token. The accepted proof depends on the
  // account's auth method:
  //   - LOCAL: `password` (current local password)
  //   - LDAP:  `identifier` + `password` re-bound against the directory
  //   - OIDC:  this endpoint is NOT used. The browser is redirected to
  //            `GET /auth/sudo/oidc/:providerId/start` instead, which does
  //            an OIDC handshake with `prompt=login` for a fresh proof.
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  identifier?: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'Le code OTP doit être composé de 6 chiffres',
  })
  code!: string;
}
