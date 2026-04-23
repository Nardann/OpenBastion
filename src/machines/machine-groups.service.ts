import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MachineGroup, Prisma, Role } from '@prisma/client';

@Injectable()
export class MachineGroupsService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.MachineGroupCreateInput): Promise<MachineGroup> {
    return this.prisma.machineGroup.create({ data });
  }

  async findAll(): Promise<MachineGroup[]> {
    return this.prisma.machineGroup.findMany({
      include: {
        machines: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findAllAccessible(userId: string, role: Role): Promise<MachineGroup[]> {
    if (role === 'ADMIN') return this.findAll();

    return this.prisma.machineGroup.findMany({
      where: {
        OR: [
          // Direct or group permission on the MachineGroup itself
          { permissions: { some: { userId } } },
          {
            permissions: {
              some: { group: { users: { some: { id: userId } } } },
            },
          },
          // OR the MachineGroup has machines that the user has access to
          {
            machines: {
              some: {
                OR: [
                  { permissions: { some: { userId } } },
                  {
                    permissions: {
                      some: { group: { users: { some: { id: userId } } } },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      include: {
        machines: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<MachineGroup | null> {
    return this.prisma.machineGroup.findUnique({
      where: { id },
      include: {
        machines: true,
      },
    });
  }

  async findByName(name: string): Promise<MachineGroup | null> {
    return this.prisma.machineGroup.findUnique({
      where: { name },
    });
  }

  async update(
    id: string,
    data: Prisma.MachineGroupUpdateInput,
  ): Promise<MachineGroup> {
    return this.prisma.machineGroup.update({
      where: { id },
      data,
      include: { machines: true },
    });
  }

  async remove(id: string): Promise<MachineGroup> {
    // Ungroup all machines before deleting group
    await this.prisma.machine.updateMany({
      where: { machineGroupId: id },
      data: { machineGroupId: null },
    });

    return this.prisma.machineGroup.delete({
      where: { id },
    });
  }
}
