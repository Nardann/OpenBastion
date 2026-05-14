import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom throttler guard.
 *
 * SECURITY (F-01 fix): we override ONLY `getTracker` so that requests are
 * counted per authenticated user (when a JWT is present) rather than just
 * by IP — that lets us cap user actions even behind a NAT/CGNAT.
 *
 * We deliberately DO NOT override `getThrottlers` anymore. The previous
 * implementation returned only the `user` throttler, which silently
 * neutralised every per-route `@Throttle({ auth: { ... } })` decorator
 * on login / login-otp / sudo / oidc / refresh / otp endpoints. The
 * intended `THROTTLE_AUTH_LIMIT=20 / 15 min` was never enforced — brute
 * force was capped only by the much looser anonymous user throttle
 * (~30/min). Letting the parent `getThrottlers` resolve the active set
 * from `ThrottlerModule.forRoot([...])` + the route-level `@Throttle`
 * metadata restores the declarative behaviour intended by the auth
 * controller.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const userId: string | undefined = req.user?.sub;
    return userId ?? req.ip ?? 'unknown';
  }
}
