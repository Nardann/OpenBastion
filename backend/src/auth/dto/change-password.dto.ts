import { IsString, MinLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Le mot de passe actuel est requis' })
  currentPassword!: string;

  @IsString()
  @MinLength(12, {
    message: 'Le mot de passe doit faire au moins 12 caractères',
  })
  @Matches(/(?=.*[A-Z])/, {
    message: 'Le mot de passe doit contenir au moins une majuscule',
  })
  @Matches(/(?=.*[0-9])/, {
    message: 'Le mot de passe doit contenir au moins un chiffre',
  })
  @Matches(/(?=.*[!@#$%^&*()\-_=+[\]{};:'",.<>?/\\|`~])/, {
    message: 'Le mot de passe doit contenir au moins un caractère spécial',
  })
  password!: string;
}
