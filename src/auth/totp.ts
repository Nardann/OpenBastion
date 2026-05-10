import * as crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const s = input.toUpperCase().replace(/=+$/, '');
  const result: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      result.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(result);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += '=';
  return out;
}

function hotp(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = (hmac[19] ?? 0) & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function keyuri(email: string, issuer: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function timingSafeStrEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a TOTP token.
 *   - Window: ±1 step (covers ~30s clock skew in either direction).
 *   - Comparison: constant-time over the candidate codes.
 *   - Replay protection: caller must remember `(userId, counter)` of the
 *     last accepted value and reject any equal or older counter. We expose
 *     the matched counter so the caller can persist it.
 */
export function verify({
  token,
  secret,
}: {
  token: string;
  secret: string;
}): boolean {
  return verifyWithCounter({ token, secret }) !== null;
}

export function verifyWithCounter({
  token,
  secret,
  lastUsedCounter,
}: {
  token: string;
  secret: string;
  lastUsedCounter?: number;
}): number | null {
  if (!/^\d{6}$/.test(token)) return null;
  const counter = Math.floor(Date.now() / 1000 / 30);
  // Iterate -1, 0, +1 so the most likely (current) counter is checked, but
  // we still walk the full window in constant-time-friendly order.
  let matched: number | null = null;
  for (const delta of [-1, 0, 1]) {
    const c = counter + delta;
    const candidate = hotp(secret, c);
    if (timingSafeStrEqual(candidate, token)) {
      matched = c;
      // Don't early-return: keep doing comparisons to avoid timing leaks.
    }
  }
  if (matched === null) return null;
  if (typeof lastUsedCounter === 'number' && matched <= lastUsedCounter) {
    // Replay: same code or an older window already consumed.
    return null;
  }
  return matched;
}
