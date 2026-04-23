import { Test, TestingModule } from '@nestjs/testing';
import { VaultService } from './vault.service';
import { ConfigService } from '../config/config.service';
import { InternalServerErrorException } from '@nestjs/common';

describe('VaultService', () => {
  let service: VaultService;
  const mockConfig = {
    VAULT_KEY:
      '853fcdb1db9d79ee0daeda426b2d9f1959a3d07b83e0edf9c8087066eca79963',
    VAULT_SALT: 'f1e2d3c4b5a60798',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VaultService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => mockConfig[key]),
          },
        },
      ],
    }).compile();

    service = module.get<VaultService>(VaultService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should encrypt and decrypt correctly', () => {
    const text = 'my-secret-password';
    const context = 'resource-123';
    const encrypted = service.encrypt(text, context);
    expect(encrypted).toContain(':');

    const decrypted = service.decrypt(encrypted, context);
    expect(decrypted).toBe(text);
  });

  it('should throw error on invalid format', () => {
    expect(() => service.decrypt('invalid-format', 'ctx')).toThrow();
  });

  it('should throw error on wrong auth tag', () => {
    const context = 'resource-456';
    const encrypted = service.encrypt('test', context);
    const parts = encrypted.split(':');
    parts[2] = 'a'.repeat(32); // Corrupt auth tag
    const corrupted = parts.join(':');
    expect(() => service.decrypt(corrupted, context)).toThrow();
  });

  it('should throw if VAULT_SALT is too short', async () => {
    const shortConfig = {
      VAULT_KEY:
        '853fcdb1db9d79ee0daeda426b2d9f1959a3d07b83e0edf9c8087066eca79963',
      VAULT_SALT: 'too-short',
    };

    const moduleFixture = Test.createTestingModule({
      providers: [
        VaultService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => shortConfig[key]),
          },
        },
      ],
    });

    await expect(moduleFixture.compile()).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('should throw if VAULT_KEY is not valid hex', async () => {
    const invalidConfig = {
      VAULT_KEY: 'g'.repeat(64), // invalid hex char
      VAULT_SALT: 'f1e2d3c4b5a60798',
    };

    const moduleFixture = Test.createTestingModule({
      providers: [
        VaultService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => invalidConfig[key]),
          },
        },
      ],
    });

    await expect(moduleFixture.compile()).rejects.toThrow(
      'VAULT_KEY must be exactly 64 valid hexadecimal characters',
    );
  });

  it('should throw if VAULT_KEY is set to known example', async () => {
    const exampleConfig = {
      VAULT_KEY:
        'a3f1c2e4b5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      VAULT_SALT: 'f1e2d3c4b5a60798',
    };

    const moduleFixture = Test.createTestingModule({
      providers: [
        VaultService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => exampleConfig[key]),
          },
        },
      ],
    });

    await expect(moduleFixture.compile()).rejects.toThrow(
      'VAULT_KEY is set to the example value',
    );
  });
});
