import { Injectable, Logger } from '@nestjs/common';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';
import { AuthMethod } from '@prisma/client';
import { escapeLdapFilter } from './ldap.utils';
import * as LdapAuth from 'ldapauth-fork';

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(
    private authProvidersService: AuthProvidersService,
    private usersService: UsersService,
  ) {}

  async authenticate(username: string, pass: string): Promise<any> {
    const provider = await this.authProvidersService.findByType('LDAP');
    if (!provider) return null;

    const config = provider.config as any;
    const escapedUsername = escapeLdapFilter(username);

    // Windows AD default: sAMAccountName, Generic LDAP: uid
    const defaultFilter = config.isActiveDirectory
      ? '(sAMAccountName={{username}})'
      : '(uid={{username}})';

    const searchFilter = config.searchFilter || defaultFilter;

    // Replace {{username}} with escaped username to prevent LDAP injection
    let finalFilter = searchFilter.replace(/{{username}}/g, escapedUsername);

    // Exclude disabled AD accounts: userAccountControl:1.2.840.113556.1.4.803:=2
    // Bit 2 = ACCOUNT_DISABLED
    if (config.isActiveDirectory && !finalFilter.includes('userAccountControl')) {
      finalFilter = `(&${finalFilter}(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`;
    }

    const ldapOptions: any = {
      url: config.url,
      searchBase: config.searchBase,
      searchFilter: finalFilter,
      // ldapauth-fork does not substitute {{username}} in our pre-built filter;
      // passing username is still needed for the second bind (user credential check).
      bindProperty: 'dn',
    };

    if (config.bindDn && config.bindPassword) {
      ldapOptions.bindDN = config.bindDn;
      ldapOptions.bindCredentials = config.bindPassword;
    }

    if (config.isActiveDirectory) {
      ldapOptions.searchAttributes = undefined; // all attributes
    }

    return new Promise((resolve) => {
      const ldap = new (LdapAuth as any)(ldapOptions);

      ldap.authenticate(username, pass, async (err: any, ldapUser: any) => {
        // Always close the connection to avoid leaking LDAP sockets
        ldap.close((closeErr: any) => {
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

          // Extract email: try 'mail' first, then 'proxyAddresses' (AD)
          let email = ldapUser.mail;
          if (!email && ldapUser.proxyAddresses) {
            const smtpAddr = (Array.isArray(ldapUser.proxyAddresses)
              ? ldapUser.proxyAddresses
              : [ldapUser.proxyAddresses]
            ).find((addr: string) => addr.toLowerCase().startsWith('smtp:'));
            if (smtpAddr) {
              email = smtpAddr.substring(5); // Remove 'smtp:' prefix
            }
          }

          // Reject users without email to prevent account confusion
          if (!email) {
            this.logger.error(
              'LDAP User has no email attribute. Access denied.',
            );
            return resolve(null);
          }

          // JIT Provisioning
          const externalId = ldapUser.dn || username;
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
