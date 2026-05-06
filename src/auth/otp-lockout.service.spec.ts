import { Test, TestingModule } from '@nestjs/testing';
import { OtpLockoutService } from './otp-lockout.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';
import {
  OTP_MAX_ATTEMPTS,
  OTP_BACKOFF_BASE_MS,
  OTP_BACKOFF_MAX_MS,
} from '../common/constants/security.constants';

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

  describe('assertNotLocked', () => {
    it('should not throw when no record exists', async () => {
      mockPrisma.otpLockout.findUnique.mockResolvedValue(null);
      await expect(service.assertNotLocked('u1')).resolves.toBeUndefined();
    });

    it('should not throw when attempts < max', async () => {
      mockPrisma.otpLockout.findUnique.mockResolvedValue({ attempts: 3, lockedUntil: null });
      await expect(service.assertNotLocked('u1')).resolves.toBeUndefined();
    });

    it('should throw when locked and lockout is in the future', async () => {
      const lockedUntil = new Date(Date.now() + 60_000);
      mockPrisma.otpLockout.findUnique.mockResolvedValue({ attempts: OTP_MAX_ATTEMPTS, lockedUntil });
      await expect(service.assertNotLocked('u1')).rejects.toThrow(UnauthorizedException);
    });

    it('should not throw when lockout has expired', async () => {
      const lockedUntil = new Date(Date.now() - 1000);
      mockPrisma.otpLockout.findUnique.mockResolvedValue({ attempts: OTP_MAX_ATTEMPTS, lockedUntil });
      await expect(service.assertNotLocked('u1')).resolves.toBeUndefined();
    });
  });

  describe('recordFailure', () => {
    it('should upsert and set exponential backoff', async () => {
      mockPrisma.otpLockout.upsert.mockResolvedValue({ attempts: 1 });
      mockPrisma.otpLockout.update.mockResolvedValue({});

      await service.recordFailure('u1');

      expect(mockPrisma.otpLockout.upsert).toHaveBeenCalled();
      expect(mockPrisma.otpLockout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
        }),
      );
    });

    it('should cap backoff at OTP_BACKOFF_MAX_MS', async () => {
      // Simulate many attempts
      mockPrisma.otpLockout.upsert.mockResolvedValue({ attempts: 100 });
      mockPrisma.otpLockout.update.mockResolvedValue({});

      await service.recordFailure('u1');

      const updateCall = mockPrisma.otpLockout.update.mock.calls[0][0];
      const lockedUntil: Date = updateCall.data.lockedUntil;
      const backoffMs = lockedUntil.getTime() - Date.now();
      // Should be within 10% of max (allowing for timing)
      expect(backoffMs).toBeLessThanOrEqual(OTP_BACKOFF_MAX_MS + 500);
      expect(backoffMs).toBeGreaterThan(OTP_BACKOFF_BASE_MS);
    });
  });

  describe('reset', () => {
    it('should delete lockout record', async () => {
      mockPrisma.otpLockout.deleteMany.mockResolvedValue({ count: 1 });
      await service.reset('u1');
      expect(mockPrisma.otpLockout.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });
  });
});
