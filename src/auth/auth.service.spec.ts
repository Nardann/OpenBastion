import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { LdapService } from './ldap.service';
import { AuthMethod } from '@prisma/client';
import * as argon2 from 'argon2';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let ldapService: LdapService;
  let usersService: UsersService;

  const mockUsersService = {
    findOneByEmail: jest.fn(),
    findOneById: jest.fn(),
    update: jest.fn(),
  };

  const mockLdapService = {
    authenticate: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(() => 'mock-token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: LdapService, useValue: mockLdapService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    ldapService = module.get<LdapService>(LdapService);
    usersService = module.get<UsersService>(UsersService);
  });

  describe('changePassword', () => {
    it('should change password with valid current password', async () => {
      const userId = 'user1';
      const currentPass = 'oldPassword123!';
      const newPass = 'newPassword123!';
      const hash = await argon2.hash(currentPass);

      const user = {
        id: userId,
        authMethod: AuthMethod.LOCAL,
        passwordHash: hash,
      };

      mockUsersService.findOneById.mockResolvedValue(user);
      mockUsersService.update.mockResolvedValue({
        ...user,
        passwordHash: 'new_hash',
      });

      const result = await service.changePassword(userId, currentPass, newPass);
      expect(result).toBeDefined();
      expect(mockUsersService.update).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for invalid current password', async () => {
      const userId = 'user1';
      const user = {
        id: userId,
        authMethod: AuthMethod.LOCAL,
        passwordHash: await argon2.hash('correctPassword'),
      };

      mockUsersService.findOneById.mockResolvedValue(user);

      await expect(
        service.changePassword(userId, 'wrongPassword', 'newPass123!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException for non-LOCAL users', async () => {
      const userId = 'user1';
      const user = {
        id: userId,
        authMethod: AuthMethod.LDAP,
        passwordHash: null,
      };

      mockUsersService.findOneById.mockResolvedValue(user);

      await expect(
        service.changePassword(userId, 'any', 'newPass123!'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateUser', () => {
    it('should validate local user with correct password', async () => {
      const password = 'password123';
      const hash = await argon2.hash(password);
      const user = {
        id: 'u1',
        email: 'test@local.com',
        passwordHash: hash,
        authMethod: AuthMethod.LOCAL,
      };

      mockUsersService.findOneByEmail.mockResolvedValue(user);

      const result = await service.validateUser(
        user.email,
        password,
        AuthMethod.LOCAL,
      );
      expect(result).toBeDefined();
      expect(result.email).toBe(user.email);
    });

    it('should fail local user with wrong password', async () => {
      const user = {
        id: 'u1',
        email: 'test@local.com',
        passwordHash: await argon2.hash('correct'),
        authMethod: AuthMethod.LOCAL,
      };

      mockUsersService.findOneByEmail.mockResolvedValue(user);

      const result = await service.validateUser(
        user.email,
        'wrong',
        AuthMethod.LOCAL,
      );
      expect(result).toBeNull();
    });
  });
});
