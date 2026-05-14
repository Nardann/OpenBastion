/**
 * Security constants for token and session management
 */

// JWT access token expiration
export const JWT_EXPIRATION_SECONDS = 900; // 15 minutes
export const JWT_EXPIRATION_STRING = '15m';

// JWT refresh token expiration
export const JWT_REFRESH_EXPIRATION_SECONDS = 7 * 24 * 3600; // 7 days
export const JWT_REFRESH_EXPIRATION_STRING = '7d';

// Cookie maxAge (in milliseconds)
export const JWT_COOKIE_MAX_AGE_MS = JWT_EXPIRATION_SECONDS * 1000;
export const JWT_REFRESH_COOKIE_MAX_AGE_MS = JWT_REFRESH_EXPIRATION_SECONDS * 1000;

// Token blacklist cleanup (remove expired tokens from DB)
export const TOKEN_BLACKLIST_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const TOKEN_BLACKLIST_RETENTION_HOURS = 25;

// OTP lockout constants
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCKOUT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes base window
export const OTP_BACKOFF_BASE_MS = 30_000; // 30 seconds
export const OTP_BACKOFF_MAX_MS = 30 * 60 * 1000; // 30 minutes cap

// Rate Limiting Constants
export const THROTTLE_GLOBAL_TTL = Number(process.env.THROTTLE_GLOBAL_TTL || 1000);
export const THROTTLE_GLOBAL_LIMIT = Number(process.env.THROTTLE_GLOBAL_LIMIT || 20);

export const THROTTLE_AUTH_TTL = Number(process.env.THROTTLE_AUTH_TTL || 900000); // 15 mins
export const THROTTLE_AUTH_LIMIT = Number(process.env.THROTTLE_AUTH_LIMIT || 20);

// Per-user rate limits (requests per minute)
export const THROTTLE_USER_TTL = 60_000;
export const THROTTLE_USER_LIMIT_ADMIN = 300;
export const THROTTLE_USER_LIMIT_USER = 100;
export const THROTTLE_USER_LIMIT_ANON = 30;

