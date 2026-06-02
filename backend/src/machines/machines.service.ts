import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';
import { Prisma, Role } from '@prisma/client';
import { SshService } from '../terminal/ssh.service';

@Injectable()
export class MachinesService {
  constructor(
    private prisma: PrismaService,
    private vault: VaultService,
    private ssh: SshService,
  ) {}

  async createMachine(
    data: Prisma.MachineCreateInput,
    secretData: { username: string; password?: string; privateKey?: string },
  ) {
    const { username, password, privateKey } = secretData;

    return this.prisma.$transaction(async (tx) => {
      const machine = await tx.machine.create({
        data: data, // Fingerprint is now provided by admin via DTO
      });

      await tx.secret.create({
        data: {
          machineId: machine.id,
          // Using machine.id as contextual encryption data (AAD)
          encryptedUsername: this.vault.encrypt(username, machine.id),
          encryptedPassword: password
            ? this.vault.encrypt(password, machine.id)
            : null,
          encryptedPrivateKey: privateKey
            ? this.vault.encrypt(privateKey, machine.id)
            : null,
        },
      });

      return machine;
    });
  }

  async updateMachine(id: string, data: any) {
    const { username, password, privateKey, ...machineData } = data;

    return this.prisma.$transaction(async (tx) => {
      const machine = await tx.machine.update({
        where: { id },
        data: machineData,
      });

      if (username || password || privateKey) {
        const updateData: any = {};
        if (username)
          updateData.encryptedUsername = this.vault.encrypt(username, id);
        if (password)
          updateData.encryptedPassword = this.vault.encrypt(password, id);
        if (privateKey)
          updateData.encryptedPrivateKey = this.vault.encrypt(privateKey, id);

        await tx.secret.update({
          where: { machineId: id },
          data: updateData,
        });
      }

      return machine;
    });
  }

  async probeFingerprint(ip: string, port: number): Promise<string> {
    return this.ssh.getFingerprint(ip, port);
  }

  async findAll() {
    return this.prisma.machine.findMany({
      include: { machineGroup: true },
    });
  }

  async findAllAccessible(userId: string, role: Role) {
    if (role === 'ADMIN') {
      const all = await this.findAll();
      // Admins implicitly manage every machine.
      return all.map((m) => ({ ...m, accessLevel: 'ADMIN' as const }));
    }

    // The groups this user belongs to, so we can attribute group-granted
    // permissions to them when computing the effective access level.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { groups: { select: { id: true } } },
    });
    const groupIds = new Set((user?.groups ?? []).map((g) => g.id));

    const machines = await this.prisma.machine.findMany({
      where: {
        OR: [
          { permissions: { some: { userId } } },
          {
            permissions: {
              some: { group: { users: { some: { id: userId } } } },
            },
          },
          { machineGroup: { permissions: { some: { userId } } } },
          {
            machineGroup: {
              permissions: {
                some: { group: { users: { some: { id: userId } } } },
              },
            },
          },
        ],
      },
      // Pull permissions (machine + machine group) so we can compute the
      // caller's highest access level per machine and expose it to the UI.
      include: {
        machineGroup: { include: { permissions: true } },
        permissions: true,
      },
    });

    const rank: Record<string, number> = { OPERATOR: 1, OWNER: 2 };
    const label = [null, 'OPERATOR', 'OWNER'] as const;

    return machines.map((m) => {
      let best = 0;
      const consider = (perm: {
        userId: string | null;
        groupId: string | null;
        level: string;
      }) => {
        const mine =
          perm.userId === userId ||
          (!!perm.groupId && groupIds.has(perm.groupId));
        if (mine) best = Math.max(best, rank[perm.level] ?? 0);
      };
      m.permissions.forEach(consider);
      m.machineGroup?.permissions?.forEach(consider);

      // Don't leak the raw permission rows to the client; only the resolved
      // level + a slim machineGroup reference.
      const { permissions: _perms, machineGroup, ...rest } = m;
      return {
        ...rest,
        machineGroup: machineGroup
          ? { id: machineGroup.id, name: machineGroup.name }
          : null,
        accessLevel: best ? label[best] : null,
      };
    });
  }

  async findOne(id: string) {
    const machine = await this.prisma.machine.findUnique({
      where: { id },
      include: { machineGroup: true },
    });
    if (!machine) throw new NotFoundException('Machine not found');
    return machine;
  }

  async getDecryptedSecret(machineId: string) {
    const secret = await this.prisma.secret.findUnique({
      where: { machineId },
    });
    if (!secret)
      throw new NotFoundException('Secret not found for this machine');

    // Contextual decryption using machineId
    return {
      username: this.vault.decrypt(secret.encryptedUsername, machineId),
      password: secret.encryptedPassword
        ? this.vault.decrypt(secret.encryptedPassword, machineId)
        : undefined,
      privateKey: secret.encryptedPrivateKey
        ? this.vault.decrypt(secret.encryptedPrivateKey, machineId)
        : undefined,
    };
  }

  async deleteMachine(id: string) {
    return this.prisma.machine.delete({ where: { id } });
  }
}
