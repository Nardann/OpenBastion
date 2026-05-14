import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class StartRdpSessionDto {
  @IsUUID('4', { message: 'ID machine invalide' })
  machineId!: string;

  @IsInt()
  @Min(640)
  @Max(4096)
  width!: number;

  @IsInt()
  @Min(480)
  @Max(2160)
  height!: number;
}

export class ResizeRdpDto {
  @IsInt()
  @Min(640)
  @Max(4096)
  width!: number;

  @IsInt()
  @Min(480)
  @Max(2160)
  height!: number;
}
