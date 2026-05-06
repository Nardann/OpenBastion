import { Injectable, Logger } from '@nestjs/common';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';
import { AuthMethod } from '@prisma/client';
import { escapeLdapFilter } from './ldap.utils';
import { LdapProviderConfig } from './types/auth-provider.types';
import * as LdapAuth from 'ldapauth-fork';

interface LdapOptions {
  url: string;
  searchBase: string;
  searchFilter: string;
  bindProperty: string;
  bindDN?: string;
  bindCredentials?: string;
  searchAttributes?: string[];
  tlsOptions?: Record<string, unknown>;
}

interface LdapUser {
  dn?: string;
  mail?: string;
  proxyAddresses?: string | string[];
  [key: string]: unknown;
}

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(
    private authProvidersService: AuthProvidersService,
    private usersService: UsersService,
  ) {}

  async authenticate(username: string, pass: string): Promise<unknown> {
    const provider = await this.authProvidersService.findByType('LDAP');
    if (!provider) return null;

    const config = provider.config as LdapProviderConfig;
    const escapedUsername = escapeLdapFilter(username);

    const defaultFilter = config.isActiveDirectory
      ? '(sAMAccountName={{username}})'
      : '(uid={{username}})';

    const searchFilter = config.searchFilter || defaultFilter;
    let finalFilter = searchFilter.replace(/{{username}}/g, escapedUsername);

    if (config.isActiveDirectory && !finalFilter.includes('userAccountControl')) {
      finalFilter = `(&${finalFilter}(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`;
    }

    const ldapOptions: LdapOptions = {
      url: config.url,
      searchBase: config.searchBase,
      searchFilter: finalFilter,
      bindProperty: 'dn',
    };

    if (config.bindDn && config.bindPassword) {
      ldapOptions.bindDN = config.bindDn;
      ldapOptions.bindCredentials = config.bindPassword;
    }

    if (config.tlsOptions) {
      ldapOptions.tlsOptions = config.tlsOptions as Record<string, unknown>;
    }

    return new Promise((resolve) => {
      const ldap = new (LdapAuth as unknown as { new(opts: LdapOptions): { authenticate: (u: string, p: string, cb: (err: Error | null, user: LdapUser | null) => void) => void; close: (cb: (err?: Error) => void) => void } })(ldapOptions);

      ldap.authenticate(username, pass, async (err, ldapUser) => {
        ldap.close((closeErr) => {
          if (closeErr) {
            this.logger.warn(`LDAP connection close error: ${closeErr.message}`);
          }
        });

        if (err) {
          this.logger.error(`LDAP Auth failed for user (redacted): ${err.message}`);
          return resolve(null);
        }

        if (ldapUser) {
          this.logger.log('LDAP Auth successful');

          let email = ldapUser.mail as string | undefined;
          if (!email && ldapUser.proxyAddresses) {
            const addrs = Array.isArray(ldapUser.proxyAddresses)
              ? ldapUser.proxyAddresses
              : [ldapUser.proxyAddresses];
            const smtpAddr = addrs.find((addr) => addr.toLowerCase().startsWith('smtp:'));
            if (smtpAddr) email = smtpAddr.substring(5);
          }

          if (!email) {
            this.logger.error('LDAP User has no email attribute. Access denied.');
            return resolve(null);
          }

          const externalId = ldapUser.dn ?? username;
          const user = await this.usersService.findOrCreateExternalUser(
            email,
            externalId,
            AuthMethod.LDAP,
          );
          return resolve(user);
        }

        resolve(null);
      });
    });
  }
}
