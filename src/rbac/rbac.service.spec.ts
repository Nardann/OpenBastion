import { Test, TestingModule } from '@nestjs/testing';
import { RbacService } from './rbac.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessLevel, Role } from '@prisma/client';

describe('RbacService', () => {
  let service: RbacService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<RbacService>(RbacService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hasAccess', () => {
    it('should return true for ADMIN role regardless of permissions', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1',
        role: Role.ADMIN,
        groups: [],
        permissions: [],
      });

      const result = await service.hasAccess(
        'user1',
        'machine1',
        AccessLevel.OWNER,
      );
      expect(result).toBe(true);
    });

    it('should return true if user has sufficient direct permission', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1',
        role: Role.USER,
        groups: [],
        permissions: [{ level: AccessLevel.OPERATOR }],
      });

      const result = await service.hasAccess(
        'user1',
        'machine1',
        AccessLevel.OPERATOR,
      );
      expect(result).toBe(true);
    });

    it('should return false if direct permission level is insufficient', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1',
        role: Role.USER,
        groups: [],
        permissions: [{ level: AccessLevel.VIEWER }],
      });

      const result = await service.hasAccess(
        'user1',
        'machine1',
        AccessLevel.OPERATOR,
      );
      expect(result).toBe(false);
    });

    it('should return true if user inherits sufficient permission from a group', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1',
        role: Role.USER,
        permissions: [],
        groups: [
          {
            permissions: [{ level: AccessLevel.OWNER }],
          },
        ],
      });

      const result = await service.hasAccess(
        'user1',
        'machine1',
        AccessLevel.OPERATOR,
      );
      expect(result).toBe(true);
    });

    it('should return false if no permissions found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1',
        role: Role.USER,
        permissions: [],
        groups: [],
      });

      const result = await service.hasAccess(
        'user1',
        'machine1',
        AccessLevel.VIEWER,
      );
      expect(result).toBe(false);
    });
  });
});
