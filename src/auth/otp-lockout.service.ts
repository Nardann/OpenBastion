import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OTP_MAX_ATTEMPTS,
  OTP_BACKOFF_BASE_MS,
  OTP_BACKOFF_MAX_MS,
} from '../common/constants/security.constants';

@Injectable()
export class OtpLockoutService {
  constructor(private prisma: PrismaService) {}

  async assertNotLocked(userId: string): Promise<void> {
    const record = await this.prisma.otpLockout.findUnique({ where: { userId } });
    if (!record) return;

    if (record.attempts >= OTP_MAX_ATTEMPTS && record.lockedUntil) {
      if (record.lockedUntil > new Date()) {
        const waitSec = Math.ceil((record.lockedUntil.getTime() - Date.now()) / 1000);
        throw new UnauthorizedException(
          `Too many OTP attempts. Please wait ${waitSec}s before retrying.`,
        );
      }
    }
  }

  async recordFailure(userId: string): Promise<void> {
    const record = await this.prisma.otpLockout.upsert({
      where: { userId },
      update: { attempts: { increment: 1 } },
      create: { userId, attempts: 1 },
    });

    const attempts = record.attempts;
    const backoffMs = Math.min(
      OTP_BACKOFF_BASE_MS * Math.pow(2, attempts - 1),
      OTP_BACKOFF_MAX_MS,
    );
    const lockedUntil = new Date(Date.now() + backoffMs);

    await this.prisma.otpLockout.update({
      where: { userId },
      data: { lockedUntil },
    });
  }

  async reset(userId: string): Promise<void> {
    await this.prisma.otpLockout.deleteMany({ where: { userId } });
  }
}
