/**
 * Security-focused CORS configuration.
 *
 * Strategy:
 *   - In development, allow localhost / 127.0.0.1 on common ports.
 *   - In production, require an explicit `CORS_ALLOWED_ORIGINS` env (comma-
 *     separated). No wildcards.
 *   - In ALL environments, requests whose `Origin` matches the request's
 *     own `Host` header (i.e. truly same-origin) are accepted automatically.
 *     This is what unblocks self-hosted deployments where the operator
 *     reaches the bastion via several names/IPs without having to maintain
 *     a multi-entry whitelist (e.g. https://localhost AND https://10.0.0.5
 *     simultaneously).
 *
 * The `cors` middleware accepts a "delegate" form that gives us access to
 * the incoming request — we use it to compute a per-request decision.
 */
import type { Request } from 'express';
import type { CorsOptions } from 'cors';

// `app.enableCors()` and socket.io both expect a delegate parameterised on
// `any` rather than a typed Request, so we describe the shape here without
// bringing in `cors` `CorsOptionsDelegate<Request>` (which would force an
// `any` cast at every call site).
type CorsDelegate = (
  req: any,
  callback: (err: Error | null, options: CorsOptions) => void,
) => void;

function parseAllowedOrigins(): string[] {
  const env = process.env.NODE_ENV || 'development';

  // SECURITY: HTTPS-only policy. Any `http://` entry in CORS_ALLOWED_ORIGINS
  // is silently dropped (and logged) — the bastion never accepts requests
  // from plaintext origins, even in development. A self-signed cert is fine;
  // unencrypted transport is not.
  const stripHttp = (origin: string): boolean => {
    if (origin.startsWith('http://')) {
      // eslint-disable-next-line no-console
      console.warn(
        `CORS: dropping plaintext-HTTP origin from allowlist: ${origin}`,
      );
      return false;
    }
    return true;
  };

  if (env === 'production') {
    const configured = process.env.CORS_ALLOWED_ORIGINS || '';
    if (!configured) {
      // eslint-disable-next-line no-console
      console.error(
        'CRITICAL: CORS_ALLOWED_ORIGINS is not set in production! Falling back to none. ' +
          'Same-origin requests will still work via the auto-detection below.',
      );
      return [];
    }
    return configured
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0)
      .filter(stripHttp);
  }

  // Development defaults — HTTPS only. The bastion's own nginx serves
  // HTTPS on 443 with a self-signed cert at install time; access it
  // through that, not through some http://localhost:3000 dev server.
  return [
    'https://localhost',
    'https://localhost:443',
    'https://localhost:3000',
    'https://127.0.0.1',
    'https://127.0.0.1:443',
    'https://127.0.0.1:3000',
  ];
}

/**
 * Returns true if `origin` (e.g. "https://10.0.0.5") refers to the same
 * host the request is reaching us on (e.g. Host: "10.0.0.5"). This catches
 * the legitimate self-host case where the user types the bastion's own IP
 * or hostname in the browser. Forbids cross-origin scripts.
 */
function isSameOriginRequest(req: Request, origin: string): boolean {
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHost = String(req.headers['host'] ?? '').toLowerCase();
    if (!requestHost) return false;
    // Compare full host:port pairs. URL.host already includes the port if
    // explicit; req.headers.host follows the same convention.
    return originHost === requestHost;
  } catch {
    return false;
  }
}

export function getCorsConfig(): CorsDelegate {
  const envAllowedOrigins = parseAllowedOrigins();

  const delegate: CorsDelegate = (req, callback) => {
    const origin = (req.headers?.['origin'] as string | undefined) ?? undefined;
    const baseOptions: CorsOptions = {
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['X-Total-Count'],
      maxAge: 3600,
    };

    // No Origin: typically same-origin browser GETs, mobile apps, curl.
    // CORS isn't applicable; let the upstream `requireOriginOnMutations`
    // middleware in main.ts gate POST/PATCH/DELETE.
    if (!origin) {
      callback(null, { ...baseOptions, origin: true });
      return;
    }

    // SECURITY: refuse any plaintext-HTTP origin outright, regardless of
    // whether it would otherwise match the same-origin auto-allow or the
    // env whitelist. We do not accept requests from unencrypted transports.
    if (origin.startsWith('http://')) {
      // eslint-disable-next-line no-console
      console.warn(`CORS rejected plaintext-HTTP origin: ${origin}`);
      callback(
        new Error(`Plaintext HTTP origin not allowed: ${origin}`),
        { ...baseOptions, origin: false },
      );
      return;
    }

    // Same-origin: always allow. The browser only sends `Origin` from a
    // cross-origin context anyway, but if the host matches the URL bar
    // then this isn't really cross-origin from a security model standpoint.
    if (isSameOriginRequest(req, origin)) {
      callback(null, { ...baseOptions, origin: true });
      return;
    }

    if (envAllowedOrigins.includes(origin)) {
      callback(null, { ...baseOptions, origin: true });
      return;
    }

    // eslint-disable-next-line no-console
    console.warn(`CORS rejected origin: ${origin} (host=${req.headers['host']})`);
    callback(new Error(`Not allowed by CORS: ${origin}`), { ...baseOptions, origin: false });
  };

  return delegate;
}
