import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SECURITY test for Fix A.
 *
 * BEFORE the fix, `POST /users/:id/revoke-tokens` only bumped `tokenVersion`,
 * which invalidated the access JWT but NOT the refresh token. A malicious
 * client could call /auth/refresh and get a new access JWT. This is a
 * critical bypass — admins thought the session was killed when it wasn't.
 *
 * AFTER the fix, revokeAllTokens MUST run inside a Prisma $transaction that
 * also revokes every active refresh token for the user.
 */
describe('UsersService.revokeAllTokens', () => {
  let service: UsersService;

  const mockPrisma = {
    user: {
      update: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  it('runs user.update + refreshToken.updateMany inside a single transaction', async () => {
    mockPrisma.user.update.mockResolvedValue({
      id: 'u1', email: 'a@b', role: 'USER', authMethod: 'LOCAL',
      passwordHash: null, tokenVersion: 1, externalId: null,
      otpSecret: null, pendingOtpSecret: null, isOtpEnabled: false,
      requiresPasswordChange: false,
      createdAt: new Date(), updatedAt: new Date(),
    });
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    await service.revokeAllTokens('u1');

    // Both Prisma calls were enqueued
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    // And wrapped in $transaction (atomic)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns the sanitized user (no passwordHash, no tokenVersion, no otpSecret)', async () => {
    mockPrisma.user.update.mockResolvedValue({
      id: 'u1', email: 'a@b', role: 'USER', authMethod: 'LOCAL',
      passwordHash: 'argon2id$secret', tokenVersion: 99,
      externalId: 'ext', otpSecret: 'otp-secret', pendingOtpSecret: 'pend',
      isOtpEnabled: false, requiresPasswordChange: false,
      createdAt: new Date(), updatedAt: new Date(),
    });
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.revokeAllTokens('u1') as Record<string, unknown>;

    expect(result['passwordHash']).toBeUndefined();
    expect(result['tokenVersion']).toBeUndefined();
    expect(result['otpSecret']).toBeUndefined();
    expect(result['pendingOtpSecret']).toBeUndefined();
    expect(result['externalId']).toBeUndefined();
    expect(result['email']).toBe('a@b');
  });
});
