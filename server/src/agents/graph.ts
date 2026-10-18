/** Explicit state machine (no LangGraph): intake -> planner -> tools -> guardian -> policy -> executor | await_approval -> validator.
 * Every step is traced and audited. Port of backend/app/agents/graph.py. */
import { randomBytes } from 'node:crypto';
import type { AppContext } from '../app.js';
import { actionOut, evaluate, propose } from '../actionsService.js';
import { appendAudit } from '../db/auditStore.js';
import type { ActionRow, DocumentRow, UserRow } from '../db/schema.js';
import { Outcome } from '../domain/policy.js';
import * as tokenize from '../domain/tokenize.js';
import { apiError } from '../deps.js';
import { newId } from '../ids.js';
import { nowTs } from '../domain/audit.js';
import { execute } from './executor.js';
import * as guardian from './guardian.js';
import { getAdapter, type LLMAdapter } from './llmAdapters.js';
import * as planner from './planner.js';
import * as replies from './replies.js';
import { newToolState, TOOLS, type Args, type Out, type ToolState } from './tools.js';
import { validateReply } from './replyValidator.js';

export const SAFE_FALLBACK = {
  en: 'I could not produce a verified answer. Please use the dashboard figures or rephrase your request.',
  'zh-CN': '我无法给出经过校验的回答。请参考仪表盘中的数据，或换种方式提问。',
};

export interface ChatReq {
  message: string;
  document_id?: string | null;
  locale: 'en' | 'zh-CN';
}

type Step = { step: string; status: string; duration_ms: number; detail: Record<string, unknown> };
const RANK: Record<string, number> = {
  BLOCK: 3,
  REQUIRE_COOLING_OFF: 2,
  REQUIRE_APPROVAL: 1,
  ALLOW: 0,
};

export const todayIso = (ctx: AppContext): string =>
  ctx.config.FIXED_TODAY || new Date().toISOString().slice(0, 10);

