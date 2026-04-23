/**
 * Security-focused CORS configuration
 * Strict whitelist-based approach with environment-specific defaults
 */

export function getCorsConfig() {
  const env = process.env.NODE_ENV || 'development';

  let allowedOrigins: string[] = [];

  if (env === 'production') {
    // SECURITY FIX: In production, require explicit configuration
    const configuredOrigins = process.env.CORS_ALLOWED_ORIGINS || '';
    if (!configuredOrigins) {
      console.error(
        'CRITICAL: CORS_ALLOWED_ORIGINS is not set in production! Defaulting to none for security.',
      );
      allowedOrigins = [];
    } else {
      allowedOrigins = configuredOrigins
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
    }
  } else {
    // Development: allow localhost on various ports
    allowedOrigins = [
      'http://localhost',
      'https://localhost',
      'http://localhost:3000',
      'https://localhost:3000',
      'http://localhost:80',
      'http://localhost:8080',
      'https://localhost:443',
      'http://127.0.0.1',
      'https://127.0.0.1',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:80',
      'http://127.0.0.1:8080',
    ];
  }

  return {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (like same-origin browser GETs, mobile apps or curl)
      if (!origin) {
        return callback(null, true);
      }

      // Strict exact match - no wildcards
      const isAllowed = allowedOrigins.includes(origin);

      if (isAllowed) {
        callback(null, true);
      } else {
        // Log CORS rejection attempts
        console.warn(`CORS rejected origin: ${origin}`);
        callback(new Error(`Not allowed by CORS: ${origin}`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Total-Count'],
    maxAge: 3600, // 1 hour
  };
}
