import type { Request } from 'express';
import { getCorsConfig } from './cors.config';

describe('CorsConfig', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAllowed = process.env.CORS_ALLOWED_ORIGINS;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalAllowed === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = originalAllowed;
  });

  function callDelegate(
    req: Partial<Request>,
  ): Promise<{ err: Error | null; opts: Record<string, unknown> | undefined }> {
    const delegate = getCorsConfig();
    return new Promise((resolve) => {
      delegate(req as Request, (err: Error | null, opts: any) =>
        resolve({ err, opts }),
      );
    });
  }

  it('allows no-origin requests (same-origin browser GETs, curl)', async () => {
    process.env.NODE_ENV = 'development';
    const { err, opts } = await callDelegate({ headers: {} });
    expect(err).toBeNull();
    expect((opts as any)?.origin).toBe(true);
  });

  it('allows whitelisted origin in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'https://bastion.example.com';
    const { err, opts } = await callDelegate({
      headers: {
        origin: 'https://bastion.example.com',
        host: 'someother.example.com',
      },
    });
    expect(err).toBeNull();
    expect((opts as any)?.origin).toBe(true);
  });

  it('rejects non-whitelisted cross-origin in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'https://bastion.example.com';
    const { err } = await callDelegate({
      headers: { origin: 'https://evil.com', host: 'bastion.example.com' },
    });
    expect(err).toBeInstanceOf(Error);
  });

  it('SECURITY: same-origin (Origin host == Host header) is auto-allowed', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'https://bastion.example.com';
    // Operator reaches the bastion at https://10.0.0.5 (not in whitelist)
    const { err, opts } = await callDelegate({
      headers: { origin: 'https://10.0.0.5', host: '10.0.0.5' },
    });
    expect(err).toBeNull();
    expect((opts as any)?.origin).toBe(true);
  });

  it('SECURITY: Origin claiming a different host than the request is REJECTED', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = '';
    const { err } = await callDelegate({
      headers: { origin: 'https://evil.com', host: 'bastion.example.com' },
    });
    expect(err).toBeInstanceOf(Error);
  });

  it('SECURITY: port mismatch on same host is rejected', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = '';
    const { err } = await callDelegate({
      headers: { origin: 'https://10.0.0.5:8443', host: '10.0.0.5' },
    });
    expect(err).toBeInstanceOf(Error);
  });

  it('SECURITY: plaintext-HTTP Origin is REJECTED even when same-host', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = '';
    // Same host as Host header — would normally pass same-origin auto-allow,
    // but the scheme is http:// so we must reject.
    const { err } = await callDelegate({
      headers: { origin: 'http://my-bastion.local', host: 'my-bastion.local' },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toMatch(/plaintext HTTP/i);
  });

  it('SECURITY: plaintext-HTTP origin is REJECTED even when whitelisted', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'http://oops.example.com';
    // Even if an operator misconfigures the env to include an http:// URL,
    // the CORS layer drops it (and logs a warning at parse time + reject at runtime).
    const { err } = await callDelegate({
      headers: { origin: 'http://oops.example.com', host: 'bastion.example.com' },
    });
    expect(err).toBeInstanceOf(Error);
  });

  it('production with empty CORS_ALLOWED_ORIGINS still serves same-origin', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = '';
    const { err, opts } = await callDelegate({
      headers: {
        origin: 'https://my-bastion.local',
        host: 'my-bastion.local',
      },
    });
    expect(err).toBeNull();
    expect((opts as any)?.origin).toBe(true);
  });
});
