import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CryptoError, decrypt, encrypt } from '../../src/domain/crypto.js';
import * as T from '../../src/domain/tokenize.js';

const KEY2 = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU=';
const V = JSON.parse(readFileSync(new URL('../fixtures/crypto_vectors.json', import.meta.url), 'utf8')) as Record<string, string>;

describe('crypto', () => {
  it('roundtrip and prefix', () => {
    const tok = encrypt('6222000000004821', { aad: 'payee:1' });
    expect(tok.startsWith('enc:v1:') && !tok.includes('6222')).toBe(true);
    expect(decrypt(tok, { aad: 'payee:1' })).toBe('6222000000004821');
  });
  it('decrypts a Python-produced ciphertext (cross-language)', () => {
    expect(decrypt(V['ct'] as string, { aad: 'payee:1' })).toBe('6222000000004821');
  });
  it('fresh nonce per call', () => expect(encrypt('x')).not.toBe(encrypt('x')));
  it('wrong aad / key / tamper fails', () => {
    const tok = encrypt('secret', { aad: 'a' });
    expect(() => decrypt(tok, { aad: 'b' })).toThrow(CryptoError);
    expect(() => decrypt(tok, { aad: 'a', keyB64: KEY2 })).toThrow(CryptoError);
    expect(() => decrypt(tok.slice(0, -4) + (tok.endsWith('AAAA') ? 'BBBB' : 'AAAA'), { aad: 'a' })).toThrow(CryptoError);
    expect(() => decrypt('plain text')).toThrow(CryptoError);
  });
  it('bad key length rejected', () => expect(() => encrypt('x', { keyB64: 'c2hvcnQ=' })).toThrow(CryptoError));
  it('property: roundtrip', () => {
    fc.assert(fc.property(fc.string({ maxLength: 200 }), (s) => decrypt(encrypt(s, { aad: 'p' }), { aad: 'p' }) === s));
  });
});

describe('tokenize', () => {
  it('normalize folds fullwidth and separators', () => {
    expect(T.normalizeAccount('6222 0000-0000_4821')).toBe('6222000000004821');
    expect(T.normalizeAccount('６２２２００００')).toBe('62220000');
  });
  it('tokens match Python values', () => {
    const a = T.accountToken('6222 0000 0000 4821');
    expect(a).toBe(V['acct_token']);
    expect(a).toBe(T.accountToken('6222000000004821'));
    expect(a.length).toBe(15);
    expect(a).not.toBe(T.accountToken('6222000000004822'));
    expect(T.accountHash('6222000000004821')).toBe(V['acct_hash']);
    expect(T.nameToken('Shenzhen Example University')).toBe(V['name_token']);
    expect(T.nameToken('shenzhen example university (SYNTHETIC)')).toBe(V['name_token']);
    expect(T.nameSkeleton('Shenzhen Examp1e University')).toBe(V['skeleton']);
  });
  it('mask', () => {
    expect(T.maskAccount('6222 0000 0000 4821')).toBe('****4821');
    expect(T.maskAccount('12')).toBe('****');
  });
  it('homoglyphs', () => {
    expect(T.hasHomoglyphs('Exam\u0440le') && T.hasHomoglyphs('６２２２')).toBe(true);
    expect(T.hasHomoglyphs('账号：6222 0000') || T.hasHomoglyphs('Example')).toBe(false);
  });
  it('is_valid_account', () => {
    expect(T.isValidAccount('6222 0000 0000 4821')).toBe(true);
    for (const bad of ['123', '6222 0000 0000 48x1', '６２２２００００００００４８２１', '6222'.repeat(8)]) expect(T.isValidAccount(bad)).toBe(false);
  });
  it('name skeleton folds lookalikes', () => {
    expect(T.nameSkeleton('Shenzhen Exam\u0440le University')).toBe(T.nameSkeleton('Shenzhen Example University'));
    expect(T.nameSkeleton('Shenzhen Examp1e University')).toBe(T.nameSkeleton('Shenzhen Example University (SYNTHETIC)'));
    expect(T.nameSkeleton('深圳示例大学（合成）')).toBe('深圳示例大学');
  });
  it('tokenize_text replaces accounts only', () => {
    const [out, m] = T.tokenizeText('pay 6222 0000 0000 4821 CNY 18500 by 2027-03-01 ref 2027-SPRING-0042');
    expect(out).not.toContain('6222');
    expect(out).toContain('18500');
    expect(out).toContain('2027-03-01');
    expect(Object.values(m)).toEqual(['****4821']);
  });
  it('redact_pii and redact_obj', () => {
    const s = T.redactPii('a@b.com 13800138000 6222 0000 0000 4821 ok');
    expect(s).toContain('[EMAIL]');
    expect(s).toContain('[PHONE]');
    expect(s).toContain('****4821');
    expect(s).not.toContain('6222');
    expect(T.redactObj({ a: ['x 6222000000004821'], b: { c: 'm@e.io' }, n: 5 })).toEqual({ a: ['x ****4821'], b: { c: '[EMAIL]' }, n: 5 });
  });
  it('property: redacted text never contains raw long numbers', () => {
    fc.assert(fc.property(fc.stringMatching(/^[0-9]{12,19}$/), (num) => !T.redactPii(`acct ${num} end`).includes(num)));
  });
});
