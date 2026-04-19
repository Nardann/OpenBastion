/**
 * Security constants for token and session management
 */

// JWT token expiration (must match auth.module.ts signOptions.expiresIn)
export const JWT_EXPIRATION_SECONDS = 3600; // 1 hour
export const JWT_EXPIRATION_STRING = '1h'; // For JwtModule config

// Cookie maxAge (in milliseconds)
export const JWT_COOKIE_MAX_AGE_MS = JWT_EXPIRATION_SECONDS * 1000; // 1 hour

// Token blacklist cleanup (remove expired tokens from DB)
export const TOKEN_BLACKLIST_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const TOKEN_BLACKLIST_RETENTION_HOURS = 25; // Keep blacklist entries for 25 hours for audit trail

// Rate Limiting Constants
export const THROTTLE_GLOBAL_TTL = Number(process.env.THROTTLE_GLOBAL_TTL || 1000);
export const THROTTLE_GLOBAL_LIMIT = Number(process.env.THROTTLE_GLOBAL_LIMIT || 20);

export const THROTTLE_AUTH_TTL = Number(process.env.THROTTLE_AUTH_TTL || 900000); // 15 mins
export const THROTTLE_AUTH_LIMIT = Number(process.env.THROTTLE_AUTH_LIMIT || 20);

