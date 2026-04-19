import { getCorsConfig } from './cors.config';

describe('CorsConfig', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should allow no origin in development', (done) => {
    process.env.NODE_ENV = 'development';
    const config = getCorsConfig();
    const originCallback = config.origin as (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void;

    originCallback(undefined, (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });

  it('should allow no origin in production (same-origin support)', (done) => {
    process.env.NODE_ENV = 'production';
    const config = getCorsConfig();
    const originCallback = config.origin as (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void;

    originCallback(undefined, (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });

  it('should allow whitelisted origin in production', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'http://example.com';
    const config = getCorsConfig();
    const originCallback = config.origin as (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void;

    originCallback('http://example.com', (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
      done();
    });
  });

  it('should reject non-whitelisted origin in production', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'http://example.com';
    const config = getCorsConfig();
    const originCallback = config.origin as (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void;

    originCallback('http://malicious.com', (err, allow) => {
      expect(err).toBeInstanceOf(Error);
      if (err instanceof Error) {
        expect(err.message).toContain('Not allowed by CORS');
      }
      expect(allow).toBeUndefined();
      done();
    });
  });
});
