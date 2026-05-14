import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessLevel } from '@prisma/client';

@Injectable()
export class RbacService {
  constructor(private prisma: PrismaService) {}

  async hasAccess(
    userId: string,
    machineId: string,
    requiredLevel: AccessLevel,
  ): Promise<boolean> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { machineGroupId: true },
    });

    const user = (await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        groups: {
          include: {
            permissions: {
              where: {
                OR: [
                  { machineId: { equals: machineId } },
                  {
                    machineGroupId: { equals: machine?.machineGroupId ?? null },
                  },
                ],
              },
            },
          },
        },
        permissions: {
          where: {
            OR: [
              { machineId: { equals: machineId } },
              { machineGroupId: { equals: machine?.machineGroupId ?? null } },
            ],
          },
        },
      },
    })) as any; // Cast to any to access included relations without complex type definitions

    if (!user) return false;
    if (user.role === 'ADMIN') return true;

    // Check direct permissions (on machine or machine group)
    if (user.permissions) {
      for (const perm of user.permissions) {
        if (this.isLevelSufficient(perm.level, requiredLevel)) {
          return true;
        }
      }
    }

    // Check group permissions (on machine or machine group)
    if (user.groups) {
      for (const group of user.groups) {
        if (group.permissions) {
          for (const perm of group.permissions) {
            if (this.isLevelSufficient(perm.level, requiredLevel)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  private isLevelSufficient(
    actual: AccessLevel,
    required: AccessLevel,
  ): boolean {
    const levels: Record<AccessLevel, number> = {
      VIEWER: 1,
      OPERATOR: 2,
      OWNER: 3,
    };
    const actualValue = levels[actual] ?? 0;
    const requiredValue = levels[required] ?? 0;
    return actualValue >= requiredValue;
  }
}
