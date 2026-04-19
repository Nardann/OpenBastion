import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsController } from './permissions.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AccessLevel } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('PermissionsController', () => {
  let controller: PermissionsController;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    permission: {
      create: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    controller = module.get<PermissionsController>(PermissionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should resolve email to userId if provided', async () => {
      const email = 'test@example.com';
      const userId = 'uuid-123';
      const machineId = 'machine-123';

      mockPrisma.user.findUnique.mockResolvedValue({ id: userId });
      mockPrisma.permission.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'perm-1', ...data }),
      );

      const result = await controller.create({
        userId: email,
        machineId,
        level: AccessLevel.OPERATOR,
      });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email },
        select: { id: true },
      });
      expect(result.userId).toBe(userId);
      expect(mockPrisma.permission.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException if email is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        controller.create({
          userId: 'nonexistent@example.com',
          machineId: 'm1',
          level: AccessLevel.VIEWER,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use userId directly if it is not an email', async () => {
      const userId = 'uuid-direct';
      mockPrisma.permission.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'p1', ...data }),
      );

      await controller.create({
        userId,
        machineId: 'm1',
        level: AccessLevel.OPERATOR,
      });

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.permission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId }),
      });
    });
  });
});
