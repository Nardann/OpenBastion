import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { LdapService } from './ldap.service';
import { AuthProvidersService } from './auth-providers.service';
import { VaultService } from '../vault/vault.service';
import { OtpLockoutService } from './otp-lockout.service';
import * as argon2 from 'argon2';
import { AuthMethod } from '@prisma/client';
import { generateSecret, keyuri, verifyWithCounter } from './totp';
import * as qrcode from 'qrcode';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // SECURITY: in-memory replay cache for OTP. The accepted counter for each
  // user is stored for ~5 min so that a captured 6-digit code cannot be
  // re-used inside its own validity window. We don't persist this in DB to
  // avoid a schema migration; the worst case (process restart) just allows
  // one extra reuse window per user, which is negligible vs lockout.
  private readonly otpLastCounter = new Map<string, { counter: number; ts: number }>();
  private readonly OTP_REPLAY_TTL_MS = 5 * 60_000;

  // SECURITY: anti-enumeration. We always run argon2.verify, even when the
  // identifier doesn't match any user, so the response time is constant
  // regardless of account existence. The dummy hash is generated lazily on
  // first miss and reused (process-lifetime).
  private dummyHashPromise: Promise<string> | null = null;
  private getDummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = argon2.hash('anti-enum-dummy-input');
    }
    return this.dummyHashPromise;
  }

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private ldapService: LdapService,
    private providersService: AuthProvidersService,
    private vault: VaultService,
    private otpLockout: OtpLockoutService,
  ) {}

  private gcOtpReplayCache() {
    const now = Date.now();
    for (const [k, v] of this.otpLastCounter) {
      if (now - v.ts > this.OTP_REPLAY_TTL_MS) this.otpLastCounter.delete(k);
    }
  }

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

  /**
   * Multi-provider validation.
   *
   * - `providerId === 'local'` → built-in local auth (Argon2id against
   *   `User.passwordHash`).
   * - `providerId === <uuid>`  → resolved against `AuthProvider`; an LDAP
   *   row delegates to `LdapService.authenticate(id, …)`. OIDC providers
   *   are not handled here (their flow lives in the controller — browser
   *   redirect through `getAuthorizationUrl`).
   *
   * Anti-enumeration: when `local` is selected we always run
   * `argon2.verify` (against a dummy hash on miss) so the response time
   * doesn't reveal whether the identifier exists.
   */
  async validateUser(
    providerId: string,
    identifier: string,
    pass: string,
  ): Promise<any> {
    if (providerId === 'local') {
      this.logger.debug('Validating user via LOCAL');
      const user = await this.usersService.findOneByEmailOrUsername(identifier);
      const isLocalCandidate =
        !!user && user.authMethod === AuthMethod.LOCAL && !!user.passwordHash;
      const hashToCheck = isLocalCandidate
        ? user!.passwordHash!
        : await this.getDummyHash();
      const argonOk = await argon2.verify(hashToCheck, pass);
      if (isLocalCandidate && argonOk) {
        const { passwordHash, ...result } = user!;
        return result;
      }
      return null;
    }

    if (!identifier) return null;

    const provider = await this.providersService.findEnabledById(providerId);
    if (!provider) {
      this.logger.warn(`Login attempt against unknown/disabled provider ${providerId}`);
      return null;
    }

    if (provider.type === 'LDAP') {
      this.logger.debug(`Validating user via LDAP provider ${provider.name}`);
      const ldapUser = await this.ldapService.authenticate(
        provider.id,
        identifier,
        pass,
      );
      return ldapUser ?? null;
    }

    // OIDC must never reach this code path — its flow is browser-driven.
    this.logger.warn(
      `Password login attempted against OIDC provider ${provider.name} — refused`,
    );
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
    await this.otpLockout.assertNotLocked(userId);

    const user = await this.usersService.findOneById(userId);
    if (!user || !user.otpSecret) return false;

    let rawSecret: string;
    let lazyReencrypt = false;
    try {
      rawSecret = this.vault.decrypt(user.otpSecret, `otp:${userId}`);
    } catch {
      // Legacy plaintext secret — lazily re-encrypt on first successful use.
      rawSecret = user.otpSecret;
      lazyReencrypt = true;
    }

    this.gcOtpReplayCache();
    const last = this.otpLastCounter.get(userId)?.counter;
    const verifyArgs: {
      token: string;
      secret: string;
      lastUsedCounter?: number;
    } = { token: code, secret: rawSecret };
    if (typeof last === 'number') verifyArgs.lastUsedCounter = last;
    const matched = verifyWithCounter(verifyArgs);

    if (matched !== null) {
      this.otpLastCounter.set(userId, { counter: matched, ts: Date.now() });
      await this.otpLockout.reset(userId);
      if (lazyReencrypt) {
        await this.usersService.update(userId, {
          otpSecret: this.vault.encrypt(rawSecret, `otp:${userId}`),
        });
      }
      return true;
    }

    await this.otpLockout.recordFailure(userId);
    return false;
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

    const matched = verifyWithCounter({ token: code, secret: rawPending });
    if (matched === null) throw new BadRequestException('Code OTP invalide');

    // Mark this counter as consumed so the same code can't be reused right
    // after enabling.
    this.otpLastCounter.set(userId, { counter: matched, ts: Date.now() });

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

    return await this.usersService.update(userId, {
      passwordHash,
      requiresPasswordChange: false,
    });
  }
}
