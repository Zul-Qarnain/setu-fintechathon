import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Decimal } from 'decimal.js';
import { openDb, type Db } from '../../src/db/connection.js';
import { createSchema } from '../../src/db/schema.js';
import {
  IdempotencyMismatch,
  UnknownAccount,
  getAccount,
  listTransactions,
  openAccount,
  transfer,
} from '../../src/sandboxBank/ledger.js';

const SRC = '6222000000000001';
const DST = '6222000000004821';
let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  createSchema(db);
  openAccount(db, SRC, 'Student', '30000');
  openAccount(db, DST, 'Univ');
});
const tr = (key: string, to = DST, amt = '100.00', ref = 'r') =>
  transfer(db, key, SRC, to, amt, ref);
const bal = (n: string) => getAccount(db, n)?.balance_cny;

describe('sandbox ledger', () => {
  it('settle moves money', () => {
    const r = tr('k1');
    expect(r.state).toBe('settled');
    expect(bal(SRC)).toBe('29900.00');
    expect(bal(DST)).toBe('100.00');
  });

  it.each([
    ['6222000000000013', '10', 'failed', 'ACCOUNT_CLOSED'],
    [DST, '50000.01', 'failed', 'LIMIT_EXCEEDED'],
    [DST, '10.99', 'held', 'RISK_HOLD'],
    [DST, '30000.01', 'failed', 'INSUFFICIENT_FUNDS'],
    [DST, '0', 'failed', 'INVALID_AMOUNT'],
  ])('deterministic failure %s %s -> %s/%s moves no money', (to, amt, state, code) => {
    const r = tr('kx', to, amt);
    expect([r.state, r.failure_code]).toEqual([state, code]);
    expect(bal(SRC)).toBe('30000.00');
  });

  it('idempotent replay: no double spend', () => {
    const a = tr('k1');
    const b = tr('k1');
    expect(a.txn_id).toBe(b.txn_id);
    expect(b.idempotent_replay).toBe(true);
    expect(a.idempotent_replay).toBe(false);
    expect(bal(SRC)).toBe('29900.00');
    expect((db.prepare('SELECT COUNT(*) c FROM sbx_txns').get() as { c: number }).c).toBe(1);
  });

  it('key reuse with other params is rejected', () => {
    tr('k1');
    expect(() => tr('k1', DST, '101.00')).toThrow(IdempotencyMismatch);
  });

  it('unknown source account', () => {
    expect(() => transfer(db, 'k', '6222000000009999', DST, '1')).toThrow(UnknownAccount);
  });

  it('list transactions normalises account numbers', () => {
    tr('a');
    tr('b');
    expect(listTransactions(db, '6222 0000 0000 4821')).toHaveLength(2);
  });

  it('property: total balance is conserved and never negative', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: -100, max: 6_000_000 }), fc.boolean()), {
          maxLength: 15,
        }),
        (ops) => {
          const d = openDb(':memory:');
          createSchema(d);
          openAccount(d, SRC, 'S', '30000');
          openAccount(d, DST, 'U');
          ops.forEach(([cents, replay], i) => {
            const amt = new Decimal(cents).div(100).toFixed(2);
            transfer(d, `k${i}`, SRC, DST, amt);
            if (replay) transfer(d, `k${i}`, SRC, DST, amt);
          });
          const a = new Decimal(getAccount(d, SRC)?.balance_cny ?? 'NaN');
          const b = new Decimal(getAccount(d, DST)?.balance_cny ?? 'NaN');
          expect(a.plus(b).toFixed(2)).toBe('30000.00');
          expect(a.gte(0)).toBe(true);
        }
      ),
      { numRuns: 60 }
    );
  });
});
