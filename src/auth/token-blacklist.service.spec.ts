import { Test, TestingModule } from '@nestjs/testing';
import { TokenBlacklistService } from './token-blacklist.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

describe('TokenBlacklistService', () => {
  let service: TokenBlacklistService;

  const mockPrisma = {
    blacklistedToken: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockJwtService = {
    decode: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenBlacklistService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<TokenBlacklistService>(TokenBlacklistService);
  });

  describe('add', () => {
    it('should hash token and save to DB', async () => {
      const token = 'my-jwt-token';
      const exp = Math.floor(Date.now() / 1000) + 3600;
      mockJwtService.decode.mockReturnValue({ exp });

      const expectedHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      await service.add(token);

      expect(mockPrisma.blacklistedToken.upsert).toHaveBeenCalledWith({
        where: { token: expectedHash },
        update: {},
        create: expect.objectContaining({
          token: expectedHash,
        }),
      });
    });
  });

  describe('isBlacklisted', () => {
    it('should return true if token hash found in DB and not expired', async () => {
      const token = 'my-jwt-token';
      const expectedHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      mockPrisma.blacklistedToken.findUnique.mockResolvedValue({
        token: expectedHash,
        expiresAt: new Date(Date.now() + 10000),
      });

      const result = await service.isBlacklisted(token);
      expect(result).toBe(true);
    });

    it('should return false if token hash not in DB', async () => {
      mockPrisma.blacklistedToken.findUnique.mockResolvedValue(null);
      const result = await service.isBlacklisted('other-token');
      expect(result).toBe(false);
    });
  });
});
