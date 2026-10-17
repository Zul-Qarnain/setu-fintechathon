/** AES-256-GCM field encryption (PII columns, TOTP secrets). Port of backend/app/domain/crypto.py. Format: enc:v1:<b64(nonce||ct||tag)> */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAesKeyB64 } from './keys.js';

const NONCE_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'enc:v1:';

export class CryptoError extends Error {}

function keyBytes(keyB64?: string): Buffer {
  const raw = Buffer.from(keyB64 ?? getAesKeyB64(), 'base64');
  if (raw.length !== 32) throw new CryptoError('AES key must be 32 bytes (base64)');
  return raw;
}

export interface CryptoOpts {
  aad?: string;
  keyB64?: string;
}

/** Fresh random 12-byte nonce on every call. `aad` binds the ciphertext to a context (row id). */
export function encrypt(plaintext: string, opts: CryptoOpts = {}): string {
  const nonce = randomBytes(NONCE_LEN);
  const c = createCipheriv('aes-256-gcm', keyBytes(opts.keyB64), nonce);
  c.setAAD(Buffer.from(opts.aad ?? '', 'utf8'));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([nonce, ct, c.getAuthTag()]).toString('base64');
}

export function decrypt(token: string, opts: CryptoOpts = {}): string {
  if (!token.startsWith(PREFIX)) throw new CryptoError('not an encrypted value');
  try {
    const raw = Buffer.from(token.slice(PREFIX.length), 'base64');
    if (raw.length < NONCE_LEN + TAG_LEN) throw new CryptoError('decryption failed');
    const d = createDecipheriv('aes-256-gcm', keyBytes(opts.keyB64), raw.subarray(0, NONCE_LEN));
    d.setAAD(Buffer.from(opts.aad ?? '', 'utf8'));
    d.setAuthTag(raw.subarray(raw.length - TAG_LEN));
    return Buffer.concat([d.update(raw.subarray(NONCE_LEN, raw.length - TAG_LEN)), d.final()]).toString('utf8');
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    throw new CryptoError('decryption failed');
  }
}

export const hmacSha256Hex = (key: string | Buffer, data: string | Buffer): string => createHmac('sha256', key).update(data).digest('hex');

/** Constant-time string compare (length-checked). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
