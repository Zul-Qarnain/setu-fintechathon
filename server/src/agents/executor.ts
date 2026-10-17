/** Executor: performs side effects ONLY for Decision.ALLOW. The LLM never reaches this. Port of backend/app/agents/executor.py. */
import type { AppContext } from '../app.js';
import { appendAudit } from '../db/auditStore.js';
import type { ActionRow, ObligationRow, PayeeRow } from '../db/schema.js';
import { nowTs } from '../domain/audit.js';
import { ActionType, Outcome, type Decision } from '../domain/policy.js';
import { getAccountByOwner, transfer, transferResultDict } from '../sandboxBank/ledger.js';
import { payeeAccountNumber } from '../services.js';

export class PolicyViolation extends Error {}

type Params = Record<string, unknown>;

const setStatus = (ctx: AppContext, id: string, status: string): void => {
  ctx.db.prepare('UPDATE actions SET status = ? WHERE id = ?').run(status, id);
};

export function execute(
  ctx: AppContext,
  action: ActionRow,
  decision: Decision
): Record<string, unknown> {
  if (decision.outcome !== Outcome.ALLOW) {
    appendAudit(ctx.db, 'executor', 'executor.refused', {
      action_id: action.id,
      outcome: decision.outcome,
    });
    throw new PolicyViolation(`executor refuses non-ALLOW decision: ${decision.outcome}`);
  }
  if (['executed', 'failed', 'rejected', 'blocked'].includes(action.status))
    throw new PolicyViolation(`action already terminal: ${action.status}`);
  const params = JSON.parse(action.params_json) as Params;
  switch (action.type as ActionType) {
    case ActionType.PAYMENT:
      return pay(ctx, action, params);
    case ActionType.VERIFY_PAYEE:
      return verifyPayee(ctx, action, params);
    case ActionType.DRAFT_MESSAGE:
      setStatus(ctx, action.id, 'executed');
      return { drafted: true, sent: false };
    default:
      setStatus(ctx, action.id, 'executed');
      return { noop: true };
  }
}

function pay(ctx: AppContext, action: ActionRow, params: Params): Record<string, unknown> {
  const { db } = ctx;
  const payee = db.prepare('SELECT * FROM payees WHERE id = ?').get(String(params.payee_id)) as
    PayeeRow | undefined;
  const owner = db.prepare('SELECT id FROM users WHERE id = ?').get(action.owner_id) as
    { id: string } | undefined;
  if (!payee || !owner || payee.owner_id !== owner.id)
    throw new PolicyViolation('payee/owner mismatch at execution time');
  const src = getAccountByOwner(db, owner.id);
  if (!src) {
    setStatus(ctx, action.id, 'failed');
    return { state: 'failed', failure_code: 'NO_SANDBOX_ACCOUNT', sandbox: true };
  }
  const res = transfer(
    db,
    action.idempotency_key,
    src.account_number,
    payeeAccountNumber(payee),
    String(params.amount_cny),
    (params.reference as string | null | undefined) ?? null
  );
  const result = transferResultDict(res);
  if (res.state === 'settled') {
    setStatus(ctx, action.id, 'executed');
    const obId = params.obligation_id as string | undefined;
    const ob = obId
      ? (db.prepare('SELECT * FROM obligations WHERE id = ?').get(obId) as
          ObligationRow | undefined)
      : undefined;
    if (ob) db.prepare("UPDATE obligations SET status = 'paid' WHERE id = ?").run(ob.id);
  } else {
    setStatus(ctx, action.id, 'failed');
  }
  appendAudit(db, 'executor', res.state === 'settled' ? 'payment.executed' : 'payment.failed', {
    action_id: action.id,
    amount_cny: params.amount_cny,
    payee_id: payee.id,
    bank_txn_id: res.txn_id,
    state: res.state,
    failure_code: res.failure_code,
  });
  return result;
}

function verifyPayee(ctx: AppContext, action: ActionRow, params: Params): Record<string, unknown> {
  const payee = ctx.db.prepare('SELECT * FROM payees WHERE id = ?').get(String(params.payee_id)) as
    PayeeRow | undefined;
  if (!payee) throw new PolicyViolation('payee missing');
  ctx.db.prepare('UPDATE payees SET verified_at = ? WHERE id = ?').run(nowTs(), payee.id);
  setStatus(ctx, action.id, 'executed');
  appendAudit(ctx.db, 'executor', 'payee.verified', { action_id: action.id, payee_id: payee.id });
  return { payee_id: payee.id, verified: true };
}
