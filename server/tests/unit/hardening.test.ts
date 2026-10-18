/** GLM review hardening: NaN amounts, ReDoS, parseAmount, owner-wide split detection. */
import { describe, it, expect } from 'vitest';
import {
  decide,
  Outcome,
  Tier,
  ActionType,
  Action,
  Context,
  PayeeState,
} from '../../src/domain/policy.js';
import { Decimal } from '../../src/domain/money.js';
import { scanText } from '../../src/agents/guardian.js';
import { parseAmount } from '../../src/agents/intake.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const payee: PayeeState = {
  payee_id: 'p1',
  owner_id: 'u1',
  verified: true,
  cooling_off_until: null,
  changed: false,
};
const pay = (amt: Decimal | null): Action => ({
  type: ActionType.PAYMENT,
  owner_id: 'u1',
  amount_cny: amt,
  payee,
  source: 'user_instruction',
});
const ctx = (kw: Partial<Context> = {}): Context => ({
  now: NOW,
  recent_same_payee_cny: new Decimal(0),
  approvals: new Set(),
  ...kw,
});

describe('policy hardening', () => {
  it('NaN / Infinity / 3dp amounts are rejected (INVALID_AMOUNT, T4)', () => {
    for (const a of [new Decimal(NaN), new Decimal(Infinity), new Decimal('10.005')]) {
      const d = decide(pay(a), ctx());
      expect(d.outcome).toBe(Outcome.BLOCK);
      expect(d.tier).toBe(Tier.T4);
      expect(d.reasons).toContain('INVALID_AMOUNT');
    }
  });
  it('non-finite recent aggregate fails closed to T3', () => {
    const d = decide(pay(new Decimal(10)), ctx({ recent_same_payee_cny: new Decimal(NaN) }));
    expect(d.tier).toBe(Tier.T3);
  });
  it('payee rotation: owner-wide 24h aggregate triggers SPLIT_PAYMENT_SUSPECTED', () => {
    const d = decide(pay(new Decimal(500)), ctx({ recent_owner_cny: new Decimal(1900) }));
    expect(d.tier).toBe(Tier.T3);
    expect(d.reasons).toContain('SPLIT_PAYMENT_SUSPECTED');
  });
  it('guardian-blocked verify_payee is T4', () => {
    const d = decide(
      {
        type: ActionType.VERIFY_PAYEE,
        owner_id: 'u1',
        payee,
        source: 'user_instruction',
      } as Action,
      ctx({ guardian_blocked: true })
    );
    expect(d.tier).toBe(Tier.T4);
  });
});

describe('guardian ReDoS', () => {
  it('payee-change regex is linear on adversarial whitespace', () => {
    const t0 = performance.now();
    scanText('account' + ' '.repeat(50_000) + 'x');
    scanText('bank' + ' '.repeat(50_000));
    expect(performance.now() - t0).toBeLessThan(500);
  });
  it('still flags real payee-change notices', () => {
    for (const t of [
      'Our bank account has been changed.',
      'bank details updated',
      'account number have been moved',
    ]) {
      expect(scanText(t).flags.map((f) => f.code)).toContain('PAYEE_CHANGE_NOTICE');
    }
  });
});

describe('parseAmount', () => {
  it('parses normal, comma-grouped and European formats', () => {
    expect(parseAmount('CNY 18,500.00')?.toString()).toBe('18500');
    expect(parseAmount('¥1,350.50')?.toString()).toBe('1350.5');
    expect(parseAmount('12.345,67')?.toString()).toBe('12345.67');
  });
  it('rejects >2dp, negatives; never truncates', () => {
    expect(parseAmount('12.345')).toBeNull();
    expect(parseAmount('-100')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});
