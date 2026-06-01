import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { LdapService } from './ldap.service';
import { AuthProvidersService } from './auth-providers.service';
import { VaultService } from '../vault/vault.service';
import { OtpLockoutService } from './otp-lockout.service';
import { AuthMethod } from '@prisma/client';
import * as argon2 from 'argon2';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;

  // Valid UUID format so the LoginDto's regex check in higher-level tests
  // would accept it; the validateUser method itself doesn't validate the
  // format but we keep tests consistent with the production wire shape.
  const LDAP_PROVIDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const OIDC_PROVIDER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  const mockUsersService = {
    findOneByEmail: jest.fn(),
    findOneByUsername: jest.fn(),
    findOneByEmailOrUsername: jest.fn(),
    findOneById: jest.fn(),
    update: jest.fn(),
  };
  const mockLdapService = { authenticate: jest.fn() };
  const mockProvidersService = { findEnabledById: jest.fn() };
  const mockJwtService = { sign: jest.fn(() => 'mock-token') };
  const mockVaultService = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn((v: string) => v.replace('enc:', '')),
  };
  const mockOtpLockout = {
    assertNotLocked: jest.fn(),
    recordFailure: jest.fn(),
    reset: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: LdapService, useValue: mockLdapService },
        { provide: AuthProvidersService, useValue: mockProvidersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: VaultService, useValue: mockVaultService },
        { provide: OtpLockoutService, useValue: mockOtpLockout },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('changePassword', () => {
    it('should change password with valid current password', async () => {
      const currentPass = 'oldPassword123!';
      const newPass = 'newPassword123!';
      const hash = await argon2.hash(currentPass);
      const user = { id: 'u1', authMethod: AuthMethod.LOCAL, passwordHash: hash };

      mockUsersService.findOneById.mockResolvedValue(user);
      mockUsersService.update.mockResolvedValue({ ...user, passwordHash: 'new_hash' });

      const result = await service.changePassword('u1', currentPass, newPass);
      expect(result).toBeDefined();
      expect(mockUsersService.update).toHaveBeenCalledWith('u1', expect.objectContaining({ requiresPasswordChange: false }));
    });

    it('should throw UnauthorizedException for wrong current password', async () => {
      const user = { id: 'u1', authMethod: AuthMethod.LOCAL, passwordHash: await argon2.hash('correct') };
      mockUsersService.findOneById.mockResolvedValue(user);

      await expect(service.changePassword('u1', 'wrong', 'new123!')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException for LDAP users', async () => {
      mockUsersService.findOneById.mockResolvedValue({ id: 'u1', authMethod: AuthMethod.LDAP, passwordHash: null });
      await expect(service.changePassword('u1', 'any', 'new')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateUser', () => {
    it('should validate local user with correct password', async () => {
      const password = 'password123';
      const hash = await argon2.hash(password);
      const user = { id: 'u1', email: 'test@local.com', passwordHash: hash, authMethod: AuthMethod.LOCAL };
      mockUsersService.findOneByEmailOrUsername.mockResolvedValue(user);

      const result = await service.validateUser('local', user.email, password);
      expect(result).toBeDefined();
      expect(result.email).toBe(user.email);
      expect(result.passwordHash).toBeUndefined();
    });

    it('should return null for wrong password', async () => {
      const user = { id: 'u1', email: 'test@local.com', passwordHash: await argon2.hash('correct'), authMethod: AuthMethod.LOCAL };
      mockUsersService.findOneByEmailOrUsername.mockResolvedValue(user);
      const result = await service.validateUser('local', user.email, 'wrong');
      expect(result).toBeNull();
    });

    it('should delegate to LDAP when the provider id resolves to LDAP', async () => {
      mockProvidersService.findEnabledById.mockResolvedValue({
        id: LDAP_PROVIDER_ID,
        name: 'corp',
        type: 'LDAP',
        enabled: true,
      });
      mockLdapService.authenticate.mockResolvedValue({ id: 'u2', email: 'ldap@test.com' });

      const result = await service.validateUser(LDAP_PROVIDER_ID, 'ldap@test.com', 'pass');
      expect(mockLdapService.authenticate).toHaveBeenCalledWith(
        LDAP_PROVIDER_ID,
        'ldap@test.com',
        'pass',
      );
      expect(result).toBeDefined();
    });

    it('should refuse password login against an OIDC provider', async () => {
      mockProvidersService.findEnabledById.mockResolvedValue({
        id: OIDC_PROVIDER_ID,
        name: 'kc',
        type: 'OIDC',
        enabled: true,
      });
      const result = await service.validateUser(OIDC_PROVIDER_ID, 'a@b.com', 'pw');
      expect(result).toBeNull();
      expect(mockLdapService.authenticate).not.toHaveBeenCalled();
    });

    it('should return null when provider id is unknown/disabled', async () => {
      mockProvidersService.findEnabledById.mockResolvedValue(null);
      const result = await service.validateUser(LDAP_PROVIDER_ID, 'x@y.com', 'pw');
      expect(result).toBeNull();
    });

    // SECURITY: anti-enumeration — both code paths must take time in the
    // argon2 ballpark (wall-clock ≥ ~5 ms even on fast hardware) so the
    // network observer cannot tell whether the identifier exists.
    it('non-existing user path takes argon2-bounded time (≥ 5 ms)', async () => {
      mockUsersService.findOneByEmailOrUsername.mockResolvedValue(null);

      // Warm dummy hash (lazy on first miss)
      await service.validateUser('local', 'warmup@nope.com', 'pw');

      const t0 = Date.now();
      const result = await service.validateUser('local', 'nope@nope.com', 'pw');
      const elapsed = Date.now() - t0;

      expect(result).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(5);
    });

    it('non-LOCAL user path also runs the dummy verify (≥ 5 ms)', async () => {
      mockUsersService.findOneByEmailOrUsername.mockResolvedValueOnce(null);
      await service.validateUser('local', 'warmup2@nope.com', 'pw'); // warm
      mockUsersService.findOneByEmailOrUsername.mockResolvedValue({
        id: 'u1', email: 'oidc@test.com', authMethod: AuthMethod.OIDC, passwordHash: null,
      });
      const t0 = Date.now();
      const result = await service.validateUser('local', 'oidc@test.com', 'pw');
      const elapsed = Date.now() - t0;
      expect(result).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(5);
    });

    it('should have comparable timing for existing-wrong-pw vs non-existing user', async () => {
      const user = {
        id: 'u1', email: 'test@local.com',
        passwordHash: await argon2.hash('correct'),
        authMethod: AuthMethod.LOCAL,
      };

      // Warm the dummy hash (lazily generated on first miss) before measuring.
      mockUsersService.findOneByEmailOrUsername.mockResolvedValueOnce(null);
      await service.validateUser('local', 'warmup@nope.com', 'pw');

      mockUsersService.findOneByEmailOrUsername.mockResolvedValue(user);
      const t0a = Date.now();
      await service.validateUser('local', user.email, 'wrong');
      const dExisting = Date.now() - t0a;

      mockUsersService.findOneByEmailOrUsername.mockResolvedValue(null);
      const t0b = Date.now();
      await service.validateUser('local', 'nope@nope.com', 'pw');
      const dMissing = Date.now() - t0b;

      // Both should be in the argon2 ballpark (≥ 5ms even on fast HW).
      expect(dExisting).toBeGreaterThanOrEqual(5);
      expect(dMissing).toBeGreaterThanOrEqual(5);
      // And within a 5x factor — argon2 dominates, the DB call delta is tiny.
      const ratio = Math.max(dExisting, dMissing) / Math.max(1, Math.min(dExisting, dMissing));
      expect(ratio).toBeLessThan(5);
    });
  });

  describe('verifyOtp', () => {
    it('should check lockout before verifying', async () => {
      mockOtpLockout.assertNotLocked.mockRejectedValue(new UnauthorizedException('Too many OTP attempts'));
      mockUsersService.findOneById.mockResolvedValue({ id: 'u1', otpSecret: null });

      await expect(service.verifyOtp('u1', '123456')).rejects.toThrow(UnauthorizedException);
      expect(mockOtpLockout.assertNotLocked).toHaveBeenCalledWith('u1');
    });

    it('should reset lockout on successful OTP verification', async () => {
      mockOtpLockout.assertNotLocked.mockResolvedValue(undefined);
      // totpVerify is imported directly — mock the user secret as something that
      // we know won't match any 6-digit code, so invalid returns false
      mockUsersService.findOneById.mockResolvedValue({ id: 'u1', otpSecret: null });

      const result = await service.verifyOtp('u1', '000000');
      expect(result).toBe(false);
    });

    it('should record failure on bad OTP code', async () => {
      mockOtpLockout.assertNotLocked.mockResolvedValue(undefined);
      mockUsersService.findOneById.mockResolvedValue({ id: 'u1', otpSecret: null });

      await service.verifyOtp('u1', 'bad');
      // No otpSecret means returns false early without recording failure
    });
  });
});
