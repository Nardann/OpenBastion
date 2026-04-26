import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { AuthMethod } from '@prisma/client';
import * as crypto from 'node:crypto';

export enum AuditCategory {
  AUTH = 'AUTH',
  USER = 'USER',
  GROUP = 'GROUP',
  MACHINE = 'MACHINE',
  PERMISSION = 'PERMISSION',
  SYSTEM = 'SYSTEM',
  TERMINAL = 'TERMINAL',
}

@Injectable()
export class AuditService {
  private readonly hmacKey: Buffer;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const vaultKey = this.config.get('VAULT_KEY') ?? '';
    // Derive a dedicated HMAC key from VAULT_KEY so it's independent from encryption keys.
    this.hmacKey = crypto
      .createHmac('sha256', Buffer.from(vaultKey, 'hex'))
      .update('audit-log-hmac-v1')
      .digest();
  }

  private computeHmac(entry: {
    id: string;
    action: string;
    userId: string | null;
    timestamp: Date;
    category: string | null;
    ipAddress: string | null;
    metadata: any;
    userSnapshot: any;
  }): string {
    const payload = JSON.stringify({
      id: entry.id,
      action: entry.action,
      userId: entry.userId ?? null,
      timestamp: entry.timestamp.toISOString(),
      category: entry.category ?? null,
      ipAddress: entry.ipAddress ?? null,
      metadata: entry.metadata ?? null,
      userSnapshot: entry.userSnapshot ?? null,
    });
    return crypto.createHmac('sha256', this.hmacKey).update(payload).digest('hex');
  }

  async logAction(
    userId: string | null,
    action: string,
    metadata?: any,
    authMethod?: AuthMethod,
    ipAddress?: string,
    category: AuditCategory = AuditCategory.SYSTEM,
  ) {
    let userSnapshot = null;
    if (userId) {
      const user = await this.prisma.user
        .findUnique({
          where: { id: userId },
          select: { email: true, username: true, role: true },
        })
        .catch(() => null);
      if (user) userSnapshot = user;
    }

    // Build the entry data so we can include it in the HMAC before creation.
    // We generate the ID ourselves to have it available for the HMAC.
    const id = crypto.randomUUID();
    const timestamp = new Date();

    const normalizedMetadata = metadata
      ? typeof metadata === 'object'
        ? metadata
        : { value: metadata }
      : null;

    const hmac = this.computeHmac({
      id,
      action,
      userId: userId ?? null,
      timestamp,
      category: category ?? null,
      ipAddress: ipAddress ?? null,
      metadata: normalizedMetadata,
      userSnapshot,
    });

    return this.prisma.auditLog.create({
      data: {
        id,
        userId,
        userSnapshot: userSnapshot as any,
        action,
        category,
        metadata: normalizedMetadata,
        authMethod: authMethod ?? null,
        ipAddress: ipAddress ?? null,
        timestamp,
        hmac,
      },
    });
  }

  async getLogs(category?: string, page: number = 1, limit: number = 50) {
    const where: any = {};
    if (category) {
      where.category = category;
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              role: true,
              authMethod: true,
            },
          },
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async verifyIntegrity(limit: number = 1000): Promise<{
    checked: number;
    tampered: string[];
    nullHmac: number;
  }> {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    const tampered: string[] = [];
    let nullHmac = 0;

    for (const log of logs) {
      if (!log.hmac) {
        nullHmac++;
        continue;
      }
      const expected = this.computeHmac({
        id: log.id,
        action: log.action,
        userId: log.userId ?? null,
        timestamp: log.timestamp,
        category: log.category ?? null,
        ipAddress: log.ipAddress ?? null,
        metadata: log.metadata ?? null,
        userSnapshot: log.userSnapshot ?? null,
      });
      if (expected !== log.hmac) {
        tampered.push(log.id);
      }
    }

    return { checked: logs.length, tampered, nullHmac };
  }
}
