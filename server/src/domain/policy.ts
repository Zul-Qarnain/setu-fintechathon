/** Server-side policy engine. The ONLY authority that authorises actions (never the LLM).
 *
 * decide(action, ctx) is pure and deterministic; it is re-evaluated at approval time and again
 * immediately before execution. The executor accepts only Outcome.ALLOW.
 *
 * Tiers: T0 read; T1 draft; T2 <= cap to a VERIFIED payee (TOTP); T3 > cap or new/changed payee
 * (TOTP + family approver + 24h cooling-off for new payees); T4 blocked.
 */

import { Decimal, ZERO } from '../domain/money.js';

export enum Outcome {
  ALLOW = 'ALLOW',
  REQUIRE_APPROVAL = 'REQUIRE_APPROVAL',
  REQUIRE_COOLING_OFF = 'REQUIRE_COOLING_OFF',
  BLOCK = 'BLOCK',
}

export enum Tier {
  T0 = 'T0',
  T1 = 'T1',
  T2 = 'T2',
  T3 = 'T3',
  T4 = 'T4',
}

export enum ActionType {
  READ = 'read',
  DRAFT_MESSAGE = 'draft_message',
  PAYMENT = 'payment',
  VERIFY_PAYEE = 'verify_payee',
  EXPORT_DATA = 'export_data',
}

// Where the instruction/target of an action came from.
export const TRUSTED_SOURCES = new Set<string>(['user_instruction', 'confirmed_obligation']);
export const UNTRUSTED_SOURCES = new Set<string>([
  'document_text',
  'message_text',
  'model_suggestion',
]);

export const T2_CAP = new Decimal('2000');
export const COOLING_OFF_HOURS = 24;

export interface PayeeState {
  payee_id: string;
  owner_id: string;
  verified: boolean;
  cooling_off_until: Date | null; // set when verified-but-new / changed
  changed: boolean;
}

export interface Action {
  type: ActionType;
  owner_id: string;
  amount_cny: Decimal | null;
  payee: PayeeState | null;
  source: string;
  bulk?: boolean; // export_data: bulk PII export
  document_amount_cny?: Decimal | null; // confirmed obligation amount, if any
}

export interface Context {
  now: Date;
  guardian_blocked?: boolean;
  recent_same_payee_cny: Decimal; // executed + pending in last 24h (split detection)
  recent_owner_cny?: Decimal; // same, across ALL of the owner's payees (payee-rotation split detection)
  approvals: Set<string>; // satisfied: "totp", "family_approver"
  t2_cap?: Decimal;
  cooling_off_hours?: number;
}

export interface Decision {
  outcome: Outcome;
  tier: Tier;
  reasons: string[];
  required: string[]; // still-required items
  cooling_off_until: Date | null;
  explanation: string;

  get allowed(): boolean;
}

class DecisionImpl implements Decision {
  constructor(
    public outcome: Outcome,
    public tier: Tier,
    public reasons: string[],
    public required: string[],
    public cooling_off_until: Date | null,
    public explanation: string
  ) {}

  get allowed(): boolean {
    return this.outcome === Outcome.ALLOW;
  }
}

function _block(reasons: string[], why: string): Decision {
  return new DecisionImpl(Outcome.BLOCK, Tier.T4, reasons, [], null, why);
}

export function decide(action: Action, ctx: Context): Decision {
  if (action.type === ActionType.READ) {
    return new DecisionImpl(Outcome.ALLOW, Tier.T0, ['READ_ONLY'], [], null, 'Read-only: allowed.');
  }
  if (action.type === ActionType.DRAFT_MESSAGE) {
    return new DecisionImpl(
      Outcome.ALLOW,
      Tier.T1,
      ['DRAFT_ONLY'],
      [],
      null,
      'Draft only: nothing is sent.'
    );
  }
  if (action.type === ActionType.EXPORT_DATA) {
    if (action.bulk) {
      return _block(['BULK_PII_EXPORT'], 'Bulk personal-data export is never allowed.');
    }
    return new DecisionImpl(
      Outcome.ALLOW,
      Tier.T0,
      ['OWN_DATA_EXPORT'],
      [],
      null,
      'Own-data export.'
    );
  }
  if (action.type === ActionType.PAYMENT || action.type === ActionType.VERIFY_PAYEE) {
    return _decide_money(action, ctx);
  }
  return _block(['UNKNOWN_ACTION_TYPE'], 'Unknown action type: blocked (default deny).');
}

