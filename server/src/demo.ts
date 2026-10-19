/** `npm run demo`: scripted end-to-end run on a fresh in-memory DB seeded with SYNTHETIC personas.
 * Writes evidence/sandbox_logs.jsonl, audit_export.json and demo_summary.json. Offline, no keys. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/connection.js';
import * as security from './security.js';
import {
  IdempotencyMismatch,
  getAccountByOwner,
  openAccount,
  transfer,
  type TxnRow,
} from './sandboxBank/ledger.js';
import { loadPersonas, seedAll, type Persona } from './seed.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const EVIDENCE = resolve(dirname(fileURLToPath(import.meta.url)), '../../evidence');
const steps: Record<string, unknown>[] = [];
const say = (step: string, kw: Record<string, unknown> = {}): void => {
  steps.push({ step, ...kw });
  console.log(
    `[demo] ${step}: ${Object.entries(kw)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ')}`
  );
};

export async function runDemo(
  write = true
): Promise<{ steps: Record<string, unknown>[]; ok: boolean; headHash: string }> {
  steps.length = 0;
  const config = loadConfig({
    RATE_LIMIT_PER_MINUTE: '100000',
    DEMO_MODE: 'true',
    FIXED_TODAY: '2026-10-17',
  });
  const app = await buildApp({ config, db: openDb(':memory:') });
  const call = async (
    method: 'GET' | 'POST',
    url: string,
    h?: Record<string, string>,
    payload?: unknown
  ): Promise<{ status: number; json: any }> => {
    const r = await app.inject({ method, url, headers: h, payload: payload as object });
    return { status: r.statusCode, json: r.body ? r.json() : null };
  };

  const rep = await seedAll(app.ctx);
  say('seed', {
    users: rep.users,
    obligations: rep.obligations,
    audit_head_hash: rep.auditHead.head_hash,
    synthetic: true,
    fx: 'SAMPLE fixture (not live)',
  });

  class Actor {
    token = '';
    h: Record<string, string> = {};
    id = '';
    lastStep = Math.floor(Date.now() / 30000) - 2;
    constructor(readonly p: Persona) {}
    async login(): Promise<this> {
      const r = await call('POST', '/auth/login', undefined, {
        email: this.p.email,
        password: this.p.password,
      });
      if (r.status !== 200) throw new Error(`login failed for ${this.p.email}`);
      this.token = r.json.access_token;
      this.h = { authorization: `Bearer ${this.token}` };
      this.id = r.json.user.id;
      return this;
    }
    /** TOTP code that respects replay protection (strictly increasing steps). */
    async code(): Promise<string> {
      const now = Math.floor(Date.now() / 30000);
      const step = Math.max(this.lastStep + 1, now - 1);
      if (step > now + 1) {
        await new Promise((r) => setTimeout(r, 30000));
        return this.code();
      }
      this.lastStep = step;
      return security.totpAt(this.p.totp_secret as string, step * 30);
    }
  }

  const people = loadPersonas(config.dataDir);
  const byEmail = new Map(people.map((p) => [p.email, p]));
  const students = people.filter((p) => p.role === 'student');
  const s0 = students[0] as Persona;
  const aisha = await new Actor(s0).login();
  const father = await new Actor(byEmail.get(s0.approver_email as string) as Persona).login();
  const admin = await new Actor(people.find((p) => p.role === 'admin') as Persona).login();
  const notices = join(config.dataDir, 'fee_notices');

  // 1. confirmed tuition notice -> T3 -> student TOTP + family approver -> sandbox settlement
  const tuition = (s0.obligations ?? []).find(
    (o: any) => o.amount_cny && Number(o.amount_cny) > 2000
  ) as any;
  const text = readFileSync(join(notices, tuition.notice_file), 'utf-8');
  const d = (await call('POST', '/documents', aisha.h, { filename: tuition.notice_file, text }))
    .json;
  say('upload_notice', {
    file: tuition.notice_file,
    status: d.status,
    guardian: d.guardian.verdict,
    amount: d.parsed.amount_cny,
  });
  const conf = (
    await call('POST', `/documents/${d.id}/confirm`, aisha.h, {
      amount_cny: d.parsed.amount_cny,
      due_date: d.parsed.due_date,
      payee_name: d.parsed.payee_name || tuition.payee_name,
    })
  ).json;
  say('confirm_fields', {
    blocked: conf.blocked,
    obligation: conf.obligation ? conf.obligation.id : null,
    payee_verified: conf.obligation?.payee_id ? true : null,
  });
  const chat = (
    await call('POST', '/chat', aisha.h, {
      message: 'Pay my spring tuition from this notice',
      document_id: d.id,
    })
  ).json;
  const act = chat.proposed_actions[0];
  say('chat_pay', {
    intent: chat.intent,
    tier: act.tier,
    status: act.status,
    required: act.decision.required,
    reply_validated: chat.trace.reply_validated,
  });
  const r1 = (
    await call('POST', `/actions/${act.id}/approve`, aisha.h, { totp_code: await aisha.code() })
  ).json;
  say('student_totp', { status: r1.status, still_required: r1.decision.required });
  const r2 = (
    await call('POST', `/actions/${act.id}/approve`, father.h, { totp_code: await father.code() })
  ).json;
  say('family_approver_totp', {
    status: r2.status,
    bank_txn: r2.result?.bank_txn_id,
    state: r2.result?.state,
  });

  // 2. demo moment 1: injected notice -> red T4
  const inj = readdirSync(notices)
    .filter((f) => /^atk_injection_en.*\.txt$/.test(f))
    .sort()[0] as string;
  const di = (
    await call('POST', '/documents', aisha.h, {
      filename: inj,
      text: readFileSync(join(notices, inj), 'utf-8'),
    })
  ).json;
  const ci = (
    await call('POST', '/chat', aisha.h, {
      message: 'Pay my spring tuition from this notice',
      document_id: di.id,
    })
  ).json;
  say('injected_notice', {
    file: inj,
    doc_status: di.status,
    flags: di.guardian.flags.map((f: any) => f.code),
    tier: ci.proposed_actions[0].tier,
    status: ci.proposed_actions[0].status,
  });

  // 3. demo moment 2: SMS "payee changed" -> cooling-off
  const msgs = JSON.parse(
    readFileSync(join(config.dataDir, 'messages', 'messages.json'), 'utf-8')
  ) as any[];
  const sms = msgs.find((m) => m.label === 'payee_change');
  const cs = (await call('POST', '/chat', aisha.h, { message: sms.text })).json;
  const ver = cs.proposed_actions.find((a: any) => a.type === 'verify_payee');
  const rr = ver
    ? await call('POST', `/actions/${ver.id}/approve`, aisha.h, { totp_code: await aisha.code() })
    : null;
  say('sms_payee_change', {
    intent: cs.intent,
    tier: ver?.tier ?? null,
    status: ver?.status ?? null,
    approve_attempt: rr ? [rr.status, rr.json.error.code] : null,
  });

  // 4. T2 payment (small obligation)
  const small = (s0.obligations ?? []).find((o: any) => Number(o.amount_cny) <= 2000);
  if (small) {
    const c2 = (await call('POST', '/chat', aisha.h, { message: `Pay my ${small.title}` })).json;
    const a2 = c2.proposed_actions[0];
    if (a2) {
      const r = (
        await call('POST', `/actions/${a2.id}/approve`, aisha.h, { totp_code: await aisha.code() })
      ).json;
      say('t2_payment', {
        tier: a2.tier,
        required: a2.decision.required,
        status: r.status,
        amount: a2.params.amount_cny,
      });
    }
  }

  // 5. sandbox determinism showcase (clearly labelled) -> sandbox_logs
  const db = app.ctx.db;
  const src = getAccountByOwner(db, aisha.id)?.account_number ?? '';
  const showcase: [string, string, string, string][] = [
    ['idem-demo-1', '6222000000000013', '100.00', 'dest ends 0013 -> ACCOUNT_CLOSED'],
    ['idem-demo-2', '6222000000008888', '100.99', 'cents .99 -> RISK_HOLD'],
    ['idem-demo-3', '6222000000008888', '9999999.00', 'over per-txn limit -> LIMIT_EXCEEDED'],
    ['idem-demo-4', '6222000000008888', '50.00', 'ok -> settled'],
    ['idem-demo-4', '6222000000008888', '50.00', 'same idempotency key -> replay, no double spend'],
  ];
  openAccount(db, '6222000000008888', 'Sandbox demo recipient (SYNTHETIC)', '0');
  for (const [key, to, amt, why] of showcase) {
    const res = transfer(db, key, src, to, amt, `showcase-${key}`);
    say('sandbox_showcase', {
      key,
      why,
      state: res.state,
      failure: res.failure_code,
      replay: res.idempotent_replay,
    });
  }
  try {
    transfer(db, 'idem-demo-4', src, '6222000000008888', '75.00', 'showcase-idem-demo-4');
  } catch (e) {
    if (!(e instanceof IdempotencyMismatch)) throw e;
    say('sandbox_showcase', {
      key: 'idem-demo-4',
      why: 'same key, different amount -> rejected',
      state: 'rejected',
      failure: e.message,
    });
  }

  // 6. audit verify, export, tamper
  const v = (await call('GET', '/audit?verify=true', aisha.h)).json.verify;
  say('audit_verify', v);
  const exp = (await call('GET', '/evidence/export', admin.h)).json;
  if (write) mkdirSync(EVIDENCE, { recursive: true });
  if (write) writeFileSync(join(EVIDENCE, 'audit_export.json'), JSON.stringify(exp, null, 2));
  await call('POST', '/demo/tamper-audit?seq=3');
  const v2 = (await call('GET', '/audit?verify=true', aisha.h)).json.verify;
  say('audit_after_tamper', v2);

  const txns = db.prepare('SELECT * FROM sbx_txns ORDER BY created_at, rowid').all() as TxnRow[];
  const lines = txns.map((t) => ({
    ts: t.created_at,
    sandbox: true,
    synthetic: true,
    txn_id: t.id,
    idempotency_key: t.idempotency_key,
    from: '****' + t.from_account.slice(-4),
    to: '****' + t.to_account_number.slice(-4),
    amount_cny: t.amount_cny,
    state: t.state,
    failure_code: t.failure_code,
    reference: t.reference,
  }));
  if (write)
    writeFileSync(
      join(EVIDENCE, 'sandbox_logs.jsonl'),
      lines.map((x) => JSON.stringify(x)).join('\n') + '\n'
    );
  if (write)
    writeFileSync(
      join(EVIDENCE, 'demo_summary.json'),
      JSON.stringify(
        { generated_at: new Date().toISOString(), offline: true, synthetic: true, steps },
        null,
        2
      )
    );
  const headHash = (exp.audit[exp.audit.length - 1] as { hash: string }).hash;
  if (write)
    console.log(
      `[demo] wrote ${EVIDENCE}/sandbox_logs.jsonl (${lines.length} txns), audit_export.json (${exp.audit.length} rows), demo_summary.json`
    );
  console.log(`[demo] audit head_hash (pre-tamper): ${headHash}`);
  await app.close();
  return { steps: steps.map((x) => ({ ...x })), ok: v.ok && !v2.ok, headHash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runDemo(true);
  process.exit(r.ok ? 0 : 1);
}
