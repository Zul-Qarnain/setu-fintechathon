/** Policy engine tests. */
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

const NOW = new Date('2026-10-17T12:00:00Z');

function payee(
  verified = true,
  owner = 'u1',
  cool: Date | null = null,
  changed = false
): PayeeState {
  return { payee_id: 'p1', owner_id: owner, verified, cooling_off_until: cool, changed };
}

function pay(
  amount: string | number | null,
  p: PayeeState | null = null,
  source = 'user_instruction',
  ...kw: any[]
): Action {
  return {
    type: ActionType.PAYMENT,
    owner_id: 'u1',
    amount_cny: amount !== null ? new Decimal(String(amount)) : null,
    payee: p ?? payee(),
    source,
    ...Object.assign({}, ...kw),
  };
}

function ctx(kw: Partial<Context> = {}): Context {
  return { now: NOW, recent_same_payee_cny: new Decimal('0'), approvals: new Set(), ...kw };
}

describe('policy', () => {
  describe('test_read_and_draft_always_allowed', () => {
    it('READ is T0 allowed', () => {
      const result = decide({ type: ActionType.READ, owner_id: 'u1' } as Action, ctx());
      expect(result.tier).toBe(Tier.T0);
    });

    it('DRAFT_MESSAGE is T1 allowed even with guardian blocked', () => {
      const result = decide(
        { type: ActionType.DRAFT_MESSAGE, owner_id: 'u1' } as Action,
        ctx({ guardian_blocked: true })
      );
      expect(result.outcome).toBe(Outcome.ALLOW);
      expect(result.tier).toBe(Tier.T1);
    });
  });

  describe('test_tier_boundaries', () => {
    it.each([
      ['1', 'T2', 'WITHIN_T2_CAP'],
      ['2000', 'T2', 'WITHIN_T2_CAP'],
      ['2000.01', 'T3', 'OVER_T2_CAP'],
      ['18500', 'T3', 'OVER_T2_CAP'],
    ])('amount %s -> tier %s with %s', (amount, expectedTier, expectedReason) => {
      const d = decide(pay(amount), ctx());
      expect(d.tier).toBe(expectedTier as Tier);
      expect(d.reasons).toContain(expectedReason as string);
      expect(d.outcome).toBe(Outcome.REQUIRE_APPROVAL);
      expect(d.required).toEqual(expectedTier === 'T2' ? ['totp'] : ['totp', 'family_approver']);
    });
  });

  describe('test_approvals_progressively_satisfy', () => {
    it('single totp on T3 leaves family_approver outstanding', () => {
      const d = decide(pay('18500'), ctx({ approvals: new Set(['totp']) }));
      expect(d.outcome).toBe(Outcome.REQUIRE_APPROVAL);
      expect(d.required).toEqual(['family_approver']);
    });

    it('totp + family_approver on T3 -> allowed', () => {
      const d = decide(pay('18500'), ctx({ approvals: new Set(['totp', 'family_approver']) }));
      expect(d.allowed).toBe(true);
    });

    it('totp on T2 -> allowed', () => {
      const d = decide(pay('100'), ctx({ approvals: new Set(['totp']) }));
      expect(d.allowed).toBe(true);
    });
  });

  describe('test_family_approver_alone_is_not_enough', () => {
    it('family_approver alone does not allow', () => {
      const d = decide(pay('100'), ctx({ approvals: new Set(['family_approver']) }));
      expect(d.allowed).toBe(false);
    });
  });

  describe('test_untrusted_sources_blocked', () => {
    it.each(['document_text', 'message_text', 'model_suggestion'])('%s is blocked', (src) => {
      const d = decide(
        pay('10', payee(), src),
        ctx({ approvals: new Set(['totp', 'family_approver']) })
      );
      expect(d.outcome).toBe(Outcome.BLOCK);
      expect(d.tier).toBe(Tier.T4);
    });
  });

  describe('test_unknown_source_is_untrusted', () => {
    it('unknown source blocks', () => {
      const d = decide(pay('10', payee(), 'who_knows'), ctx());
      expect(d.outcome).toBe(Outcome.BLOCK);
    });
  });

  describe('test_guardian_block_overrides_everything', () => {
    it('guardian_blocked blocks even with all approvals', () => {
      const d = decide(
        pay('10'),
        ctx({ guardian_blocked: true, approvals: new Set(['totp', 'family_approver']) })
      );
      expect(d.outcome).toBe(Outcome.BLOCK);
      expect(d.reasons).toContain('INJECTION_DETECTED');
    });
  });

  describe('test_payee_problems_blocked', () => {
    it('null payee -> PAYEE_UNREGISTERED', () => {
      const a = {
        type: ActionType.PAYMENT,
        owner_id: 'u1',
        amount_cny: new Decimal('10'),
        payee: null,
      } as Action;
      expect(decide(a, ctx()).reasons).toContain('PAYEE_UNREGISTERED');
    });

    it('unverified payee -> PAYEE_UNVERIFIED', () => {
      const d = decide(pay('10', payee(false)), ctx());
      expect(d.reasons).toContain('PAYEE_UNVERIFIED');
    });

    it('cross-user payee -> CROSS_USER_PAYEE', () => {
      const d = decide(pay('10', payee(false, 'u2')), ctx());
      expect(d.reasons).toContain('CROSS_USER_PAYEE');
    });
  });

  describe('test_invalid_amounts_blocked', () => {
    it.each([null, '0', '-5'])('invalid amount %s blocks', (amt) => {
      const d = decide(pay(amt), ctx());
      expect(d.reasons).toContain('INVALID_AMOUNT');
    });
  });

  describe('test_amount_mismatch_blocked', () => {
    it('amount != document_amount_cny blocks', () => {
      const d = decide(
        pay('1000', payee(), 'user_instruction', { document_amount_cny: new Decimal('100') }),
        ctx()
      );
      expect(d.outcome).toBe(Outcome.BLOCK);
      expect(d.reasons).toContain('AMOUNT_MISMATCH');
    });

    it('amount == document_amount_cny requires approval', () => {
      const d = decide(
        pay('100', payee(), 'user_instruction', { document_amount_cny: new Decimal('100') }),
        ctx()
      );
      expect(d.outcome).toBe(Outcome.REQUIRE_APPROVAL);
    });
  });

  describe('test_split_payments_aggregate', () => {
    it('1500 + 1000 > 2000 -> T3 SPLIT_PAYMENT_SUSPECTED', () => {
      const d = decide(pay('1500'), ctx({ recent_same_payee_cny: new Decimal('1000') }));
      expect(d.tier).toBe(Tier.T3);
      expect(d.reasons).toContain('SPLIT_PAYMENT_SUSPECTED');
    });

    it('1500 + 500 <= 2000 -> T2 WITHIN_T2_CAP', () => {
      const d = decide(pay('1500'), ctx({ recent_same_payee_cny: new Decimal('500') }));
      expect(d.tier).toBe(Tier.T2);
    });
  });

  describe('test_cooling_off_and_expiry', () => {
    it('cooling-off in future -> REQUIRE_COOLING_OFF', () => {
      const until = new Date(NOW.getTime() + 5 * 60 * 60 * 1000); // +5 hours
      const ap = new Set(['totp', 'family_approver']);
      const d = decide(pay('100', payee(true, 'u1', until)), ctx({ approvals: ap }));
      expect(d.outcome).toBe(Outcome.REQUIRE_COOLING_OFF);
      expect(d.tier).toBe(Tier.T3);
      expect(d.required).toContain('cooling_off');
      expect(d.cooling_off_until).toBe(until);
    });

    it('cooling-off expired -> allowed', () => {
      const until = new Date(NOW.getTime() + 5 * 60 * 60 * 1000);
      const later = new Date(until.getTime() + 1000);
      const ap = new Set(['totp', 'family_approver']);
      const d = decide(pay('100', payee(true, 'u1', until)), ctx({ now: later, approvals: ap }));
      expect(d.allowed).toBe(true);
    });

    it('changed=true adds PAYEE_CHANGED reason', () => {
      const until = new Date(NOW.getTime() + 5 * 60 * 60 * 1000);
      const d = decide(pay('100', payee(true, 'u1', until, true)), ctx());
      expect(d.reasons).toContain('PAYEE_CHANGED');
    });
  });

  describe('test_verify_payee_is_t3', () => {
    it('VERIFY_PAYEE to unverified payee -> T3 require totp+family', () => {
      const a = {
        type: ActionType.VERIFY_PAYEE,
        owner_id: 'u1',
        amount_cny: null,
        payee: payee(false),
        source: 'user_instruction',
      } as Action;
      const d = decide(a, ctx());
      expect(d.outcome).toBe(Outcome.REQUIRE_APPROVAL);
      expect(d.tier).toBe(Tier.T3);
      expect(d.required).toEqual(['totp', 'family_approver']);
    });

    it('VERIFY_PAYEE with approvals -> allowed', () => {
      const a = {
        type: ActionType.VERIFY_PAYEE,
        owner_id: 'u1',
        amount_cny: null,
        payee: payee(false),
        source: 'user_instruction',
      } as Action;
      const d = decide(a, ctx({ approvals: new Set(['totp', 'family_approver']) }));
      expect(d.allowed).toBe(true);
    });

    it('VERIFY_PAYEE with cooling-off changed -> REQUIRE_COOLING_OFF', () => {
      const until = new Date(NOW.getTime() + 60 * 60 * 1000);
      const a = {
        type: ActionType.VERIFY_PAYEE,
        owner_id: 'u1',
        amount_cny: null,
        payee: payee(false, 'u1', until, true),
        source: 'user_instruction',
      } as Action;
      const d = decide(a, ctx());
      expect(d.outcome).toBe(Outcome.REQUIRE_COOLING_OFF);
    });

    it('VERIFY_PAYEE cross-user -> BLOCK', () => {
      const a = {
        type: ActionType.VERIFY_PAYEE,
        owner_id: 'u1',
        amount_cny: null,
        payee: payee(false, 'u2'),
        source: 'user_instruction',
      } as Action;
      const d = decide(a, ctx());
      expect(d.outcome).toBe(Outcome.BLOCK);
    });
  });

  describe('test_export_data', () => {
    it('bulk export -> BLOCK', () => {
      const a = {
        type: ActionType.EXPORT_DATA,
        owner_id: 'u1',
        bulk: true,
        source: 'user_instruction',
      } as Action;
      const d = decide(a, ctx());
      expect(d.outcome).toBe(Outcome.BLOCK);
    });

    it('non-bulk export -> ALLOW', () => {
      const a = {
        type: ActionType.EXPORT_DATA,
        owner_id: 'u1',
        source: 'user_instruction',
      } as Action;
      const d = decide(a, ctx());
      expect(d.allowed).toBe(true);
    });
  });

  describe('test_unknown_action_type_default_deny', () => {
    it('unknown action type blocks', () => {
      const fakeAction = { type: 'wire_everything' as any };
      const d = decide(fakeAction as Action, ctx());
      expect(d.outcome).toBe(Outcome.BLOCK);
    });
  });
});
