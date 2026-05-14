import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed_pass'),
}));

describe('UsersService', () => {
  let service: UsersService;

  const mockPrisma = {
    user: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should hash password and call prisma.create', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'plainpassword',
        role: 'USER',
      };
      const hashedPass = 'hashed_pass';

      mockPrisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'uuid-123', ...data }),
      );

      const result = await service.create(userData);

      expect(argon2.hash).toHaveBeenCalledWith('plainpassword');
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          role: 'USER',
          passwordHash: hashedPass,
        },
      });
      expect(result.passwordHash).toBe(hashedPass);
    });

    it('should work without password (e.g. for external users)', async () => {
      const userData = {
        email: 'ext@example.com',
        authMethod: 'LDAP',
        externalId: 'dn=123',
      };
      mockPrisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'uuid-456', ...data }),
      );

      await service.create(userData);

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'ext@example.com',
          passwordHash: undefined,
        }),
      });
    });
  });
});
