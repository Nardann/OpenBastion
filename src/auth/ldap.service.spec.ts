import { Test, TestingModule } from '@nestjs/testing';
import { LdapService } from './ldap.service';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';

// Mock the ldapauth-fork module
jest.mock('ldapauth-fork', () => {
  return jest.fn().mockImplementation(() => ({
    authenticate: jest.fn(),
    close: jest.fn((cb: () => void) => cb()),
  }));
});

import * as LdapAuth from 'ldapauth-fork';

describe('LdapService', () => {
  let service: LdapService;

  const mockProvidersService = { findByType: jest.fn() };
  const mockUsersService = { findOrCreateExternalUser: jest.fn() };

  const ldapConfig = {
    url: 'ldap://ldap.test:389',
    searchBase: 'dc=test,dc=com',
    bindDn: 'cn=admin,dc=test,dc=com',
    bindPassword: 'secret',
    isActiveDirectory: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LdapService,
        { provide: AuthProvidersService, useValue: mockProvidersService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<LdapService>(LdapService);
  });

  it('should return null when LDAP provider is not configured', async () => {
    mockProvidersService.findByType.mockResolvedValue(null);
    const result = await service.authenticate('user', 'pass');
    expect(result).toBeNull();
  });

  it('should return null on LDAP auth error', async () => {
    mockProvidersService.findByType.mockResolvedValue({ config: ldapConfig });
    const mockInstance = { authenticate: jest.fn(), close: jest.fn((cb: () => void) => cb()) };
    (LdapAuth as jest.Mock).mockImplementationOnce(() => mockInstance);
    mockInstance.authenticate.mockImplementation((_u: string, _p: string, cb: (err: Error | null, user: unknown) => void) => {
      cb(new Error('Invalid credentials'), null);
    });

    const result = await service.authenticate('user', 'wrongpass');
    expect(result).toBeNull();
  });

  it('should return null when LDAP user has no email', async () => {
    mockProvidersService.findByType.mockResolvedValue({ config: ldapConfig });
    const mockInstance = { authenticate: jest.fn(), close: jest.fn((cb: () => void) => cb()) };
    (LdapAuth as jest.Mock).mockImplementationOnce(() => mockInstance);
    mockInstance.authenticate.mockImplementation((_u: string, _p: string, cb: (err: null, user: unknown) => void) => {
      cb(null, { dn: 'cn=user,dc=test,dc=com' }); // no email
    });

    const result = await service.authenticate('user', 'pass');
    expect(result).toBeNull();
  });

  it('should provision user on successful LDAP auth', async () => {
    mockProvidersService.findByType.mockResolvedValue({ config: ldapConfig });
    const ldapUser = { dn: 'cn=user,dc=test,dc=com', mail: 'user@test.com' };
    const provisionedUser = { id: 'u1', email: 'user@test.com' };

    const mockInstance = { authenticate: jest.fn(), close: jest.fn((cb: () => void) => cb()) };
    (LdapAuth as jest.Mock).mockImplementationOnce(() => mockInstance);
    mockInstance.authenticate.mockImplementation((_u: string, _p: string, cb: (err: null, user: typeof ldapUser) => void) => {
      cb(null, ldapUser);
    });
    mockUsersService.findOrCreateExternalUser.mockResolvedValue(provisionedUser);

    const result = await service.authenticate('user', 'pass');
    expect(result).toEqual(provisionedUser);
    expect(mockUsersService.findOrCreateExternalUser).toHaveBeenCalledWith('user@test.com', ldapUser.dn, 'LDAP');
  });

  it('should exclude disabled AD accounts in filter', async () => {
    const adConfig = { ...ldapConfig, isActiveDirectory: true };
    mockProvidersService.findByType.mockResolvedValue({ config: adConfig });

    const mockInstance = { authenticate: jest.fn(), close: jest.fn((cb: () => void) => cb()) };
    (LdapAuth as jest.Mock).mockImplementationOnce((_opts: Record<string, unknown>) => {
      expect(_opts.searchFilter).toContain('userAccountControl');
      return mockInstance;
    });
    mockInstance.authenticate.mockImplementation((_u: string, _p: string, cb: (err: Error) => void) => {
      cb(new Error('fail'));
    });

    await service.authenticate('user', 'pass');
  });
});
