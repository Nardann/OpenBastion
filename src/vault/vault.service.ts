import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { ConfigService } from '../config/config.service';

@Injectable()
export class VaultService {
  private readonly algorithm = 'aes-256-gcm';
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
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    // AAD (Additional Authenticated Data) binds the ciphertext to the resource ID
    cipher.setAAD(Buffer.from(context, 'utf8'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag().toString('hex');

    // Wipe sensitive key from memory if possible
    key.fill(0);

    return `${iv.toString('hex')}:${encrypted}:${tag}`;
  }

  decrypt(encryptedText: string, context: string): string {
    const [ivHex, encrypted, tagHex] = encryptedText.split(':');
    if (!ivHex || !encrypted || !tagHex)
      throw new InternalServerErrorException('Invalid format');

    const key = this.deriveKey(context);
    try {
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);

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
