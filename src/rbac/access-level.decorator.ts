import { SetMetadata } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';

export const ACCESS_LEVEL_KEY = 'accessLevel';
export const RequireAccessLevel = (level: AccessLevel) =>
  SetMetadata(ACCESS_LEVEL_KEY, level);
