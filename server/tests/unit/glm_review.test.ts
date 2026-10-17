import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/connection.js';
import { createSchema } from '../../src/db/schema.js';
import { nowTs } from '../../src/domain/audit.js';
import {
  assertNonDefaultKeys,
  DEV_AES_KEY_B64,
  DEV_HMAC_KEY,
  DEV_JWT_SECRET,
} from '../../src/domain/keys.js';
import { nameSkeleton } from '../../src/domain/tokenize.js';
import { openAccount, transfer } from '../../src/sandboxBank/ledger.js';
import { hashPassword } from '../../src/security.js';

describe('GLM review fixes', () => {
  it('argon2id PHC params match Python (m=65536,t=3,p=4)', async () => {
    expect(await hashPassword('x')).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
  });
  it('ledger: 1.005 quantizes HALF_EVEN to 1.00 and replays with 1.00 (Python-identical request hash)', () => {
    const db = openDb(':memory:');
    createSchema(db);
    openAccount(db, '6222000000000001', 'S', '100');
    openAccount(db, '6222000000004821', 'U');
    const a = transfer(db, 'k', '6222000000000001', '6222000000004821', '1.005', 'r');
    expect(a.amount_cny).toBe('1.00');
    const b = transfer(db, 'k', '6222000000000001', '6222000000004821', '1.00', 'r');
    expect(b.idempotent_replay).toBe(true);
    expect(a.txn_id).toMatch(/^sbx_txn_[0-9a-f]{12}$/);
  });
  it('ledger rejects JS numbers at the money boundary', () => {
    const db = openDb(':memory:');
    createSchema(db);
    openAccount(db, '6222000000000001', 'S', '100');
    expect(() =>
      transfer(db, 'k', '6222000000000001', '6222000000004821', 100.155 as unknown as string)
    ).toThrow(TypeError);
  });
  it('nameSkeleton casefold vectors (Python)', () => {
    expect(['Straße University', 'STRASSE University', 'İstanbul Uni'].map(nameSkeleton)).toEqual([
      'strasseuniversity',
      'strasseuniversity',
      'istanbuluni',
    ]);
  });
  it('nowTs is strictly increasing with 6-digit micros', () => {
    const xs = Array.from({ length: 2000 }, nowTs);
    for (let i = 1; i < xs.length; i++)
      expect((xs[i] as string) > (xs[i - 1] as string)).toBe(true);
    expect(xs[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
  });
  it('dev keys refused in production only', () => {
    const dev = {
      HMAC_KEY: DEV_HMAC_KEY,
      JWT_SECRET: DEV_JWT_SECRET,
      AES_KEY_B64: DEV_AES_KEY_B64,
    };
    expect(() => assertNonDefaultKeys(dev, 'production')).toThrow();
    expect(() => assertNonDefaultKeys(dev, 'development')).not.toThrow();
    expect(() =>
      assertNonDefaultKeys(
        {
          ...dev,
          HMAC_KEY: 'x'.repeat(40),
          JWT_SECRET: 'y'.repeat(40),
          AES_KEY_B64: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU=',
        },
        'production'
      )
    ).not.toThrow();
  });
});
