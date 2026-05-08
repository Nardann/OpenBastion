import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  THROTTLE_USER_TTL,
  THROTTLE_USER_LIMIT_ADMIN,
  THROTTLE_USER_LIMIT_USER,
  THROTTLE_USER_LIMIT_ANON,
} from '../constants/security.constants';

/**
 * Throttles by authenticated userId when a JWT is present,
 * falling back to IP for anonymous requests.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const userId: string | undefined = req.user?.sub;
    return userId ?? req.ip ?? 'unknown';
  }

  protected getThrottlers(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const role: string | undefined = req.user?.role;

    const limit =
      role === 'ADMIN'
        ? THROTTLE_USER_LIMIT_ADMIN
        : role === 'USER'
          ? THROTTLE_USER_LIMIT_USER
          : THROTTLE_USER_LIMIT_ANON;

    return Promise.resolve([
      { name: 'user', ttl: THROTTLE_USER_TTL, limit },
    ]);
  }
}
