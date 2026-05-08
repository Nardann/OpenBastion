export const REDIS_KEY = {
  OTP_LOCKOUT: (userId: string) => `otp:lockout:${userId}`,
  REFRESH_TOKEN: (jti: string) => `refresh:${jti}`,
  SESSION: (sessionId: string) => `session:${sessionId}`,
} as const;
