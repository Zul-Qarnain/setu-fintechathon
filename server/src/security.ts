/** Password hashing (argon2id), JWT (HS256, pinned alg), RFC 6238 TOTP with replay protection. Port of backend/app/security.py. */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import { decrypt, encrypt } from './domain/crypto.js';

export const JWT_ALG = 'HS256';
export const JWT_TTL_SECONDS = 3600;

export async function hashPassword(pw: string): Promise<string> {
  return argonHash(pw); // argon2id, library defaults (m=19MiB,t=2,p=1)
}
export async function verifyPassword(pw: string, hashed: string): Promise<boolean> {
  try {
    return await argonVerify(hashed, pw);
  } catch {
    return false;
  }
}

const secretKey = (s: string) => new TextEncoder().encode(s);

export async function createToken(userId: string, role: string, jwtSecret: string, ttl = JWT_TTL_SECONDS, nowSec = Math.floor(Date.now() / 1000)): Promise<{ token: string; ttl: number }> {
  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: JWT_ALG, typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ttl)
    .setJti(randomUUID().replace(/-/g, ''))
    .sign(secretKey(jwtSecret));
  return { token, ttl };
}

/** Throws on any problem. Algorithm pinned: rejects alg=none / RS* / expired / missing claims. */
export async function decodeToken(token: string, jwtSecret: string): Promise<{ sub: string; role: string; exp: number; iat: number; jti?: string }> {
  const { payload } = await jwtVerify(token, secretKey(jwtSecret), { algorithms: [JWT_ALG], requiredClaims: ['exp', 'sub', 'iat'] });
  return payload as unknown as { sub: string; role: string; exp: number; iat: number; jti?: string };
}

// ---- TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 digits) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20)).slice(0, 32); // 160 bits -> 32 base32 chars (like pyotp)

export const totpUri = (secret: string, email: string): string =>
  `otpauth://totp/Setu:${encodeURIComponent(email)}?secret=${secret}&issuer=Setu`;

export function totpAt(secret: string, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = (h[h.length - 1] as number) & 0xf;
  const bin = (((h[off] as number) & 0x7f) << 24) | (((h[off + 1] as number) & 0xff) << 16) | (((h[off + 2] as number) & 0xff) << 8) | ((h[off + 3] as number) & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}
export const totpNow = (secret: string, now: () => number = Date.now): string => totpAt(secret, Math.floor(now() / 1000));

/** Returns the matched time-step if valid and not replayed (step > lastStep), else null. */
export function checkTotp(secret: string, code: string, lastStep: number, nowSeconds: number = Date.now() / 1000): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  for (const offset of [-1, 0, 1]) {
    const step = Math.floor(nowSeconds / 30) + offset;
    if (step <= lastStep) continue;
    const expect = Buffer.from(totpAt(secret, step * 30));
    const got = Buffer.from(code);
    if (expect.length === got.length && timingSafeEqual(expect, got)) return step;
  }
  return null;
}

export const encryptSecret = (secret: string, userId: string, keyB64?: string): string => encrypt(secret, keyB64 ? { aad: `totp:${userId}`, keyB64 } : { aad: `totp:${userId}` });
export const decryptSecret = (enc: string, userId: string, keyB64?: string): string => decrypt(enc, keyB64 ? { aad: `totp:${userId}`, keyB64 } : { aad: `totp:${userId}` });
