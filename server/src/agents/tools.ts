/** Deterministic tools. They are the ONLY source of numbers. propose_* never execute anything. */
import type { AppContext } from '../app.js';
import type { ActionRow, DocumentRow, ObligationRow, PayeeRow, UserRow } from '../db/schema.js';
import { summarize, totalDueBy } from '../domain/budget.js';
import { computeCosts, DEFAULT_CHANNEL } from '../domain/costs.js';
import { Decimal } from '../domain/money.js';
import * as tokenize from '../domain/tokenize.js';
import { docPlain } from '../docService.js';
import { apiError } from '../deps.js';
import { createPayee, findPayeeByAccount, fxQuoteOut } from '../services.js';

export type Args = Record<string, unknown>;
export type Out = Record<string, unknown>;

export interface Proposal {
  atype: string;
  params: Record<string, unknown>;
  source: string;
  plan: Out | null;
}

export interface ToolState {
  ctx: AppContext;
  user: UserRow;
  today: string; // ISO date
  tokenMap: Record<string, string>; // ACCT_ token -> raw account
  outputs: Record<string, Out>;
  proposals: Proposal[];
  lastPlan: Out | null;
  guardianBlockedDocs: Set<string>;
}

export const newToolState = (ctx: AppContext, user: UserRow, today: string): ToolState => ({
  ctx,
  user,
  today,
  tokenMap: {},
  outputs: {},
  proposals: [],
  lastPlan: null,
  guardianBlockedDocs: new Set(),
});

/** Resolve '$tool.field' references to earlier tool outputs. */
function resolve(value: unknown, st: ToolState): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const rest = value.slice(1);
    const i = rest.indexOf('.');
    const tool = i < 0 ? rest : rest.slice(0, i);
    const fld = i < 0 ? '' : rest.slice(i + 1);
    const v = (st.outputs[tool] ?? {})[fld];
    return v === undefined || v === null ? null : String(v);
  }
  return value;
}

/** `_dec`: cleaned decimal string or null. */
function decStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, '').trim();
  try {
    const d = new Decimal(s);
    return d.isFinite() ? s : null;
  } catch {
    return null;
  }
}
const truthyDec = (s: string | null): s is string => s !== null && !new Decimal(s).isZero();

const getPayee = (st: ToolState, id: string | null): PayeeRow | undefined =>
  id
    ? (st.ctx.db.prepare('SELECT * FROM payees WHERE id = ?').get(id) as PayeeRow | undefined)
    : undefined;

function obligationDict(st: ToolState, o: ObligationRow): Out {
  const p = getPayee(st, o.payee_id);
  return {
    found: true,
    obligation_id: o.id,
    title: o.title,
    amount_cny: o.amount_cny,
    due_date: o.due_date,
    payee_id: o.payee_id,
    payee_name: p ? p.name : null,
    payee_verified: Boolean(p && p.verified_at),
    status: o.status,
    doc_hash: o.doc_hash,
  };
}

export function getObligation(st: ToolState, a: Args): Out {
  const { db } = st.ctx;
  const oid = resolve(a.obligation_id, st) as string | null | undefined;
  const did = a.document_id as string | null | undefined;
  const kw = a.keyword as string | null | undefined;
  if (oid) {
    const o = db.prepare('SELECT * FROM obligations WHERE id = ?').get(oid) as
      ObligationRow | undefined;
    return o && o.user_id === st.user.id ? obligationDict(st, o) : { found: false };
  }
  if (did) {
    const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(did) as
      DocumentRow | undefined;
    if (!d || d.owner_id !== st.user.id) return { found: false };
    const o2 = db
      .prepare(
        "SELECT * FROM obligations WHERE user_id = ? AND doc_hash = ? AND status != 'cancelled' LIMIT 1"
      )
      .get(st.user.id, d.doc_hash) as ObligationRow | undefined;
    if (o2) return obligationDict(st, o2);
    return {
      found: false,
      document_status: d.status,
      needs_confirmation: d.status === 'pending_confirmation',
    };
  }
  let rows = db
    .prepare("SELECT * FROM obligations WHERE user_id = ? AND status = 'open' ORDER BY due_date")
    .all(st.user.id) as ObligationRow[];
  if (kw) {
    const k = String(kw).toLowerCase();
    const hit = rows.filter(
      (o) =>
        (o.title ?? '').toLowerCase().includes(k) || (o.reference ?? '').toLowerCase().includes(k)
    );
    if (hit.length) rows = hit;
  }
  return rows[0] ? obligationDict(st, rows[0]) : { found: false };
}

