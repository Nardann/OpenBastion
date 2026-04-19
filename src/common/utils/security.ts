import * as crypto from 'node:crypto';

/**
 * Native, lightweight cookie parser secured against Prototype Pollution.
 */
export function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  // Use Object.create(null) to prevent prototype pollution attacks
  const cookies: Record<string, string> = Object.create(null);
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    const value = rest.join('=');
    if (name && value) {
      const trimmedName = name.trim();
      // Additional safety: block known dangerous keys
      if (
        trimmedName !== '__proto__' &&
        trimmedName !== 'constructor' &&
        trimmedName !== 'prototype'
      ) {
        try {
          cookies[trimmedName] = decodeURIComponent(value.trim());
        } catch {
          cookies[trimmedName] = value.trim(); // Fallback to raw value
        }
      }
    }
  });
  return cookies;
}

export function safeCompare(a: string, b: string): boolean {
  // LOW-01 FIX: Use dynamic length based on input to avoid truncation, while still preventing timing attacks
  const FIXED_LENGTH = Math.max(Buffer.byteLength(a), Buffer.byteLength(b), 1);
  const bufA = Buffer.alloc(FIXED_LENGTH, 0);
  const bufB = Buffer.alloc(FIXED_LENGTH, 0);

  const aLen = Buffer.from(a).copy(bufA);
  const bLen = Buffer.from(b).copy(bufB);

  const equal = crypto.timingSafeEqual(bufA, bufB);

  // Combine equality check with length check
  return equal && aLen === bLen;
}
