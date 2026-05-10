import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SECURITY tests for the refresh-token rotation flow.
 *
 * The fixes under audit (Fix A & Fix D in the security report) require:
 *   1. Atomic compare-and-revoke — two concurrent rotations of the same
 *      refresh token cannot both succeed (race condition).
 *   2. Reuse detection — if a refresh token is rotated and the SAME token
 *      is presented again, the entire family is revoked (RFC 6819 §5.2.2.3).
 *   3. Admin revoke-tokens MUST also revoke refresh tokens — otherwise
 *      /auth/refresh hands the user a new access token after revocation.
 *      (The latter is tested in users.service.spec.ts.)
 */
describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  const refreshTokenStore = new Map<string, {
    jti: string;
    userId: string;
    expiresAt: Date;
    revokedAt: Date | null;
  }>();

  const mockPrisma = {
    refreshToken: {
      create: jest.fn(async ({ data }: any) => {
        refreshTokenStore.set(data.jti, {
          jti: data.jti,
          userId: data.userId,
          expiresAt: data.expiresAt,
          revokedAt: null,
        });
        return refreshTokenStore.get(data.jti);
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        return refreshTokenStore.get(where.jti) ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const rec = refreshTokenStore.get(where.jti);
        if (!rec) throw new Error('not found');
        Object.assign(rec, data);
        return rec;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const rec of refreshTokenStore.values()) {
          if (where.jti && rec.jti !== where.jti) continue;
          if (where.userId && rec.userId !== where.userId) continue;
          if (where.revokedAt === null && rec.revokedAt !== null) continue;
          if (where.expiresAt?.gt && !(rec.expiresAt > where.expiresAt.gt)) continue;
          Object.assign(rec, data);
          count++;
        }
        return { count };
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    user: {
      update: jest.fn(async () => ({ id: 'u1', tokenVersion: 1 })),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  // Fake JwtService that returns a deterministic payload from the token
  // string we emit. We encode the jti+userId in the token directly so the
  // verify step can recover it.
  const mockJwt: Partial<JwtService> = {
    sign: ((payload: any) =>
      Buffer.from(JSON.stringify(payload)).toString('base64')) as any,
    verifyAsync: (async (token: string) => {
      return JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    }) as any,
  };

  beforeEach(async () => {
    refreshTokenStore.clear();
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();
    service = module.get<RefreshTokenService>(RefreshTokenService);
  });

  it('rotates a valid refresh token and issues a new one', async () => {
    const token = await service.create('u1');
    const result = await service.rotate(token);
    expect(result.userId).toBe('u1');
    expect(result.newToken).toBeDefined();
    expect(result.newToken).not.toBe(token);
  });

  it('rejects rotation of an already-revoked refresh token (REUSE) and revokes the family', async () => {
    const token = await service.create('u1');
    // Legitimate rotation → token now revoked, new one issued
    const { newToken } = await service.rotate(token);

    // REUSE: attacker presents the original (now stale) token
    await expect(service.rotate(token)).rejects.toThrow(UnauthorizedException);

    // Family must be revoked: the freshly-issued newToken is now revoked too
    await expect(service.rotate(newToken)).rejects.toThrow(UnauthorizedException);

    // tokenVersion must have been bumped on the user (kills any access JWT)
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { tokenVersion: { increment: 1 } },
      }),
    );
  });

  it('rejects rotation of an expired refresh token', async () => {
    const token = await service.create('u1');
    // Expire the record
    const stored = refreshTokenStore.values().next().value!;
    stored.expiresAt = new Date(Date.now() - 1000);

    await expect(service.rotate(token)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a forged refresh token whose jti is not in DB', async () => {
    // Build a token directly with a jti that was never created
    const fakeToken = Buffer.from(
      JSON.stringify({ sub: 'u1', jti: 'never-issued', type: 'refresh' }),
    ).toString('base64');
    await expect(service.rotate(fakeToken)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token whose `type` claim is not "refresh"', async () => {
    const wrongType = Buffer.from(
      JSON.stringify({ sub: 'u1', jti: 'whatever', type: 'access' }),
    ).toString('base64');
    await expect(service.rotate(wrongType)).rejects.toThrow(UnauthorizedException);
  });

  it('atomic compare-and-revoke: only one of two concurrent rotations succeeds', async () => {
    const token = await service.create('u1');

    // Both promises see the token as not revoked (same race window). The
    // updateMany is atomic: only the first one bumps `count` to 1, the
    // second sees count=0 → reuse detection path.
    const results = await Promise.allSettled([
      service.rotate(token),
      service.rotate(token),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it('revokeAllForUser flips every active token for that user', async () => {
    await service.create('u1');
    await service.create('u1');
    await service.create('u2');

    await service.revokeAllForUser('u1');

    const u1Active = [...refreshTokenStore.values()]
      .filter((r) => r.userId === 'u1' && r.revokedAt === null);
    const u2Active = [...refreshTokenStore.values()]
      .filter((r) => r.userId === 'u2' && r.revokedAt === null);

    expect(u1Active).toHaveLength(0);
    expect(u2Active).toHaveLength(1);
  });
});
