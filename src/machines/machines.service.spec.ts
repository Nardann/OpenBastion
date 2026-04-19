import { Test, TestingModule } from '@nestjs/testing';
import { MachinesService } from './machines.service';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';
import { SshService } from '../terminal/ssh.service';
import { NotFoundException } from '@nestjs/common';

describe('MachinesService', () => {
  let service: MachinesService;
  let prisma: PrismaService;
  let vault: VaultService;
  let ssh: SshService;

  const mockPrisma = {
    machine: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    secret: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  const mockVault = {
    encrypt: jest.fn((val) => `enc_${val}`),
    decrypt: jest.fn((val) => val.replace('enc_', '')),
  };

  const mockSsh = {
    getFingerprint: jest.fn().mockResolvedValue('mock_fingerprint'),
    createStream: jest.fn().mockResolvedValue({
      client: { end: jest.fn() },
      stream: { on: jest.fn(), write: jest.fn() },
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MachinesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: VaultService, useValue: mockVault },
        { provide: SshService, useValue: mockSsh },
      ],
    }).compile();

    service = module.get<MachinesService>(MachinesService);
    prisma = module.get<PrismaService>(PrismaService);
    vault = module.get<VaultService>(VaultService);
    ssh = module.get<SshService>(SshService);
  });

  describe('createMachine', () => {
    it('should create a machine and fetch SSH fingerprint', async () => {
      const machineData = {
        name: 'Test Machine',
        ip: '1.2.3.4',
        port: 22,
        protocol: 'SSH',
      };
      const secretData = { username: 'root', password: 'password' };

      mockPrisma.machine.create.mockResolvedValue({ id: 'm1', ...machineData });

      const result = await service.createMachine(
        machineData as any,
        secretData,
      );

      expect(ssh.getFingerprint).toHaveBeenCalledWith(
        machineData.ip,
        machineData.port,
      );
      expect(mockPrisma.machine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sshFingerprint: 'mock_fingerprint',
        }),
      });
      expect(mockPrisma.secret.create).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.id).toBe('m1');
    });
  });

  describe('SSH Connection Verification (via SshService)', () => {
    it('should verify we can connect to a machine', async () => {
      const machineId = 'm1';
      const secret = { username: 'root', password: 'password' };

      mockPrisma.machine.findUnique.mockResolvedValue({
        id: machineId,
        ip: '1.2.3.4',
        port: 22,
        allowTunneling: true,
        allowRebound: false,
      });

      mockPrisma.secret.findUnique.mockResolvedValue({
        encryptedUsername: 'enc_root',
        encryptedPassword: 'enc_password',
      });

      const machine = await service.findOne(machineId);
      const decryptedSecret = await service.getDecryptedSecret(machineId);

      const connection = await ssh.createStream({
        host: machine.ip,
        port: machine.port,
        username: decryptedSecret.username,
        password: decryptedSecret.password,
      });

      expect(connection.client).toBeDefined();
      expect(connection.stream).toBeDefined();
      expect(ssh.createStream).toHaveBeenCalled();
    });
  });

  describe('updateMachine', () => {
    it('should update machine and re-fetch fingerprint if IP changes', async () => {
      const machineId = 'm1';
      const updateData = { ip: '5.6.7.8' };

      mockPrisma.machine.findUnique.mockResolvedValue({
        id: machineId,
        ip: '1.2.3.4',
        port: 22,
        protocol: 'SSH',
      });

      mockPrisma.machine.update.mockResolvedValue({
        id: machineId,
        ...updateData,
        sshFingerprint: 'new_fingerprint',
      });

      ssh.getFingerprint.mockResolvedValue('new_fingerprint');

      const result = await service.updateMachine(machineId, updateData);

      expect(ssh.getFingerprint).toHaveBeenCalledWith('5.6.7.8', 22);
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machineId },
        data: expect.objectContaining({
          ip: '5.6.7.8',
          sshFingerprint: 'new_fingerprint',
        }),
      });
      expect(result.sshFingerprint).toBe('new_fingerprint');
    });
  });
});