export function listObligationsDue(st: ToolState, a: Args): Out {
  const byS = (a.by as string | null | undefined) ?? null;
  const by = byS ?? '9999-12-31';
  const rows = st.ctx.db
    .prepare("SELECT * FROM obligations WHERE user_id = ? AND status = 'open' ORDER BY due_date")
    .all(st.user.id) as ObligationRow[];
  const sel = rows.filter((o) => o.due_date <= by);
  const total = totalDueBy(
    rows.map((o) => ({ amount_cny: new Decimal(o.amount_cny), due_date: o.due_date })),
    by
  );
  return {
    by: byS,
    count: sel.length,
    total_cny: total.toFixed(2),
    items: sel.map((o) => ({
      obligation_id: o.id,
      title: o.title,
      amount_cny: o.amount_cny,
      due_date: o.due_date,
    })),
  };
}

export async function fxQuote(st: ToolState, a: Args): Promise<Out> {
  const raw = decStr(resolve(a.amount_cny, st));
  const amt = truthyDec(raw) ? raw : '1000';
  const q = await fxQuoteOut(st.ctx, amt, String(a.quote || 'BDT'));
  return {
    pair: q.pair,
    rate: q.rate,
    amount_cny: q.amount_cny,
    amount_converted: q.amount_converted,
    source: q.source,
    is_live: q.is_live,
    as_of: q.as_of,
    disclaimer: q.disclaimer,
  };
}

export async function computeCostsTool(st: ToolState, a: Args): Promise<Out> {
  const raw = decStr(resolve(a.amount_cny, st));
  if (raw === null || new Decimal(raw).lte(0))
    return { ok: false, reason: 'no positive amount to cost' };
  const c = await computeCosts(new Decimal(raw), st.ctx.fx, {
    channel: (a.channel as string | undefined) || DEFAULT_CHANNEL,
  });
  const out: Out = {
    ok: true,
    channel: c.channel,
    amount_cny: c.amount_cny.toFixed(2),
    fx_rate: c.fx_rate.toFixed(4),
    fx_source: c.fx_source,
    fees: c.fees.map((f) => ({ label: f.label, amount_cny: f.amount_cny.toFixed(2) })),
    total_fees_cny: c.total_fees_cny.toFixed(2),
    fee_pct: c.fee_pct.toFixed(2),
    total_cny: c.total_cny.toFixed(2),
    bdt_needed: c.bdt_needed.toFixed(2),
    notes: c.notes,
  };
  st.lastPlan = out;
  return out;
}

export function budgetSummary(st: ToolState): Out {
  const month = st.today.slice(0, 7);
  const rows = st.ctx.db
    .prepare(
      "SELECT * FROM actions WHERE owner_id = ? AND type = 'payment' AND status = 'executed'"
    )
    .all(st.user.id) as ActionRow[];
  let spent = new Decimal(0);
  let any = false;
  for (const r of rows) {
    if (r.created_at.slice(0, 7) === month) {
      spent = spent.plus(new Decimal(String((JSON.parse(r.params_json) as Args).amount_cny)));
      any = true;
    }
  }
  const b = summarize(new Decimal(st.user.monthly_budget_cny), spent);
  return {
    monthly_budget_cny: b.monthly_budget_cny.toFixed(2),
    spent_this_month_cny: any ? b.spent_this_month_cny.toFixed(2) : '0',
    remaining_cny: b.remaining_cny.toFixed(2),
    over_budget: b.over_budget,
  };
}

function registryPayeeByToken(st: ToolState, hint: unknown): PayeeRow | null {
  if (!hint) return null;
  const h = String(hint);
  const raw = st.tokenMap[h] ?? h;
  if (!tokenize.isValidAccount(raw)) return null;
  return findPayeeByAccount(st.ctx, st.user.id, raw) ?? null;
}

