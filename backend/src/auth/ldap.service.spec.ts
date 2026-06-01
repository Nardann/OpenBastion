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

// Default import to match the production module (the `import * as` form
// returns a namespace object whose `new` invocation throws at runtime).
import LdapAuth from 'ldapauth-fork';

describe('LdapService', () => {
  let service: LdapService;

  const mockProvidersService = { findEnabledById: jest.fn() };
  const mockUsersService = { findOrCreateExternalUser: jest.fn() };

  const PROVIDER_ID = '11111111-1111-1111-1111-111111111111';

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
    mockProvidersService.findEnabledById.mockResolvedValue(null);
    const result = await service.authenticate(PROVIDER_ID, 'user', 'pass');
    expect(result).toBeNull();
  });

  it('should return null when provider type is not LDAP', async () => {
    mockProvidersService.findEnabledById.mockResolvedValue({
      id: PROVIDER_ID,
      type: 'OIDC',
      config: {},
    });
    const result = await service.authenticate(PROVIDER_ID, 'user', 'pass');
    expect(result).toBeNull();
  });

  it('should return null on LDAP auth error', async () => {
    mockProvidersService.findEnabledById.mockResolvedValue({
      id: PROVIDER_ID,
      name: 'corp',
      type: 'LDAP',
      config: ldapConfig,
    });
    const mockInstance = { authenticate: jest.fn(), close: jest.fn((cb: () => void) => cb()) };
    (LdapAuth as unknown as jest.Mock).mockImplementationOnce(() => mockInstance);
    mockInstance.authenticate.mockImplementation((_u: string, _p: string, cb: (err: Error | null, user: unknown) => void) => {
      cb(new Error('Invalid credentials'), null);
    });

    const result = await service.authenticate(PROVIDER_ID, 'user', 'wrongpass');
    expect(result).toBeNull();
  });

  it('should return null when LDAP user has no email', async () => {
    mockProvidersService.findEnabledById.mockResolvedValue({
      id: PROVIDER_ID,
      name: 'corp',
      type: 'LDAP',
      config: ldapConfig,
    });
    const mockInstance = { authenticate: jest.fn(), close: jest.fn((cb: () => void) => cb()) };
    (LdapAuth as unknown as jest.Mock).mockImplementationOnce(() => mockInstance);
    mockInstance.authenticate.mockImplementation((_u: string, _p: string, cb: (err: null, user: unknown) => void) => {
      cb(null, { dn: 'cn=user,dc=test,dc=com' }); // no email
    });

    const result = await service.authenticate(PROVIDER_ID, 'user', 'pass');
    expect(result).toBeNull();
  });

  it('should provision user on successful LDAP auth (with providerId)', async () => {
    mockProvidersService.findEnabledById.mockResolvedValue({
      id: PROVIDER_ID,
      name: 'corp',
      type: 'LDAP',
      config: ldapConfig,
    });
    const ldapUser = { dn: 'cn=user,dc=test,dc=com', mail: 'user@test.com' };
    const provisionedUser = { id: 'u1', email: 'user@test.com' };

    const mockInstance = { authenticate: jest.fn(), close: jest.fn((cb: () => void) => cb()) };
    (LdapAuth as unknown as jest.Mock).mockImplementationOnce(() => mockInstance);
    mockInstance.authenticate.mockImplementation((_u: string, _p: string, cb: (err: null, user: typeof ldapUser) => void) => {
      cb(null, ldapUser);
    });
    mockUsersService.findOrCreateExternalUser.mockResolvedValue(provisionedUser);

    const result = await service.authenticate(PROVIDER_ID, 'user', 'pass');
    expect(result).toEqual(provisionedUser);
    // Provider id is now forwarded to JIT provisioning so the user gets
    // anchored to the directory it came from. The 5th argument is the
    // display handle the service extracted (sAMAccountName / uid /
    // cn / displayName) — here the LDAP user has no handle attribute,
    // so we fall back to the identifier they typed at login.
    expect(mockUsersService.findOrCreateExternalUser).toHaveBeenCalledWith(
      'user@test.com',
      ldapUser.dn,
      'LDAP',
      PROVIDER_ID,
      'user',
    );
  });

  it('should exclude disabled AD accounts in filter', async () => {
    const adConfig = { ...ldapConfig, isActiveDirectory: true };
    mockProvidersService.findEnabledById.mockResolvedValue({
      id: PROVIDER_ID,
      name: 'corp-ad',
      type: 'LDAP',
      config: adConfig,
    });

    const mockInstance = { authenticate: jest.fn(), close: jest.fn((cb: () => void) => cb()) };
    (LdapAuth as unknown as jest.Mock).mockImplementationOnce((_opts: Record<string, unknown>) => {
      expect(_opts.searchFilter).toContain('userAccountControl');
      return mockInstance;
    });
    mockInstance.authenticate.mockImplementation((_u: string, _p: string, cb: (err: Error) => void) => {
      cb(new Error('fail'));
    });

    await service.authenticate(PROVIDER_ID, 'user', 'pass');
  });
});
