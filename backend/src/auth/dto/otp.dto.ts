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

  // SECURITY: when OTP is not enabled, the admin must re-enter their password
  // to prove fresh consent before getting the elevated isAdminMode token.
  // (For LOCAL accounts. OIDC/LDAP admins MUST enable OTP — enforced server
  // side.)
  @IsOptional()
  @IsString()
  password?: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'Le code OTP doit être composé de 6 chiffres',
  })
  code!: string;
}
