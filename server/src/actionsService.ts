/** Action lifecycle: propose -> policy -> approvals (TOTP, family approver) -> execute. */
import { randomBytes } from 'node:crypto';
import type { AppContext } from './app.js';
import { execute } from './agents/executor.js';
import { appendAudit } from './db/auditStore.js';
import type { ActionRow, PayeeRow, UserRow } from './db/schema.js';
import { nowTs, tsFromMs } from './domain/audit.js';
import { Decimal } from './domain/money.js';
import * as policy from './domain/policy.js';
import { apiError, verifyUserTotp } from './deps.js';
import { newId } from './ids.js';

const ACTIVE = ['awaiting_approval', 'cooling_off', 'approved', 'executed'];
type Params = Record<string, unknown>;
type Approval = { approver_id: string; role: string; at: string; kind: string };

export function payeeState(p: PayeeRow | undefined): policy.PayeeState | null {
  if (!p) return null;
  return {
    payee_id: p.id,
    owner_id: p.owner_id,
    verified: p.verified_at !== null,
    cooling_off_until: p.cooling_off_until ? new Date(p.cooling_off_until) : null,
    changed: p.changed_from_id !== null,
  };
}

/** Decimal that never throws: unparseable -> NaN (policy rejects non-finite amounts). */
function safeDec(v: unknown): Decimal {
  try {
    return new Decimal(String(v));
  } catch {
    return new Decimal(NaN);
  }
}

function policyContext(
  ctx: AppContext,
  action: ActionRow,
  params: Params,
  approvals: Set<string>
): policy.Context {
  let recent = new Decimal(0);
  let recentOwner = new Decimal(0);
  const amt = (v: unknown): Decimal => {
    try {
      const d = new Decimal(String(v));
      return d.isFinite() ? d : new Decimal(Infinity);
    } catch {
      return new Decimal(Infinity);
    }
  };
  if (action.type === 'payment' && params.payee_id) {
    const since = tsFromMs(Date.now() - 24 * 3_600_000);
    const rows = ctx.db
      .prepare(
        `SELECT params_json FROM actions WHERE owner_id = ? AND type = 'payment' AND status IN (${ACTIVE.map(() => '?').join(',')}) AND created_at >= ? AND id != ?`
      )
      .all(action.owner_id, ...ACTIVE, since, action.id) as { params_json: string }[];
    for (const r of rows) {
      const op = JSON.parse(r.params_json) as Params;
      // owner-wide: only sub-cap payments count (over-cap ones are already T3 on their own)
      const a = amt(op.amount_cny);
      if (!a.gt(new Decimal(ctx.config.T2_CAP_CNY))) recentOwner = recentOwner.plus(a);
      if (op.payee_id === params.payee_id) recent = recent.plus(amt(op.amount_cny));
    }
  }
  return {
    now: new Date(),
    guardian_blocked: Boolean(params._guardian_blocked),
    recent_same_payee_cny: recent,
    recent_owner_cny: recentOwner,
    approvals,
    t2_cap: new Decimal(ctx.config.T2_CAP_CNY),
    cooling_off_hours: ctx.config.COOLING_OFF_HOURS,
  };
}

export function policyAction(ctx: AppContext, action: ActionRow): policy.Action {
  const params = JSON.parse(action.params_json) as Params;
  const payee = params.payee_id
    ? (ctx.db.prepare('SELECT * FROM payees WHERE id = ?').get(String(params.payee_id)) as
        PayeeRow | undefined)
    : undefined;
  return {
    type: action.type as policy.ActionType,
    owner_id: action.owner_id,
    amount_cny: params.amount_cny ? safeDec(params.amount_cny) : null,
    payee: payeeState(payee),
    source: action.source,
    bulk: Boolean(params.bulk),
    document_amount_cny: params.document_amount_cny
      ? new Decimal(String(params.document_amount_cny))
      : null,
  };
}

export const approvalsSet = (action: ActionRow): Set<string> =>
  new Set(
    (JSON.parse(action.approvals_json) as Approval[])
      .filter((a) => a.kind !== 'reject')
      .map((a) => a.kind)
  );

export function evaluate(ctx: AppContext, action: ActionRow): policy.Decision {
  const params = JSON.parse(action.params_json) as Params;
  return policy.decide(
    policyAction(ctx, action),
    policyContext(ctx, action, params, approvalsSet(action))
  );
}