function _decide_money(action: Action, ctx: Context): Decision {
  if (ctx.guardian_blocked) {
    return _block(['INJECTION_DETECTED'], 'Guardian flagged the source content: blocked.');
  }
  const payee = action.payee;
  if (!TRUSTED_SOURCES.has(action.source)) {
    const code = action.source === 'model_suggestion' ? 'MODEL_SUGGESTION' : 'DOC_ONLY_SOURCE';
    const why: string[] = [code];
    if (payee === null || payee === undefined) {
      why.push('PAYEE_UNREGISTERED');
    } else if (!payee.verified) {
      why.push('PAYEE_UNVERIFIED');
    }
    return _block(why, 'Action sourced only from document/message/model text: blocked.');
  }
  if (payee === null || payee === undefined) {
    return _block(['PAYEE_UNREGISTERED'], 'Payee is not in the registry: blocked.');
  }
  if (payee.owner_id !== action.owner_id) {
    return _block(['CROSS_USER_PAYEE'], 'Payee belongs to another user: blocked.');
  }

  if (action.type === ActionType.VERIFY_PAYEE) {
    return _decide_verify_payee(payee, ctx);
  }

  const amount = action.amount_cny;
  if (
    amount === null ||
    amount === undefined ||
    !amount.isFinite() ||
    amount.lte(ZERO) ||
    amount.decimalPlaces() > 2
  ) {
    return _block(['INVALID_AMOUNT'], 'Amount must be positive: blocked.');
  }
  if (
    action.document_amount_cny !== undefined &&
    action.document_amount_cny !== null &&
    !action.document_amount_cny.eq(amount)
  ) {
    return _block(['AMOUNT_MISMATCH'], 'Amount differs from the confirmed obligation: blocked.');
  }
  if (!payee.verified) {
    return _block(
      ['PAYEE_UNVERIFIED'],
      'Payee is unverified: blocked until a family approver verifies it.'
    );
  }

  const reasons: string[] = ['PAYEE_VERIFIED'];
  const required: string[] = ['totp'];
  let cooling_until: Date | null = null;
  let tier = Tier.T2;

  const t2_cap = ctx.t2_cap ?? T2_CAP;
  let recent = ctx.recent_same_payee_cny;
  if (ctx.recent_owner_cny && ctx.recent_owner_cny.gt(recent)) recent = ctx.recent_owner_cny;
  if (!recent.isFinite()) recent = new Decimal(Infinity); // fail closed
  const aggregate = amount.add(recent);

  if (amount.gt(t2_cap)) {
    tier = Tier.T3;
    reasons.push('OVER_T2_CAP');
  } else if (aggregate.gt(t2_cap)) {
    tier = Tier.T3;
    reasons.push('SPLIT_PAYMENT_SUSPECTED');
  } else {
    reasons.push('WITHIN_T2_CAP');
  }

  if (payee.cooling_off_until !== null && payee.cooling_off_until !== undefined) {
    const cool_until = payee.cooling_off_until;
    const now = ctx.now;
    if (now < cool_until) {
      tier = Tier.T3;
      cooling_until = cool_until;
      reasons.push(payee.changed ? 'PAYEE_CHANGED' : 'NEW_PAYEE');
    }
  }

  if (tier === Tier.T3) {
    required.push('family_approver');
  }
  if (cooling_until !== null) {
    required.push('cooling_off');
  }

  const outstanding = required.filter((r) => !ctx.approvals.has(r) && r !== 'cooling_off');
  if (cooling_until !== null) {
    outstanding.push('cooling_off'); // clears only when time passes (handled above)
  }

  if (outstanding.length === 0) {
    return new DecisionImpl(
      Outcome.ALLOW,
      tier,
      reasons,
      [],
      cooling_until,
      `${tier} satisfied: allowed.`
    );
  }
  if (cooling_until !== null) {
    return new DecisionImpl(
      Outcome.REQUIRE_COOLING_OFF,
      Tier.T3,
      reasons,
      outstanding,
      cooling_until,
      'New or changed payee: 24h cooling-off, TOTP and family approver required.'
    );
  }
  if (tier === Tier.T3) {
    return new DecisionImpl(
      Outcome.REQUIRE_APPROVAL,
      tier,
      reasons,
      outstanding,
      null,
      'TOTP and family approver required.'
    );
  }
  return new DecisionImpl(
    Outcome.REQUIRE_APPROVAL,
    tier,
    reasons,
    outstanding,
    null,
    'At or below the T2 cap to a verified payee: TOTP required.'
  );
}

function _decide_verify_payee(payee: PayeeState, ctx: Context): Decision {
  /** Verifying a payee is itself T3: TOTP + family approver (cooling-off applies to the payee). */
  const required: string[] = ['totp', 'family_approver'];
  const outstanding = required.filter((r) => !ctx.approvals.has(r));
  const reasons: string[] = [payee.changed ? 'PAYEE_CHANGED' : 'NEW_PAYEE', 'VERIFY_PAYEE'];
  const until = payee.cooling_off_until;

  if (until !== null && until !== undefined && ctx.now < until) {
    outstanding.push('cooling_off');
    return new DecisionImpl(
      Outcome.REQUIRE_COOLING_OFF,
      Tier.T3,
      reasons,
      outstanding,
      until,
      'Payee change: 24h cooling-off, TOTP and family approver required.'
    );
  }
  if (outstanding.length > 0) {
    return new DecisionImpl(
      Outcome.REQUIRE_APPROVAL,
      Tier.T3,
      reasons,
      outstanding,
      null,
      'TOTP and family approver required to verify a payee.'
    );
  }
  return new DecisionImpl(
    Outcome.ALLOW,
    Tier.T3,
    reasons,
    [],
    null,
    'T3 satisfied: payee verification allowed.'
  );
}
