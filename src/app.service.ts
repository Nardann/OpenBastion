import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { UsersService } from './users/users.service';
import { Role, AuthMethod } from '@prisma/client';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultAdmin();
  }

  private async ensureDefaultAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail) {
      this.logger.warn(
        'ADMIN_EMAIL is not set. Skipping default admin creation.',
      );
      return;
    }

    const existingAdmin = await this.prisma.user.findFirst({
      where: { email: adminEmail },
    });

    if (existingAdmin) {
      // Existing install: ADMIN_PASSWORD is unused (user has rotated). We
      // still warn if it remains a known-weak bootstrap value, but boot.
      if (this.isWeakBootstrapPassword(adminPassword)) {
        this.logger.warn(
          'ADMIN_PASSWORD env still matches a weak bootstrap pattern. The ' +
            'value is unused (admin exists), but rotate it to avoid leaking ' +
            'a hint about future fresh installs.',
        );
      }
      return;
    }

    // SECURITY: enforce strong default admin password BEFORE creating the
    // admin user. >= 16 chars, upper/lower/digit/special, not on denylist.
    if (this.isWeakBootstrapPassword(adminPassword)) {
      this.logger.error(
        'CRITICAL: ADMIN_PASSWORD must be >= 16 chars, contain upper/lower/digit/special, ' +
          'and not match a known weak pattern. Refusing to create default admin.',
      );
      throw new Error(
        'Insecure ADMIN_PASSWORD. Generate one with: openssl rand -base64 24',
      );
    }

    this.logger.log('No admin found. Creating default administrator...');
    await this.usersService.create({
      email: adminEmail,
      password: adminPassword!,
      role: Role.ADMIN,
      authMethod: AuthMethod.LOCAL,
      requiresPasswordChange: true, // SECURITY: Force password change on first login
    });
    this.logger.log(
      `Default admin created: ${adminEmail}. Password change required on first login.`,
    );
  }

  private isWeakBootstrapPassword(pw: string | undefined): boolean {
    const PASSWORD_REGEX =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_\-=[\]{};':",.<>/?\\|`~]).+$/;
    const PASSWORD_DENYLIST = [
      /change[_\- ]?me/i,
      /^admin(password)?\d*!?$/i,
      /^password\d*!?$/i,
      /^p@ssw0rd/i,
      /^bastion/i,
      /^letmein/i,
    ];
    if (!pw) return true;
    if (pw.length < 16) return true;
    if (!PASSWORD_REGEX.test(pw)) return true;
    if (PASSWORD_DENYLIST.some((re) => re.test(pw))) return true;
    return false;
  }
}
