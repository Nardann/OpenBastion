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

    // MED-01 FIX: Ensure admin password is changed from example and has minimum length
    if (
      !adminPassword ||
      adminPassword.includes('CHANGE_ME') ||
      adminPassword.length < 16
    ) {
      this.logger.error(
        'CRITICAL: ADMIN_PASSWORD must be at least 16 characters and different from example value.',
      );
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'Insecure ADMIN_PASSWORD detected in production. Application shutdown.',
        );
      }
    }

    const existingAdmin = await this.prisma.user.findFirst({
      where: { email: adminEmail },
    });

    if (!existingAdmin) {
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
  }
}
