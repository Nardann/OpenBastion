import { Injectable, Logger } from '@nestjs/common';
import { AuthProvidersService } from './auth-providers.service';
import { UsersService } from '../users/users.service';
import LdapStrategy = require('passport-ldapauth');
import { AuthMethod } from '@prisma/client';
import { escapeLdapFilter } from './ldap.utils';

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

    const config = provider.config;
    const escapedUsername = escapeLdapFilter(username);

    return new Promise((resolve) => {
      // Windows AD default: sAMAccountName, Generic LDAP: uid
      const defaultFilter = config.isActiveDirectory
        ? '(sAMAccountName={{username}})'
        : '(uid={{username}})';
      
      const searchFilter = config.searchFilter || defaultFilter;
      
      // Replace {{username}} with escaped username to prevent LDAP injection
      let finalFilter = searchFilter.replace(
        /{{username}}/g,
        escapedUsername,
      );

      // Exclude disabled AD accounts: userAccountControl:1.2.840.113556.1.4.803:=2
      // Bit 2 = ACCOUNT_DISABLED
      if (config.isActiveDirectory && !finalFilter.includes('userAccountControl')) {
        finalFilter = `(&${finalFilter}(!(userAccountControl:1.2.840.113556.1.4.803:=2))))`;
      }

      const ldapConfig = {
        server: {
          url: config.url,
          // Support both bindDn/bindPassword and anonymous bind
          ...(config.bindDn && config.bindPassword && {
            bindDn: config.bindDn,
            bindCredentials: config.bindPassword,
          }),
          searchBase: config.searchBase,
          searchFilter: finalFilter,
          // Additional AD-specific options
          ...(config.isActiveDirectory && {
            referrals: false,
            sizeLimit: 1000,
          }),
        },
        credentials: {
          username,
          password: pass,
        },
      };

      const strategy = new LdapStrategy(ldapConfig, (user: any, done: any) => {
        done(null, user);
      });

      // Manual authentication attempt using the strategy's logic
      (strategy as any)._ldapauth.authenticate(
        username,
        pass,
        async (err: any, ldapUser: any) => {
          if (err) {
            this.logger.error(
              `LDAP Auth failed for ${username}: ${err.message}`,
            );
            return resolve(null);
          }

          if (ldapUser) {
            this.logger.log(`LDAP Auth successful for ${username}`);

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

            // HIGH-06 FIX: Reject users without email to prevent account confusion
            if (!email) {
              this.logger.error(
                `LDAP User ${username} has no email attribute. Access denied.`,
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
        },
      );
    });
  }
}