export async function runChat(
  ctx: AppContext,
  user: UserRow,
  req: ChatReq,
  adapterIn?: LLMAdapter
) {
  const { db, config } = ctx;
  const adapter =
    adapterIn ?? getAdapter(config.LLM_PROVIDER, config.GEMINI_API_KEY, config.GROQ_API_KEY);
  const steps: Step[] = [];
  const toolTrace: { tool: string; args: Args; output: Out; ok: boolean }[] = [];
  const auditSeqs: number[] = [];
  const locale = req.locale;
  const audit = (event: string, payload: Record<string, unknown>): void => {
    auditSeqs.push(appendAudit(db, user.id, event, payload).seq);
  };
  const ms = (t0: number): number => Math.floor(performance.now() - t0);

  // ---------------- intake ----------------
  let t0 = performance.now();
  const [masked] = tokenize.tokenizeText(req.message);
  const rawTokens: Record<string, string> = {};
  // raw numbers are re-derived server-side only (never sent to the LLM)
  for (const m of req.message.matchAll(/(?<![\p{L}\p{N}_])(?:\d[ -]?){12,19}(?![\p{L}\p{N}_])/gu)) {
    rawTokens[tokenize.accountToken(m[0])] = tokenize.normalizeAccount(m[0]);
  }
  const msgVerdict = guardian.checkMessage(req.message);
  let doc: DocumentRow | undefined;
  if (req.document_id) {
    doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.document_id) as
      DocumentRow | undefined;
    if (!doc || doc.owner_id !== user.id) throw apiError(404, 'NOT_FOUND', 'Document not found');
  }
  const today = todayIso(ctx);
  const pctx = {
    today,
    document_id: doc?.id ?? null,
    document_status: doc?.status ?? null,
    locale,
  };
  audit('chat.received', {
    message_len: req.message.length,
    document_id: req.document_id ?? null,
    message_guardian: msgVerdict.verdict,
  }); // no raw text in audit
  steps.push({
    step: 'intake',
    status: 'ok',
    duration_ms: ms(t0),
    detail: {
      tokenised_accounts: Object.keys(rawTokens).length,
      document_id: req.document_id ?? null,
      document_status: doc?.status ?? null,
      untrusted_wrapped: Boolean(doc),
      message_guardian: msgVerdict.verdict,
    },
  });

  // ---------------- planner ----------------
  t0 = performance.now();
  let planRejected: string | null = null;
  let out: planner.PlannerOutput;
  try {
    out = planner.validatePlan(await adapter.plan(masked, pctx));
  } catch (e) {
    if (!(e instanceof planner.PlanRejected)) throw e;
    planRejected = e.reason;
    out = planner.validatePlan(await getAdapter('scripted').plan(masked, pctx));
  }
  if (msgVerdict.verdict === 'blocked' && out.intent !== 'unsafe_request') {
    out = {
      intent: 'unsafe_request',
      tool_calls: [{ tool: 'propose_payment', args: { origin: 'message', payee_account: null } }],
    };
  }
  steps.push({
    step: 'planner',
    status: planRejected ? 'rejected' : 'ok',
    duration_ms: ms(t0),
    detail: {
      intent: out.intent,
      tool_calls: out.tool_calls.map((t) => t.tool),
      adapter: adapter.name,
      rejected_reason: planRejected,
    },
  });

  // ---------------- tools ----------------
  t0 = performance.now();
  const state: ToolState = newToolState(ctx, user, today);
  state.tokenMap = rawTokens;
  for (const tc of out.tool_calls) {
    const args: Args = { ...tc.args };
    const missing = Object.entries(args)
      .filter(
        ([, v]) => typeof v === 'string' && v.startsWith('$') && resolveRef(v, state) === null
      )
      .map(([k]) => k);
    if (missing.length) {
      toolTrace.push({
        tool: tc.tool,
        args,
        output: { skipped: 'dependency missing', args: missing },
        ok: false,
      });
      continue;
    }
    let result: Out;
    let ok: boolean;
    try {
      const fn = TOOLS[tc.tool];
      if (!fn) throw new Error('UnknownTool');
      result = await fn(state, args);
      ok = true;
    } catch (e) {
      result = { error: e instanceof Error ? e.constructor.name : 'Error' }; // tool errors never crash the turn
      ok = false;
    }
    state.outputs[tc.tool] = result;
    toolTrace.push({ tool: tc.tool, args, output: result, ok });
  }
  steps.push({
    step: 'tools',
    status: 'ok',
    duration_ms: ms(t0),
    detail: { count: toolTrace.length },
  });

  // ---------------- guardian ----------------
  t0 = performance.now();
  let verdict = msgVerdict;
  let docBlocked = false;
  if (doc) {
    const dv = JSON.parse(doc.guardian_json) as guardian.GuardianVerdict;
    docBlocked = dv.verdict === 'blocked';
    verdict = guardian.merge(verdict, dv.flags);
  }
  const gblocked = verdict.verdict === 'blocked' || docBlocked;
  const codes = verdict.flags.map((f) => f.code);
  steps.push({
    step: 'guardian',
    status: gblocked ? 'blocked' : 'ok',
    duration_ms: ms(t0),
    detail: { verdict: verdict.verdict, score: verdict.score, flags: codes },
  });

  // ---------------- policy (server-side authority) ----------------
  t0 = performance.now();
  const rows: ActionRow[] = [];
  let planId: string | null = null;
  if (state.lastPlan && state.proposals.some((p) => p.atype === 'payment'))
    planId = persistPlan(ctx, user, state);
  for (const prop of state.proposals) {
    const params = { ...prop.params };
    if (gblocked && (prop.atype === 'payment' || prop.atype === 'verify_payee'))
      params._guardian_blocked = true;
    rows.push(
      propose(
        ctx,
        user,
        prop.atype,
        params,
        prop.source,
        prop.atype === 'payment' ? planId : null
      )[0]
    );
  }
  const top = topDecision(rows);
  steps.push({
    step: 'policy',
    status: top && top.outcome === 'BLOCK' ? 'blocked' : 'ok',
    duration_ms: ms(t0),
    detail: {
      tier: top ? top.tier : 'T0',
      outcome: top ? top.outcome : 'ALLOW',
      reasons: top ? top.reasons : ['READ_ONLY'],
    },
  });

  // ---------------- executor | await_approval ----------------
  t0 = performance.now();
  let execDetail: Record<string, unknown> = {};
  let execStatus = 'skipped';
  for (const row of rows) {
    const d = evaluate(ctx, row);
    if (d.outcome === Outcome.ALLOW && row.type === 'draft_message') {
      db.prepare('UPDATE actions SET result_json = ? WHERE id = ?').run(
        JSON.stringify(execute(ctx, row, d)),
        row.id
      );
      execStatus = 'ok';
      execDetail[row.id] = 'drafted (not sent)';
    } else if (d.outcome === Outcome.BLOCK) execDetail[row.id] = 'blocked by policy';
    else execDetail[row.id] = 'awaiting approval';
  }
  if (!rows.length) execDetail = { note: 'read-only turn' };
  steps.push({ step: 'executor', status: execStatus, duration_ms: ms(t0), detail: execDetail });

  const fresh = rows.map(
    (r) => db.prepare('SELECT * FROM actions WHERE id = ?').get(r.id) as ActionRow
  );
  const actionsOut = fresh.map((r) => actionOut(ctx, r));
  for (const r of fresh)
    auditSeqs.push(
      appendAudit(db, user.id, 'chat.action', { action_id: r.id, tier: r.tier, status: r.status })
        .seq
    );

  // ---------------- reply + validator ----------------
  t0 = performance.now();
  let reply = replies.compose(out.intent, state.outputs, actionsOut, locale, codes);
  const vr = validateReply(reply, [...toolTrace.map((t) => t.output), ...actionsOut], req.message);
  if (!vr.ok) {
    audit('reply.rejected', { unsupported_numbers: vr.unsupported });
    reply = SAFE_FALLBACK[locale === 'zh-CN' ? 'zh-CN' : 'en'];
  }
  steps.push({
    step: 'validator',
    status: vr.ok ? 'ok' : 'rejected',
    duration_ms: ms(t0),
    detail: { unsupported_numbers: vr.unsupported },
  });
  audit('chat.reply', { intent: out.intent, tier: top ? top.tier : 'T0', validated: vr.ok });

  return {
    reply,
    intent: out.intent,
    plan: state.lastPlan ? planOut(state) : null,
    proposed_actions: actionsOut,
    trace: {
      trace_id: 'trc_' + randomBytes(6).toString('hex'),
      llm_mode: adapter.mode,
      steps,
      tool_calls: toolTrace,
      tier: top ? top.tier : 'T0',
      decision: top ? top.outcome : 'ALLOW',
      reply_validated: vr.ok,
      audit_seqs: auditSeqs,
    },
  };
}

