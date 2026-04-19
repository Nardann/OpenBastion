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
      const searchFilter = config.searchFilter || '(uid={{username}})';
      // Replace {{username}} with escaped username to prevent LDAP injection
      const finalFilter = searchFilter.replace(
        /{{username}}/g,
        escapedUsername,
      );

      const ldapConfig = {
        server: {
          url: config.url,
          bindDn: config.bindDn,
          bindCredentials: config.bindPassword,
          searchBase: config.searchBase,
          searchFilter: finalFilter,
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

            // HIGH-06 FIX: Reject users without email to prevent account confusion
            if (!ldapUser.mail) {
              this.logger.error(
                `LDAP User ${username} has no email attribute. Access denied.`,
              );
              return resolve(null);
            }

            // JIT Provisioning
            const email = ldapUser.mail;
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
