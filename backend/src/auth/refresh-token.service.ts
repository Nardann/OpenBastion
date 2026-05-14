import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  JWT_REFRESH_EXPIRATION_SECONDS,
  JWT_REFRESH_EXPIRATION_STRING,
} from '../common/constants/security.constants';
import * as crypto from 'node:crypto';

@Injectable()
export class RefreshTokenService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async create(userId: string): Promise<string> {
    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + JWT_REFRESH_EXPIRATION_SECONDS * 1000);

    await this.prisma.refreshToken.create({ data: { jti, userId, expiresAt } });

    return this.jwtService.sign(
      { sub: userId, jti, type: 'refresh' },
      { expiresIn: JWT_REFRESH_EXPIRATION_STRING },
    );
  }

  async rotate(refreshToken: string): Promise<{ userId: string; newToken: string }> {
    let payload: { sub: string; jti: string; type: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken);
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token type incorrect');
    }

    // SECURITY: atomic compare-and-revoke so two concurrent rotations from
    // the same refresh token cannot both succeed (otherwise both the
    // legitimate user and an attacker that intercepted the token end up
    // with valid sessions).
    const updated = await this.prisma.refreshToken.updateMany({
      where: {
        jti: payload.jti,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });

    if (updated.count === 0) {
      // The token either never existed, was already revoked, or expired.
      // If it once existed (we have a record by jti) but is now revoked,
      // this is a REUSE of a rotated refresh token → treat as compromise:
      // kill the entire family for this user (RFC 6819 §5.2.2.3).
      const stale = await this.prisma.refreshToken.findUnique({
        where: { jti: payload.jti },
      });
      if (stale && stale.userId) {
        await this.prisma.$transaction([
          this.prisma.refreshToken.updateMany({
            where: { userId: stale.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
          this.prisma.user.update({
            where: { id: stale.userId },
            data: { tokenVersion: { increment: 1 } },
          }),
        ]);
      }
      throw new UnauthorizedException('Refresh token révoqué ou expiré');
    }

    // Re-read the record we just revoked to know who it belonged to.
    const record = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });
    if (!record) throw new UnauthorizedException('Refresh token introuvable');

    const newToken = await this.create(record.userId);
    return { userId: record.userId, newToken };
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async cleanupExpired(): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