function resolveRef(v: string, st: ToolState): string | null {
  const rest = v.slice(1);
  const i = rest.indexOf('.');
  const val = (st.outputs[i < 0 ? rest : rest.slice(0, i)] ?? {})[i < 0 ? '' : rest.slice(i + 1)];
  return val === undefined || val === null ? null : String(val);
}

interface DecisionJson {
  outcome: string;
  tier: string;
  reasons: string[];
}
function topDecision(rows: ActionRow[]): DecisionJson | null {
  let best: DecisionJson | null = null;
  for (const r of rows) {
    const d = JSON.parse(r.decision_json) as DecisionJson;
    if (best === null || (RANK[d.outcome] ?? 0) > (RANK[best.outcome] ?? 0)) best = d;
  }
  return best;
}

function persistPlan(ctx: AppContext, user: UserRow, st: ToolState): string {
  const p = (st.lastPlan ?? {}) as Record<string, unknown>;
  const obl = st.outputs.get_obligation ?? {};
  const id = newId('plan');
  ctx.db
    .prepare(
      'INSERT INTO plans (id,obligation_id,owner_id,channel,bdt_needed,fees,fx_rate,plan_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(
      id,
      (obl.obligation_id as string | undefined) ?? null,
      user.id,
      String(p.channel),
      String(p.bdt_needed),
      String(p.total_fees_cny),
      String(p.fx_rate),
      JSON.stringify(p),
      nowTs()
    );
  return id;
}

function planOut(st: ToolState) {
  const p = (st.lastPlan ?? {}) as Record<string, unknown>;
  const due = (st.outputs.get_obligation ?? {}).due_date as string | undefined;
  return {
    channel: p.channel,
    amount_cny: p.amount_cny,
    fx_rate: p.fx_rate,
    fx_source: p.fx_source,
    fees: p.fees,
    total_fees_cny: p.total_fees_cny,
    fee_pct: p.fee_pct,
    bdt_needed: p.bdt_needed,
    due_date: due ?? null,
    notes: (p.notes as string[] | undefined) ?? [],
  };
}
