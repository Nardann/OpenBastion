import { Test, TestingModule } from '@nestjs/testing';
import { VaultService } from './vault.service';
import { ConfigService } from '../config/config.service';
import { InternalServerErrorException } from '@nestjs/common';

const VALID_KEY = '853fcdb1db9d79ee0daeda426b2d9f1959a3d07b83e0edf9c8087066eca79963';
const VALID_SALT = 'f1e2d3c4b5a60798';

describe('VaultService', () => {
  let service: VaultService;

  const makeModule = (key: string, salt: string) =>
    Test.createTestingModule({
      providers: [
        VaultService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn((k: string) => (k === 'VAULT_KEY' ? key : salt)) },
        },
      ],
    });

  beforeEach(async () => {
    const module: TestingModule = await makeModule(VALID_KEY, VALID_SALT).compile();
    service = module.get<VaultService>(VaultService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  it('should encrypt and decrypt correctly', () => {
    const text = 'my-secret-password';
    const context = 'resource-123';
    const encrypted = service.encrypt(text, context);
    expect(encrypted).toContain(':');
    expect(service.decrypt(encrypted, context)).toBe(text);
  });

  it('should produce different ciphertexts for same plaintext (random IV)', () => {
    const enc1 = service.encrypt('same', 'ctx');
    const enc2 = service.encrypt('same', 'ctx');
    expect(enc1).not.toBe(enc2);
  });

  it('should throw on invalid ciphertext format', () => {
    expect(() => service.decrypt('invalid-format', 'ctx')).toThrow();
  });

  it('should throw on corrupted auth tag', () => {
    const context = 'resource-456';
    const encrypted = service.encrypt('test', context);
    const parts = encrypted.split(':');
    parts[2] = 'a'.repeat(32);
    expect(() => service.decrypt(parts.join(':'), context)).toThrow();
  });

  it('should throw when context changes (AEAD)', () => {
    const encrypted = service.encrypt('secret', 'context-A');
    expect(() => service.decrypt(encrypted, 'context-B')).toThrow();
  });

  it('should handle long payloads', () => {
    const long = 'x'.repeat(10_000);
    expect(service.decrypt(service.encrypt(long, 'big'), 'big')).toBe(long);
  });

  it('should handle empty string', () => {
    const enc = service.encrypt('', 'ctx');
    expect(service.decrypt(enc, 'ctx')).toBe('');
  });

  it('should throw if VAULT_SALT is too short', async () => {
    await expect(makeModule(VALID_KEY, 'short').compile()).rejects.toThrow(InternalServerErrorException);
  });

  it('should throw if VAULT_KEY is not valid hex', async () => {
    await expect(makeModule('g'.repeat(64), VALID_SALT).compile()).rejects.toThrow('VAULT_KEY must be exactly 64 valid hexadecimal characters');
  });

  it('should throw if VAULT_KEY is the example placeholder', async () => {
    const exampleKey = 'a3f1c2e4b5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
    await expect(makeModule(exampleKey, VALID_SALT).compile()).rejects.toThrow('VAULT_KEY is set to the example value');
  });
});
