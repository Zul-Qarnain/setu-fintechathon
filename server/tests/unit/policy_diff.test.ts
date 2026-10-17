/** Differential test: policy.decide() must equal the Python engine on every recorded vector. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/domain/money.js';
import { decide, type Action, type Context, type PayeeState } from '../../src/domain/policy.js';

interface Vec {
  input: { action: Record<string, any>; context?: Record<string, any> };
  output: {
    outcome: string;
    tier: string;
    reasons: string[];
    required: string[];
    cooling_off_until: string | null;
    explanation: string;
  };
}
const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/policy_vectors.json', import.meta.url), 'utf8')
) as Vec[];
const dt = (s: string | null | undefined) => (s ? new Date(s) : null);
const dec = (s: string | null | undefined) =>
  s === null || s === undefined ? null : new Decimal(s);

function toAction(a: Record<string, any>): Action {
  const p = ('payee' in a ? a['payee'] : {}) as Record<string, any> | null; // key absent => Python helper's default verified payee
  const payee: PayeeState | null = p
    ? {
        payee_id: p['payee_id'] ?? 'p1',
        owner_id: p['owner_id'] ?? a['owner_id'],
        verified: p['verified'] ?? true,
        cooling_off_until: dt(p['cooling_off_until']),
        changed: p['changed'] ?? false,
      }
    : null;
  const act: Action = {
    type: a['type'],
    owner_id: a['owner_id'],
    amount_cny: dec(a['amount_cny']),
    payee,
    source: a['source'] ?? 'user_instruction',
  };
  if ('bulk' in a) act.bulk = a['bulk'];
  if ('document_amount_cny' in a) act.document_amount_cny = dec(a['document_amount_cny']);
  return act;
}
function toCtx(c: Record<string, any> = {}): Context {
  return {
    now: dt(c['now']) ?? new Date('2026-10-17T12:00:00Z'),
    guardian_blocked: c['guardian_blocked'] ?? false,
    recent_same_payee_cny: new Decimal(c['recent_same_payee_cny'] ?? '0'),
    approvals: new Set<string>(c['approvals'] ?? []),
  };
}

describe('policy differential vs Python', () => {
  it('has >= 200 vectors', () => expect(vectors.length).toBeGreaterThanOrEqual(200));
  it.each(vectors.map((v, i) => [i, v] as const))('vector %i', (_i, v) => {
    const d = decide(toAction(v.input.action), toCtx(v.input.context));
    expect({
      outcome: d.outcome,
      tier: d.tier,
      reasons: d.reasons,
      required: d.required,
      explanation: d.explanation,
    }).toEqual({
      outcome: v.output.outcome,
      tier: v.output.tier,
      reasons: v.output.reasons,
      required: v.output.required,
      explanation: v.output.explanation,
    });
    expect(d.cooling_off_until ? d.cooling_off_until.getTime() : null).toBe(
      v.output.cooling_off_until ? new Date(v.output.cooling_off_until).getTime() : null
    );
  });
});