export function proposePayment(st: ToolState, a: Args): Out {
  const { db, config } = st.ctx;
  const origin = (a.origin as string | undefined) ?? 'user';
  const oid = resolve(a.obligation_id, st) as string | null | undefined;
  const did = a.document_id as string | null | undefined;
  const cap = {
    t2_cap_cny: new Decimal(config.T2_CAP_CNY).toFixed(2),
    cooling_off_hours: config.COOLING_OFF_HOURS,
  };
  if (oid) {
    const o = db.prepare('SELECT * FROM obligations WHERE id = ?').get(oid) as
      ObligationRow | undefined;
    if (!o || o.user_id !== st.user.id) return { proposed: false, reason: 'obligation not found' };
    const plan = st.lastPlan && st.lastPlan.amount_cny === o.amount_cny ? st.lastPlan : null;
    st.proposals.push({
      atype: 'payment',
      params: {
        obligation_id: o.id,
        amount_cny: o.amount_cny,
        payee_id: o.payee_id,
        payee_name: getPayee(st, o.payee_id)?.name ?? null,
        reference: o.reference,
        document_amount_cny: o.amount_cny,
      },
      source: 'confirmed_obligation',
      plan,
    });
    return { proposed: true, amount_cny: o.amount_cny, source: 'confirmed_obligation', ...cap };
  }
  if (did) {
    const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(did) as
      DocumentRow | undefined;
    if (!d || d.owner_id !== st.user.id) return { proposed: false, reason: 'document not found' };
    const parsed = JSON.parse(d.parsed_json) as Record<string, string | null>;
    const docAcct = docPlain(d).account_number ?? null;
    const payee = registryPayeeByToken(st, docAcct);
    st.proposals.push({
      atype: 'payment',
      params: {
        amount_cny: parsed.amount_cny ?? null,
        payee_id: payee?.id ?? null,
        payee_name: parsed.payee_name ?? null,
        document_id: d.id,
        payee_account_token: docAcct ? tokenize.accountToken(docAcct) : null,
      },
      source: 'document_text',
      plan: null,
    });
    if (d.status === 'blocked') st.guardianBlockedDocs.add(d.id);
    return {
      proposed: true,
      amount_cny: parsed.amount_cny ?? null,
      source: 'document_text',
      ...cap,
    };
  }
  // free-form (model/user text): payee must resolve in registry or it is blocked by policy
  const payee = registryPayeeByToken(st, a.payee_account);
  const raw = decStr(a.amount_cny);
  const amt = truthyDec(raw) ? raw : null;
  const src =
    origin === 'user'
      ? 'user_instruction'
      : origin === 'message'
        ? 'message_text'
        : 'model_suggestion';
  st.proposals.push({
    atype: 'payment',
    params: {
      amount_cny: amt,
      payee_id: payee?.id ?? null,
      payee_name: payee?.name ?? null,
      payee_account_token: (a.payee_account as string | undefined) ?? null,
    },
    source: src,
    plan: null,
  });
  return { proposed: true, amount_cny: amt, source: src, ...cap };
}

export function proposeVerifyPayee(st: ToolState, a: Args): Out {
  const { db, config } = st.ctx;
  const acc = (a.account_number as string | null | undefined) ?? null;
  const raw = st.tokenMap[acc ?? ''] ?? acc;
  if (!raw || !tokenize.isValidAccount(raw))
    return { proposed: false, reason: 'no valid account number found in the message' };
  let name = a.name as string | null | undefined;
  if (!name) {
    const o = db
      .prepare(
        "SELECT * FROM obligations WHERE user_id = ? AND status = 'open' ORDER BY due_date LIMIT 1"
      )
      .get(st.user.id) as ObligationRow | undefined;
    const p0 = o ? getPayee(st, o.payee_id) : undefined;
    name = p0 ? p0.name : 'Unknown payee (from message)';
  }
  const [payee, warnings] = createPayee(st.ctx, st.user, name, raw, '(unverified, from message)', {
    source: 'sms',
  });
  st.proposals.push({
    atype: 'verify_payee',
    params: {
      payee_id: payee.id,
      payee_name: payee.name,
      account_masked: payee.account_masked,
      warnings,
    },
    source: 'user_instruction',
    plan: null,
  });
  return {
    proposed: true,
    payee_id: payee.id,
    account_masked: payee.account_masked,
    account_token: payee.account_token,
    warnings,
    cooling_off_hours: config.COOLING_OFF_HOURS,
  };
}

const DRAFTS: Record<string, string> = {
  confirm_account:
    'Dear Finance Office, I received a message saying your bank account for fee payments has changed. Before paying, please confirm the correct account through your official channel. Thank you. (DRAFT - not sent)',
  request_extension:
    'Dear Finance Office, I would like to ask about a short extension for my fee payment. (DRAFT - not sent)',
};

export function draftMessage(st: ToolState, a: Args): Out {
  const purpose = (a.purpose as string | undefined) ?? 'confirm_account';
  const body = DRAFTS[purpose];
  if (body === undefined)
    throw apiError(422, 'validation_error', `unknown draft purpose ${purpose}`);
  st.proposals.push({
    atype: 'draft_message',
    params: { to: (a.to as string | undefined) ?? 'university', purpose, body },
    source: 'user_instruction',
    plan: null,
  });
  return { drafted: true, sent: false, body };
}

export const TOOLS: Record<string, (st: ToolState, a: Args) => Out | Promise<Out>> = {
  get_obligation: getObligation,
  list_obligations_due: listObligationsDue,
  fx_quote: fxQuote,
  compute_costs: computeCostsTool,
  budget_summary: (st) => budgetSummary(st),
  propose_payment: proposePayment,
  propose_verify_payee: proposeVerifyPayee,
  draft_message: draftMessage,
};
