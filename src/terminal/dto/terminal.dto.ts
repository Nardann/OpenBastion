import { IsInt, Min, Max, IsUUID } from 'class-validator';

export class StartSessionDto {
  @IsUUID('4', { message: 'ID machine invalide' })
  machineId!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  cols!: number;

  @IsInt()
  @Min(1)
  @Max(200)
  rows!: number;
}

export class ResizeSessionDto {
  @IsInt()
  @Min(1)
  @Max(500)
  cols!: number;

  @IsInt()
  @Min(1)
  @Max(200)
  rows!: number;
}
