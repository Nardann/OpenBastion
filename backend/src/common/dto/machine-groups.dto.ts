import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsUUID,
} from 'class-validator';

export class CreateMachineGroupDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class UpdateMachineGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class AssignMachineGroupDto {
  @IsOptional()
  @IsUUID('4', { message: 'machineGroupId doit être un UUID valide' })
  machineGroupId?: string | null;
}
