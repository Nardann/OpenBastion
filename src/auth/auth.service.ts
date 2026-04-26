import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { LdapService } from './ldap.service';
import { VaultService } from '../vault/vault.service';
import * as argon2 from 'argon2';
import { AuthMethod } from '@prisma/client';
import { generateSecret, keyuri, verify as totpVerify } from './totp';
import * as qrcode from 'qrcode';

const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly otpFailures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private ldapService: LdapService,
    private vault: VaultService,
  ) {}

  async changePassword(
    userId: string,
    currentPass: string,
    newPass: string,
  ): Promise<any> {
    const user = await this.usersService.findOneById(userId);
    if (!user || user.authMethod !== AuthMethod.LOCAL || !user.passwordHash) {
      throw new BadRequestException(
        'Impossible de changer le mot de passe pour cet utilisateur',
      );
    }
    const isValid = await argon2.verify(user.passwordHash, currentPass);
    if (!isValid)
      throw new UnauthorizedException('Mot de passe actuel incorrect');

    return this.updateUserPassword(userId, newPass);
  }

  async validateUser(
    identifier: string,
    pass: string,
    method: AuthMethod,
  ): Promise<any> {
    // SECURITY FIX: Don't log the actual identifier/password
    this.logger.debug(`Validating user via ${method}`);

    // VULNERABILITY 2 FIX: Remove blind fallback, enforce method
    if (method === AuthMethod.LOCAL) {
      let user = await this.usersService.findOneByEmail(identifier);
      if (!user) user = await this.usersService.findOneByUsername(identifier);

      if (user && user.authMethod === AuthMethod.LOCAL) {
        if (
          user.passwordHash &&
          (await argon2.verify(user.passwordHash, pass))
        ) {
          const { passwordHash, ...result } = user;
          return result;
        }
      }
    }

    if (method === AuthMethod.LDAP) {
      if (!identifier) return null;

      const ldapUser = await this.ldapService.authenticate(identifier, pass);
      if (ldapUser) {
        return ldapUser;
      }
    }

    // OIDC is handled via a different flow (callback)

    return null;
  }

  async login(user: any, isAdminMode: boolean = false) {
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      authMethod: user.authMethod,
      version: user.tokenVersion,
      isAdminMode: user.role === 'ADMIN' ? isAdminMode : false,
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async generateOtp(userId: string) {
    const user = await this.usersService.findOneById(userId);
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const secret = generateSecret();
    const otpauth = keyuri(user.email, 'OpenBastion', secret);
    const qrCode = await qrcode.toDataURL(otpauth);

    await this.usersService.update(userId, {
      pendingOtpSecret: this.vault.encrypt(secret, `otp-pending:${userId}`),
    });

    return { secret, qrCode };
  }

  async verifyOtp(userId: string, code: string): Promise<boolean> {
    const now = Date.now();
    const entry = this.otpFailures.get(userId);
    if (entry && now < entry.resetAt && entry.count >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many OTP attempts. Please wait before retrying.');
    }

    const user = await this.usersService.findOneById(userId);
    if (!user || !user.otpSecret) return false;

    let rawSecret: string;
    try {
      rawSecret = this.vault.decrypt(user.otpSecret, `otp:${userId}`);
    } catch {
      rawSecret = user.otpSecret;
      const valid = totpVerify({ token: code, secret: rawSecret });
      if (valid) {
        this.otpFailures.delete(userId);
        await this.usersService.update(userId, {
          otpSecret: this.vault.encrypt(rawSecret, `otp:${userId}`),
        });
      } else {
        this.recordOtpFailure(userId, now);
      }
      return valid;
    }

    const valid = totpVerify({ token: code, secret: rawSecret });
    if (valid) {
      this.otpFailures.delete(userId);
    } else {
      this.recordOtpFailure(userId, now);
    }
    return valid;
  }

  private recordOtpFailure(userId: string, now: number): void {
    const entry = this.otpFailures.get(userId);
    if (entry && now < entry.resetAt) {
      entry.count++;
    } else {
      this.otpFailures.set(userId, { count: 1, resetAt: now + OTP_LOCKOUT_WINDOW_MS });
    }
  }

  async enableOtp(userId: string, code: string) {
    const user = await this.usersService.findOneById(userId);
    if (!user || !user.pendingOtpSecret) {
      throw new BadRequestException(
        "Veuillez d'abord générer un code QR avant d'activer l'OTP",
      );
    }

    let rawPending: string;
    try {
      rawPending = this.vault.decrypt(user.pendingOtpSecret, `otp-pending:${userId}`);
    } catch {
      throw new BadRequestException('Secret OTP en attente invalide ou corrompu');
    }

    const isValid = totpVerify({ token: code, secret: rawPending });
    if (!isValid) throw new BadRequestException('Code OTP invalide');

    return this.usersService.update(userId, {
      isOtpEnabled: true,
      otpSecret: this.vault.encrypt(rawPending, `otp:${userId}`),
      pendingOtpSecret: null,
    });
  }

  async disableOtp(userId: string, code: string) {
    const isValid = await this.verifyOtp(userId, code);
    if (!isValid) throw new BadRequestException('Code OTP invalide');

    return this.usersService.update(userId, {
      isOtpEnabled: false,
      otpSecret: null,
    });
  }

  async updateUserPassword(userId: string, newPassword: string): Promise<any> {
    const passwordHash = await argon2.hash(newPassword);

    // Update password and clear the requiresPasswordChange flag
    return await this.usersService.update(userId, {
      passwordHash,
      requiresPasswordChange: false,
    });
  }
}
