import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import {
  base32Decode,
  base32Encode,
  checkTotp,
  createToken,
  decodeToken,
  hashPassword,
  newTotpSecret,
  totpAt,
  verifyPassword,
} from '../../src/security.js';

const S = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

describe('TOTP (vectors from pyotp)', () => {
  it('matches pyotp', () => {
    expect([0, 59, 1700000000, 1760000000].map((t) => totpAt(S, t))).toEqual([
      '702218',
      '503347',
      '406058',
      '325812',
    ]);
  });
  it('base32 roundtrip and secret shape', () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it('accepts +-1 step, rejects replay and bad format', () => {
    const now = 1700000000;
    const step = Math.floor(now / 30);
    expect(checkTotp(S, totpAt(S, now), 0, now)).toBe(step);
    expect(checkTotp(S, totpAt(S, now - 30), 0, now)).toBe(step - 1);
    expect(checkTotp(S, totpAt(S, now), step, now)).toBeNull(); // replay
    expect(checkTotp(S, totpAt(S, now - 90), 0, now)).toBeNull(); // out of window
    expect(checkTotp(S, '12345', 0, now)).toBeNull();
    expect(checkTotp(S, 'abcdef', 0, now)).toBeNull();
  });
});

describe('passwords and JWT', () => {
  it('argon2id hash/verify', async () => {
    const h = await hashPassword('correct horse');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
  it('JWT roundtrip, expiry, alg pinning', async () => {
    const secret = 'unit-test-secret-0123456789abcdef0123';
    const { token } = await createToken('usr_1', 'student', secret);
    expect(await decodeToken(token, secret)).toMatchObject({ sub: 'usr_1', role: 'student' });
    await expect(decodeToken(token, 'other-secret-0123456789abcdef0123456')).rejects.toThrow();
    const old = await createToken('usr_1', 'student', secret, 60, 1000);
    await expect(decodeToken(old.token, secret)).rejects.toThrow();
    const none =
      Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') +
      '.' +
      Buffer.from('{"sub":"usr_1","exp":9999999999,"iat":1}').toString('base64url') +
      '.';
    await expect(decodeToken(none, secret)).rejects.toThrow();
    const hs512 = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('u')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    await expect(decodeToken(hs512, secret)).rejects.toThrow();
  });
});

import { decryptSecret, encryptSecret } from '../../src/security.js';
describe('TOTP secret at rest', () => {
  it('is encrypted and bound to the user', () => {
    const sec = newTotpSecret();
    const enc = encryptSecret(sec, 'u1');
    expect(enc).not.toContain(sec);
    expect(decryptSecret(enc, 'u1')).toBe(sec);
    expect(() => decryptSecret(enc, 'u2')).toThrow();
  });
});
