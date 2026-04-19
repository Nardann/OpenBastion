import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthMethod } from '@prisma/client';

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
  constructor(private prisma: PrismaService) {}

  async logAction(
    userId: string | null,
    action: string,
    metadata?: any,
    authMethod?: AuthMethod,
    ipAddress?: string,
    category: AuditCategory = AuditCategory.SYSTEM,
  ) {
    // Récupérer le snapshot utilisateur si disponible
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

    return this.prisma.auditLog.create({
      data: {
        userId,
        userSnapshot: userSnapshot as any,
        action,
        category,
        metadata: metadata
          ? typeof metadata === 'object'
            ? metadata
            : { value: metadata }
          : null,
        authMethod: authMethod ?? null,
        ipAddress: ipAddress ?? null,
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
              // SECURITY FIX: Don't expose emails in audit logs
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
}
