import {
  IsString,
  IsInt,
  IsOptional,
  Matches,
  IsEmail,
  MinLength,
  MaxLength,
  Min,
  Max,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { Role, Protocol, RdpSecurity } from '@prisma/client';

const SAFE_TEXT_REGEX = /^[a-zA-Z0-9\s._-]*$/; // Allow empty strings
const IP_HOSTNAME_REGEX = /^[^<>"&]+$/;
const USERNAME_REGEX = /^[^<>"&]+$/;
// Simplified password complexity check to avoid Regex syntax issues
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_\-=[\]{};':",.<>/?\\|`~]).+$/;

export class CreateMachineDto {
  @IsString()
  @IsNotEmpty({ message: 'Le nom ne peut pas être vide' })
  @MaxLength(255)
  @Matches(SAFE_TEXT_REGEX, { message: 'Caractères non autorisés dans le nom' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: "L'adresse IP ne peut pas être vide" })
  @MaxLength(255)
  @Matches(IP_HOSTNAME_REGEX, {
    message: 'IP/Host non valide (évitez: <, >, &, ")',
  })
  ip!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsOptional()
  @IsEnum(Protocol, { message: 'Le protocole doit être SSH, RDP ou VNC' })
  protocol?: Protocol;

  @IsOptional()
  @MaxLength(500)
  @Matches(SAFE_TEXT_REGEX)
  description?: string;

  // Empreinte SSH : obligatoire UNIQUEMENT pour le protocole SSH.
  // Pour RDP/VNC elle est ignoree (guacd gere ses propres certificats TLS).
  @ValidateIf((o) => !o.protocol || o.protocol === Protocol.SSH)
  @IsString()
  @IsNotEmpty({ message: "Empreinte SSH obligatoire pour le protocole SSH" })
  @Matches(/^SHA256:[A-Za-z0-9+/=]{43,}$/, {
    message: "Format d'empreinte SHA256 (SHA256:Base64...) obligatoire",
  })
  sshFingerprint?: string;

  @IsString()
  @IsNotEmpty({ message: "Le nom d'utilisateur ne peut pas être vide" })
  @MaxLength(255)
  @Matches(USERNAME_REGEX, {
    message: 'Username non valide (évitez: <, >, &, ")',
  })
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  password?: string;

  // Cle privee SSH : uniquement pertinent pour SSH.
  @ValidateIf((o) => !o.protocol || o.protocol === Protocol.SSH)
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  privateKey?: string;

  // ---- Parametres specifiques RDP (optionnels, ignores pour SSH) ----
  @IsOptional()
  @IsEnum(RdpSecurity, {
    message: 'rdpSecurity doit etre ANY, RDP, TLS ou NLA',
  })
  rdpSecurity?: RdpSecurity;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  rdpIgnoreCert?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[^<>"&]*$/, { message: 'Domaine AD invalide' })
  rdpDomain?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  allowTunneling?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  allowRebound?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  allowCopyPaste?: boolean;

  @IsOptional()
  @IsUUID('4', { message: 'machineGroupId doit être un UUID valide' })
  machineGroupId?: string;
}

export class UpdateMachineDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(SAFE_TEXT_REGEX)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(IP_HOSTNAME_REGEX, { message: 'IP/Host non valide' })
  ip?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsEnum(Protocol, { message: 'Le protocole doit être SSH, RDP ou VNC' })
  protocol?: Protocol;

  @IsOptional()
  @MaxLength(500)
  @Matches(SAFE_TEXT_REGEX)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^SHA256:[A-Za-z0-9+/=]{43,}$/, {
    message: "Format d'empreinte SHA256 (SHA256:Base64...) invalide",
  })
  sshFingerprint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(USERNAME_REGEX)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  privateKey?: string;

  // ---- RDP ----
  @IsOptional()
  @IsEnum(RdpSecurity, {
    message: 'rdpSecurity doit etre ANY, RDP, TLS ou NLA',
  })
  rdpSecurity?: RdpSecurity;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  rdpIgnoreCert?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[^<>"&]*$/, { message: 'Domaine AD invalide' })
  rdpDomain?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  allowTunneling?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  allowRebound?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value;
  })
  @IsBoolean()
  allowCopyPaste?: boolean;

  @IsOptional()
  @IsUUID('4', { message: 'machineGroupId doit être un UUID valide' })
  machineGroupId?: string;
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @IsString()
  @MinLength(12, {
    message: 'Le mot de passe doit contenir au moins 12 caractères',
  })
  @Matches(PASSWORD_REGEX, {
    message:
      'Le mot de passe doit contenir majuscules, minuscules, chiffres et caractères spéciaux',
  })
  password!: string;

  @IsEnum(Role, { message: 'Le rôle doit être ADMIN ou USER' })
  role!: Role;
}

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @Matches(PASSWORD_REGEX, {
    message:
      'Le mot de passe doit contenir majuscules, minuscules, chiffres et caractères spéciaux',
  })
  password?: string;

  @IsOptional()
  @IsEnum(Role, { message: 'Le rôle doit être ADMIN ou USER' })
  role?: Role;
}

export class UpdateMeDto {
  @IsOptional()
  @IsEmail({}, { message: 'L\'adresse email doit être valide' })
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @Matches(PASSWORD_REGEX, { message: 'Le mot de passe doit être complexe' })
  password?: string;
}
