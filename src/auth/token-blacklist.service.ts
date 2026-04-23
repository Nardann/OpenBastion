import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as crypto from 'node:crypto';

@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredTokens() {
    try {
      const { count } = await this.prisma.blacklistedToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        this.logger.log(`Cleaned up ${count} expired tokens from blacklist`);
      }
    } catch (e) {
      this.logger.error(
        `Failed to cleanup expired tokens: ${(e as Error).message}`,
      );
    }
  }

  async add(token: string) {
    try {
      const decoded = this.jwtService.decode(token);
      if (!decoded?.exp) {
        this.logger.warn('Token has no expiration claim, cannot blacklist');
        throw new Error('Invalid token format: missing exp claim');
      }

      const expiresAt = new Date(decoded.exp * 1000);
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      await this.prisma.blacklistedToken.upsert({
        where: { token: tokenHash },
        update: {},
        create: {
          token: tokenHash,
          expiresAt,
        },
      });
    } catch (e) {
      this.logger.error(`Failed to blacklist token: ${(e as Error).message}`);
      throw e;
    }
  }

  async isBlacklisted(token: string): Promise<boolean> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const found = await this.prisma.blacklistedToken.findUnique({
      where: { token: tokenHash },
    });

    if (!found) return false;

    if (found.expiresAt < new Date()) {
      return false;
    }

    return true;
  }
}
