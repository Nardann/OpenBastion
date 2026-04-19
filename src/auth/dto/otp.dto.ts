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
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'Le code OTP doit être composé de 6 chiffres',
  })
  code!: string;
}
