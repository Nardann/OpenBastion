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

    const record = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token révoqué ou expiré');
    }

    // Revoke old, issue new (rotation)
    await this.prisma.refreshToken.update({
      where: { jti: payload.jti },
      data: { revokedAt: new Date() },
    });

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