function statusFor(d: policy.Decision, atype: string): string {
  if (d.outcome === policy.Outcome.BLOCK) return 'blocked';
  if (d.outcome === policy.Outcome.REQUIRE_COOLING_OFF) return 'cooling_off';
  if (d.outcome === policy.Outcome.REQUIRE_APPROVAL) return 'awaiting_approval';
  return atype === 'draft_message' ? 'draft' : 'approved';
}

export function decisionDict(d: policy.Decision) {
  return {
    outcome: d.outcome,
    tier: d.tier,
    reasons: d.reasons,
    required: d.required,
    cooling_off_until: d.cooling_off_until ? d.cooling_off_until.toISOString() : null,
    explanation: d.explanation,
  };
}

const getRow = (ctx: AppContext, id: string): ActionRow =>
  ctx.db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as ActionRow;

/** Creates an action row and lets the POLICY ENGINE classify it. Never executes payments. */
export function propose(
  ctx: AppContext,
  owner: UserRow,
  atype: string,
  params: Params,
  source: string,
  planId: string | null = null
): [ActionRow, policy.Decision] {
  const { db } = ctx;
  const id = newId('act');
  db.prepare(
    `INSERT INTO actions (id,owner_id,plan_id,type,tier,params_json,status,source,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    owner.id,
    planId,
    atype,
    'T4',
    JSON.stringify(params),
    'draft',
    source,
    `idem_${randomBytes(8).toString('hex')}`,
    nowTs()
  );
  const d = evaluate(ctx, getRow(ctx, id));
  db.prepare('UPDATE actions SET tier = ?, status = ?, decision_json = ? WHERE id = ?').run(
    d.tier,
    statusFor(d, atype),
    JSON.stringify(decisionDict(d)),
    id
  );
  appendAudit(
    db,
    owner.id,
    d.outcome !== policy.Outcome.BLOCK ? 'action.proposed' : 'action.blocked',
    {
      action_id: id,
      type: atype,
      tier: d.tier,
      outcome: d.outcome,
      reasons: d.reasons,
      source,
      amount_cny: params.amount_cny ?? null,
      payee_id: params.payee_id ?? null,
    }
  );
  return [getRow(ctx, id), d];
}

export function actionOut(ctx: AppContext, row: ActionRow) {
  const live = ['awaiting_approval', 'cooling_off', 'approved', 'draft'].includes(row.status);
  const dec = live
    ? decisionDict(evaluate(ctx, row))
    : (JSON.parse(row.decision_json) as Record<string, unknown>);
  const params: Params = Object.fromEntries(
    Object.entries(JSON.parse(row.params_json) as Params).filter(([k]) => !k.startsWith('_'))
  );
  params.idempotency_key = row.idempotency_key;
  return {
    id: row.id,
    plan_id: row.plan_id,
    type: row.type,
    tier: row.tier,
    status: row.status,
    params,
    decision: dec,
    approvals: JSON.parse(row.approvals_json) as Approval[],
    created_at: row.created_at,
    result: row.result_json ? (JSON.parse(row.result_json) as unknown) : null,
  };
}

export function visibleActions(
  ctx: AppContext,
  user: UserRow,
  status?: string | null
): ActionRow[] {
  const { db } = ctx;
  const where: string[] = [];
  const args: string[] = [];
  if (user.role === 'student') {
    where.push('owner_id = ?');
    args.push(user.id);
  } else if (user.role === 'family_approver') {
    const ids = (
      db.prepare('SELECT id FROM users WHERE approver_id = ?').all(user.id) as { id: string }[]
    ).map((u) => u.id);
    if (!ids.length) return [];
    where.push(`owner_id IN (${ids.map(() => '?').join(',')})`);
    args.push(...ids);
  }
  if (status) {
    where.push('status = ?');
    args.push(status);
  }
  return db
    .prepare(
      `SELECT * FROM actions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`
    )
    .all(...args) as ActionRow[];
}

export function getVisible(ctx: AppContext, user: UserRow, id: string): ActionRow {
  const row = ctx.db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as ActionRow | undefined;
  if (row) {
    if (user.role === 'admin' || row.owner_id === user.id) return row;
    const owner = ctx.db.prepare('SELECT approver_id FROM users WHERE id = ?').get(row.owner_id) as
      { approver_id: string | null } | undefined;
    if (user.role === 'family_approver' && owner && owner.approver_id === user.id) return row;
  }
  throw apiError(404, 'NOT_FOUND', 'Action not found'); // IDOR-safe
}

export function approve(ctx: AppContext, actor: UserRow, id: string, totpCode: string): ActionRow {
  const { db } = ctx;
  let row = getVisible(ctx, actor, id);
  if (actor.role === 'admin') throw apiError(403, 'FORBIDDEN', 'Admins cannot approve actions');
  if (!['awaiting_approval', 'cooling_off'].includes(row.status))
    throw apiError(409, 'INVALID_STATE', `Action is ${row.status}; cannot approve`, {
      status: row.status,
    });
  const kind = actor.id === row.owner_id ? 'totp' : 'family_approver';
  if (approvalsSet(row).has(kind))
    throw apiError(409, 'ALREADY_APPROVED', 'You already approved this action');
  const d = evaluate(ctx, row);
  if (d.outcome === policy.Outcome.BLOCK) {
    db.prepare("UPDATE actions SET status = 'blocked', tier = ? WHERE id = ?").run(d.tier, row.id);
    appendAudit(db, actor.id, 'action.blocked', { action_id: row.id, reasons: d.reasons });
    throw apiError(403, 'POLICY_BLOCKED', d.explanation, { reasons: d.reasons });
  }
  if (d.cooling_off_until !== null && Date.now() < d.cooling_off_until.getTime()) {
    appendAudit(db, actor.id, 'approval.rejected_cooling_off', {
      action_id: row.id,
      until: d.cooling_off_until.toISOString(),
    });
    throw apiError(409, 'COOLING_OFF_ACTIVE', 'Cooling-off period is still running', {
      cooling_off_until: d.cooling_off_until.toISOString(),
    });
  }
  verifyUserTotp(ctx, actor, totpCode); // replay + lockout enforced here
  const approvals = JSON.parse(row.approvals_json) as Approval[];
  approvals.push({ approver_id: actor.id, role: actor.role, at: new Date().toISOString(), kind });
  db.prepare('UPDATE actions SET approvals_json = ? WHERE id = ?').run(
    JSON.stringify(approvals),
    row.id
  );
  appendAudit(db, actor.id, 'action.approved', { action_id: row.id, kind });
  row = getRow(ctx, row.id);
  const d2 = evaluate(ctx, row);
  db.prepare('UPDATE actions SET decision_json = ? WHERE id = ?').run(
    JSON.stringify(decisionDict(d2)),
    row.id
  );
  if (d2.outcome === policy.Outcome.ALLOW) {
    const result = execute(ctx, getRow(ctx, row.id), d2); // re-checked by the executor itself
    db.prepare('UPDATE actions SET result_json = ? WHERE id = ?').run(
      JSON.stringify(result),
      row.id
    );
  } else {
    db.prepare('UPDATE actions SET status = ? WHERE id = ?').run(statusFor(d2, row.type), row.id);
  }
  return getRow(ctx, row.id);
}

export function reject(ctx: AppContext, actor: UserRow, id: string, reason: string): ActionRow {
  const row = getVisible(ctx, actor, id);
  if (actor.role === 'admin') throw apiError(403, 'FORBIDDEN', 'Admins cannot reject actions');
  if (!['awaiting_approval', 'cooling_off', 'draft', 'approved'].includes(row.status))
    throw apiError(409, 'INVALID_STATE', `Action is ${row.status}; cannot reject`, {
      status: row.status,
    });
  const approvals = JSON.parse(row.approvals_json) as Approval[];
  approvals.push({
    approver_id: actor.id,
    role: actor.role,
    at: new Date().toISOString(),
    kind: 'reject',
  });
  ctx.db
    .prepare("UPDATE actions SET approvals_json = ?, status = 'rejected' WHERE id = ?")
    .run(JSON.stringify(approvals), row.id);
  appendAudit(ctx.db, actor.id, 'action.rejected', {
    action_id: row.id,
    reason: reason.slice(0, 200),
  });
  return getRow(ctx, row.id);
}
