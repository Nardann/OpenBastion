import { Test, TestingModule } from '@nestjs/testing';
import { OtpLockoutService } from './otp-lockout.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';
import {
  OTP_MAX_ATTEMPTS,
  OTP_BACKOFF_BASE_MS,
  OTP_BACKOFF_MAX_MS,
} from '../common/constants/security.constants';

/**
 * F-04 fix: the previous public contract was
 *   1. `assertNotLocked` (read, throws if locked)
 *   2. verify the OTP
 *   3. `recordFailure` (atomic increment + backoff) — too late: N
 *      concurrent attempts all passed step 1 before any increment
 *
 * The new contract is a single atomic operation called BEFORE the OTP
 * is verified: `consumeAttempt` upserts the counter and sets the
 * backoff window in one shot. The legacy entry points are kept as
 * compatibility shims so any external caller still compiles.
 *
 * This spec covers both the new contract and the shim behaviour.
 */
describe('OtpLockoutService', () => {
  let service: OtpLockoutService;
  const mockPrisma = {
    otpLockout: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpLockoutService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OtpLockoutService>(OtpLockoutService);
  });

  describe('consumeAttempt (new atomic contract)', () => {
    it('upserts a slot and resolves silently when below the cap', async () => {
      mockPrisma.otpLockout.findUnique.mockResolvedValue(null);
      mockPrisma.otpLockout.upsert.mockResolvedValue({ attempts: 1, lockedUntil: null });

      await expect(service.consumeAttempt('u1')).resolves.toBeUndefined();

      expect(mockPrisma.otpLockout.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          update: { attempts: { increment: 1 } },
          create: { userId: 'u1', attempts: 1 },
        }),
      );
      // No update() yet — we are not past the cap.
      expect(mockPrisma.otpLockout.update).not.toHaveBeenCalled();
    });

    it('rejects without touching the row when a current lock window is active', async () => {
      const lockedUntil = new Date(Date.now() + 60_000);
      mockPrisma.otpLockout.findUnique.mockResolvedValue({ attempts: OTP_MAX_ATTEMPTS, lockedUntil });

      await expect(service.consumeAttempt('u1')).rejects.toThrow(UnauthorizedException);

      // Hard gate: refuse before incrementing.
      expect(mockPrisma.otpLockout.upsert).not.toHaveBeenCalled();
    });

    it('sets a backoff window and rejects when the increment pushes past the cap', async () => {
      mockPrisma.otpLockout.findUnique.mockResolvedValue(null);
      mockPrisma.otpLockout.upsert.mockResolvedValue({ attempts: OTP_MAX_ATTEMPTS + 1, lockedUntil: null });
      mockPrisma.otpLockout.update.mockResolvedValue({});

      await expect(service.consumeAttempt('u1')).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.otpLockout.upsert).toHaveBeenCalled();
      expect(mockPrisma.otpLockout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
        }),
      );
    });

    it('caps the backoff at OTP_BACKOFF_MAX_MS even for very high overflows', async () => {
      mockPrisma.otpLockout.findUnique.mockResolvedValue(null);
      // Simulate the user being far past the cap (e.g. burst lots of times).
      mockPrisma.otpLockout.upsert.mockResolvedValue({ attempts: OTP_MAX_ATTEMPTS + 100, lockedUntil: null });
      mockPrisma.otpLockout.update.mockResolvedValue({});

      await expect(service.consumeAttempt('u1')).rejects.toThrow(UnauthorizedException);

      const updateCall = mockPrisma.otpLockout.update.mock.calls[0][0];
      const lockedUntil: Date = updateCall.data.lockedUntil;
      const backoffMs = lockedUntil.getTime() - Date.now();
      expect(backoffMs).toBeLessThanOrEqual(OTP_BACKOFF_MAX_MS + 500);
      expect(backoffMs).toBeGreaterThan(OTP_BACKOFF_BASE_MS);
    });

    it('SECURITY (F-04): two concurrent calls only consume one increment each — no burst escape', async () => {
      mockPrisma.otpLockout.findUnique.mockResolvedValue(null);
      // Simulate the row-level serialisation Prisma provides on the unique
      // constraint: each call returns a strictly monotonic attempts value.
      let counter = 0;
      mockPrisma.otpLockout.upsert.mockImplementation(async () => ({
        attempts: ++counter,
        lockedUntil: null,
      }));

      const results = await Promise.allSettled([
        service.consumeAttempt('u1'),
        service.consumeAttempt('u1'),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      // Both upserts happened — the SQL upsert is the synchronisation
      // point. Neither call could observe a stale counter.
      expect(mockPrisma.otpLockout.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('legacy shims', () => {
    it('assertNotLocked delegates to consumeAttempt (counts the attempt)', async () => {
      mockPrisma.otpLockout.findUnique.mockResolvedValue(null);
      mockPrisma.otpLockout.upsert.mockResolvedValue({ attempts: 1 });
      await service.assertNotLocked('u1');
      expect(mockPrisma.otpLockout.upsert).toHaveBeenCalled();
    });

    it('recordFailure is now a no-op (increment already happened in consumeAttempt)', async () => {
      await service.recordFailure('u1');
      expect(mockPrisma.otpLockout.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.otpLockout.update).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should delete the lockout record', async () => {
      mockPrisma.otpLockout.deleteMany.mockResolvedValue({ count: 1 });
      await service.reset('u1');
      expect(mockPrisma.otpLockout.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });
  });
});
