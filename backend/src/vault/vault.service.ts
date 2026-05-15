import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { ConfigService } from '../config/config.service';

@Injectable()
export class VaultService {
  private readonly algorithm = 'aes-256-gcm';
  // SECURITY: enforce the full 128-bit GCM authentication tag.
  //
  // Node's `createCipheriv`/`createDecipheriv` accept truncated tags by
  // default — `setAuthTag(...)` blindly takes whatever Buffer it is given,
  // so a malicious ciphertext can supply a 4-byte tag and the verification
  // succeeds with only 2^-32 odds against the attacker. With short tags an
  // attacker can also recover the GCM hash subkey and forge arbitrary
  // ciphertexts (see Securesystems blog + NIST SP 800-38D §5.2.1).
  //
  // Pinning `authTagLength: 16` makes the cipher object reject any tag
  // whose length differs from 16 bytes, eliminating that attack class.
  private readonly authTagLength = 16;
  private readonly masterKey: Buffer;

  private readonly salt: Buffer;

  constructor(private configService: ConfigService) {
    const keyHex = this.configService.getOrThrow('VAULT_KEY');
    const saltRaw = this.configService.getOrThrow('VAULT_SALT');

    if (saltRaw.length < 16) {
      throw new InternalServerErrorException(
        'VAULT_SALT must be at least 16 characters',
      );
    }

    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
      throw new InternalServerErrorException(
        'VAULT_KEY must be exactly 64 valid hexadecimal characters (32 bytes). ' +
          'Generate with: openssl rand -hex 32',
      );
    }

    // Vérification que la clé n'est pas la valeur d'exemple connue
    const KNOWN_EXAMPLE_KEY =
      'a3f1c2e4b5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
    if (keyHex.toLowerCase() === KNOWN_EXAMPLE_KEY) {
      throw new InternalServerErrorException(
        'VAULT_KEY is set to the example value. Generate a new one with: openssl rand -hex 32',
      );
    }
    this.masterKey = Buffer.from(keyHex, 'hex');

    // Robust salt handling: try hex, fallback to utf8 string
    // This ensures that even if the env var format changes, the buffer remains stable
    this.salt =
      saltRaw.length >= 16 && /^[0-9a-fA-F]+$/.test(saltRaw)
        ? Buffer.from(saltRaw, 'hex')
        : Buffer.from(saltRaw, 'utf8');
  }

  /**
   * Derives a unique key for a specific resource to prevent global decryption if one key leaks.
   */
  private deriveKey(context: string): Buffer {
    // We use HKDF (HMAC-based Key Derivation Function) to derive a sub-key
    const derived = crypto.hkdfSync(
      'sha256',
      this.masterKey,
      Buffer.from(context, 'utf8'),
      this.salt,
      32,
    );
    return Buffer.from(derived);
  }

  encrypt(text: string, context: string): string {
    const key = this.deriveKey(context);
    const iv = crypto.randomBytes(12);
    // SECURITY: pin the 128-bit auth tag length — see class-level note.
    const cipher = crypto.createCipheriv(this.algorithm, key, iv, {
      authTagLength: this.authTagLength,
    });

    // AAD (Additional Authenticated Data) binds the ciphertext to the resource ID
    cipher.setAAD(Buffer.from(context, 'utf8'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();
    if (tag.length !== this.authTagLength) {
      // Defence in depth: should never happen given the createCipheriv
      // option above, but bail out rather than persist a short tag.
      key.fill(0);
      throw new InternalServerErrorException(
        'Vault encrypt produced an unexpected auth tag length',
      );
    }

    // Wipe sensitive key from memory if possible
    key.fill(0);

    return `${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`;
  }

  decrypt(encryptedText: string, context: string): string {
    // Format: "ivHex:encryptedHex:tagHex". `encryptedHex` is legitimately
    // empty when the plaintext was empty, so we check segment presence
    // (split produced 3 parts) rather than non-empty truthiness.
    const parts = encryptedText.split(':');
    if (parts.length !== 3)
      throw new InternalServerErrorException('Invalid format');
    const [ivHex, encrypted, tagHex] = parts as [string, string, string];
    if (ivHex.length === 0 || tagHex.length === 0)
      throw new InternalServerErrorException('Invalid format');

    const key = this.deriveKey(context);
    try {
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');

      // SECURITY: reject tags that are not exactly 16 bytes BEFORE
      // handing them to setAuthTag. Truncated tags weaken GCM
      // authentication and have been used in real forgery attacks.
      if (tag.length !== this.authTagLength) {
        throw new InternalServerErrorException(
          `Vault payload has an invalid auth tag length (${tag.length}B, expected ${this.authTagLength}B)`,
        );
      }
      if (iv.length !== 12) {
        throw new InternalServerErrorException(
          `Vault payload has an invalid IV length (${iv.length}B, expected 12B)`,
        );
      }

      // SECURITY: same authTagLength pin as on the encrypt side. With this
      // option, setAuthTag will throw on a wrong-length tag — the explicit
      // check above is defence in depth for older Node versions and for
      // clearer error messages.
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv, {
        authTagLength: this.authTagLength,
      });

      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      key.fill(0);
      return decrypted;
    } catch (e) {
      key.fill(0);
      throw new InternalServerErrorException(
        'Secret decryption failed (Integrity breach or wrong context)',
      );
    }
  }
}
