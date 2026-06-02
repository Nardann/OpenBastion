import { Injectable, ExecutionContext } from '@nestjs/common';
import {
  ThrottlerGuard,
  InjectThrottlerOptions,
  InjectThrottlerStorage,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

/**
 * Custom throttler guard.
 *
 * POLICY: rate limiting is intentionally scoped to AUTHENTICATION only.
 * Once a request carries a VALID JWT session cookie, we skip throttling
 * entirely — logged-in users browsing machines, recordings or audit logs
 * are never rate limited. Unauthenticated requests (login / login-otp /
 * password-reset / OIDC, etc.) still go through the `auth` throttler so
 * brute force against the authentication surface stays capped.
 *
 * NOTE: this guard runs as a global APP_GUARD, i.e. BEFORE the controller
 * level `JwtAuthGuard`, so `req.user` is not populated yet. We therefore
 * verify the `jwt` cookie's signature ourselves. We deliberately verify
 * (not just sniff for presence) so an attacker can't bypass the login
 * throttle by attaching a junk `jwt` cookie to brute-force requests.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async shouldSkip(
    context: ExecutionContext,
  ): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token: string | undefined = req?.cookies?.jwt;
    if (token) {
      try {
        this.jwtService.verify(token);
        // Valid session → authenticated user → never throttled.
        return true;
      } catch {
        // Invalid/expired token: fall through and apply the throttle.
      }
    }
    return super.shouldSkip(context);
  }

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    return req.ip ?? 'unknown';
  }
}
