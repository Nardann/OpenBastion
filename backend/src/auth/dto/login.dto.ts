import { IsString, MinLength, IsEnum } from 'class-validator';
import { AuthMethod } from '@prisma/client';

export class LoginDto {
  @IsString()
  @MinLength(3, { message: "L'identifiant doit faire au moins 3 caractères" })
  identifier!: string;

  @IsString()
  @MinLength(1, { message: 'Le mot de passe est requis' })
  password!: string;

  @IsEnum(AuthMethod, { message: "Méthode d'authentification invalide" })
  authMethod!: AuthMethod;
}
