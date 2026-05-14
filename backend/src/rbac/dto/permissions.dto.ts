import { IsUUID, IsEnum, IsOptional, ValidateIf } from 'class-validator';
import { AccessLevel } from '@prisma/client';

export class CreatePermissionDto {
  @IsOptional()
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Group ID must be a valid UUID' })
  groupId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Machine ID must be a valid UUID' })
  machineId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Machine Group ID must be a valid UUID' })
  machineGroupId?: string;

  @IsEnum(AccessLevel, {
    message: `Access level must be one of: ${Object.values(AccessLevel).join(', ')}`,
  })
  level!: AccessLevel;

  // SECURITY FIX: Validate that exactly one of userId or groupId is provided
  @ValidateIf((o) => {
    const hasUserId = !!o.userId;
    const hasGroupId = !!o.groupId;
    return (hasUserId && hasGroupId) || (!hasUserId && !hasGroupId);
  })
  oneOfUserIdOrGroupId() {
    return false;
  }

  // NEW VALIDATION: Validate that exactly one of machineId or machineGroupId is provided
  @ValidateIf((o) => {
    const hasMachineId = !!o.machineId;
    const hasMachineGroupId = !!o.machineGroupId;
    return (
      (hasMachineId && hasMachineGroupId) ||
      (!hasMachineId && !hasMachineGroupId)
    );
  })
  oneOfMachineIdOrMachineGroupId() {
    return false;
  }
}
