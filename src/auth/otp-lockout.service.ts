import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OTP_MAX_ATTEMPTS,
  OTP_BACKOFF_BASE_MS,
  OTP_BACKOFF_MAX_MS,
} from '../common/constants/security.constants';

/**
 * SECURITY (F-04 fix): the previous implementation was vulnerable to a
 * concurrent-burst race. `assertNotLocked` was a pure read; an attacker
 * firing N requests in parallel saw `attempts=0` in all of them, passed
 * the gate, then verified N OTP codes. The atomic `recordFailure` upsert
 * came AFTER verification — too late to limit the per-burst attempt count.
 *
 * Fix: replace the two-step "check then record" pattern with a single
 * atomic "consume an attempt slot" operation that runs BEFORE the OTP is
 * verified. `consumeAttempt` upserts and inspects the post-increment
 * value; if it exceeds the cap, the lockout window is set and the call
 * rejects. Either way the attempt is counted, so N parallel calls only
 * get to verify the cap's worth of slots before the rest are rejected.
 *
 * On successful OTP verification, `reset()` is called by the auth flow
 * to clear the counter (existing behaviour).
 */
@Injectable()
export class OtpLockoutService {
  constructor(private prisma: PrismaService) {}

  /**
   * Atomically consume one verification slot.
   *
   *   - resolves silently if the user is allowed to attempt this OTP
   *   - throws UnauthorizedException if locked or if this attempt
   *     pushes the counter past the cap
   *
   * Must be called BEFORE the OTP secret is checked. The increment is
   * permanent on this attempt; only `reset()` (called on success) brings
   * the counter back to zero.
   */
  async consumeAttempt(userId: string): Promise<void> {
    // 1. Hard gate: if a lockout window is currently active, refuse
    //    before incrementing. (We still increment AFTER the window
    //    expires — that path is handled by step 2/3.)
    const existing = await this.prisma.otpLockout.findUnique({ where: { userId } });
    if (
      existing &&
      existing.attempts >= OTP_MAX_ATTEMPTS &&
      existing.lockedUntil &&
      existing.lockedUntil > new Date()
    ) {
      const waitSec = Math.ceil(
        (existing.lockedUntil.getTime() - Date.now()) / 1000,
      );
      throw new UnauthorizedException(
        `Too many OTP attempts. Please wait ${waitSec}s before retrying.`,
      );
    }

    // 2. Atomic increment-or-create. Two concurrent requests cannot both
    //    observe the same returned `attempts` value: Prisma serialises
    //    the upsert at the row level (single SQL statement, with the
    //    unique constraint on userId acting as the synchronisation
    //    point).
    const record = await this.prisma.otpLockout.upsert({
      where: { userId },
      update: { attempts: { increment: 1 } },
      create: { userId, attempts: 1 },
    });

    // 3. If this attempt pushed us past the cap, set the backoff window
    //    and reject. The verification logic upstream MUST NOT continue.
    if (record.attempts > OTP_MAX_ATTEMPTS) {
      const overflow = record.attempts - OTP_MAX_ATTEMPTS;
      const backoffMs = Math.min(
        OTP_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, overflow - 1)),
        OTP_BACKOFF_MAX_MS,
      );
      const lockedUntil = new Date(Date.now() + backoffMs);
      await this.prisma.otpLockout.update({
        where: { userId },
        data: { lockedUntil },
      });
      const waitSec = Math.ceil(backoffMs / 1000);
      throw new UnauthorizedException(
        `Too many OTP attempts. Please wait ${waitSec}s before retrying.`,
      );
    }
  }

  /**
   * Backward-compat wrappers. The auth flow that called
   * `assertNotLocked` then `recordFailure` is migrated to call
   * `consumeAttempt` ONCE before verifying. We keep these symbols so
   * any external caller still compiles.
   */
  async assertNotLocked(userId: string): Promise<void> {
    return this.consumeAttempt(userId);
  }

  async recordFailure(_userId: string): Promise<void> {
    // Intentionally a no-op: the increment happened atomically in
    // `consumeAttempt()` before the OTP was checked.
  }

  async reset(userId: string): Promise<void> {
    await this.prisma.otpLockout.deleteMany({ where: { userId } });
  }
}
