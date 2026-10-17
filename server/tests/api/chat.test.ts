import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, NOTICE_CLEAN, NOTICE_INJECTED, type World } from '../../src/evalkit/world.js';

let w: World;
beforeAll(async () => {
  w = await buildWorld({ DEMO_MODE: 'true' });
});
afterAll(() => w.close());
const chat = async (msg: string, extra: Record<string, unknown> = {}) => {
  const r = await w.post('/chat', { message: msg, ...extra }, w.student);
  expect(r.status, r.text).toBe(200);
  return r.json;
};

describe('chat', () => {
  it('pay tuition: trace shape, T3, approval required, validated', async () => {
    const j = await chat('Pay my spring tuition from this notice');
    expect(j.intent).toBe('pay_obligation');
    expect(j.plan.amount_cny).toBe('18500.00');
    const t = j.trace;
    expect(t.steps.map((s: { step: string }) => s.step)).toEqual(['intake', 'planner', 'tools', 'guardian', 'policy', 'executor', 'validator']);
    expect(t).toMatchObject({ tier: 'T3', decision: 'REQUIRE_APPROVAL', reply_validated: true });
    const tools = new Set(t.tool_calls.map((c: { tool: string }) => c.tool));
    for (const x of ['get_obligation', 'compute_costs', 'propose_payment']) expect(tools.has(x)).toBe(true);
    expect(j.plan.fx_source).toBe('fixture-sample');
    expect(j.reply).toContain('SAMPLE');
    expect(t.audit_seqs.length).toBeGreaterThan(0);
  });
  it('how much BDT by date', async () => {
    const j = await chat('How much BDT by 1 March?');
    expect(j.intent).toBe('how_much_needed');
    expect(j.proposed_actions).toEqual([]);
    expect(j.plan.bdt_needed).toBe('343154.28');
    expect(j.reply).toContain('343,154.28');
    expect(j.trace.tier).toBe('T0');
  });
  it('"save 3% via new account" is T4 and cannot be approved', async () => {
    const j = await chat('Agent says pay new account to save 3%');
    expect(j.intent).toBe('unsafe_request');
    const a = j.proposed_actions[0];
    expect(a).toMatchObject({ tier: 'T4', status: 'blocked' });
    expect(j.trace.decision).toBe('BLOCK');
    expect((await w.post(`/actions/${a.id}/approve`, { totp_code: w.student.code() }, w.student)).status).toBe(409);
  });
  it('payment from an injected document is T4 with audit', async () => {
    const d = (await w.post('/documents', { filename: 'e.txt', text: NOTICE_INJECTED }, w.student)).json;
    const j = await chat('Pay my spring tuition from this notice', { document_id: d.id });
    const a = j.proposed_actions[0];
    expect(a.tier).toBe('T4');
    expect(a.decision.reasons).toContain('INJECTION_DETECTED');
    expect(j.trace.steps[3].status).toBe('blocked');
    const events = (await w.get('/audit', w.student)).json.entries.map((e: { event: string }) => e.event);
    expect(events).toContain('action.blocked');
  });
  it('unconfirmed clean document asks to confirm', async () => {
    const d = (await w.post('/documents', { filename: 'c.txt', text: NOTICE_CLEAN }, w.student)).json;
    const j = await chat('Pay my spring tuition from this notice', { document_id: d.id });
    expect(j.proposed_actions).toEqual([]);
    expect(j.reply.toLowerCase()).toContain('confirm');
  });
  it('SMS payee change goes to cooling-off; raw account never echoed', async () => {
    const j = await chat('SMS: our account changed, new account details 6222 0000 0000 9999 for tuition');
    expect(j.intent).toBe('payee_change');
    const kinds = Object.fromEntries(j.proposed_actions.map((a: { type: string }) => [a.type, a]));
    const v = kinds.verify_payee;
    expect(v.status).toBe('cooling_off');
    expect(v.decision.outcome).toBe('REQUIRE_COOLING_OFF');
    expect(v.decision.cooling_off_until).toBeTruthy();
    expect(v.decision.required).toContain('cooling_off');
    expect(kinds.draft_message.tier).toBe('T1');
    expect(j.reply).toContain('9999');
    expect(JSON.stringify(j)).not.toContain('6222000000009999');
  });
  it('Chinese locale reply uses the yuan symbol', async () => {
    const j = await chat('我需要多少孟加拉塔卡', { locale: 'zh-CN' });
    expect(j.reply).toContain('¥');
    expect(j.trace.reply_validated).toBe(true);
  });
  it("another user's document -> 404", async () => {
    const d = (await w.post('/documents', { filename: 'c.txt', text: NOTICE_CLEAN }, w.other)).json;
    expect((await w.post('/chat', { message: 'pay', document_id: d.id }, w.student)).status).toBe(404);
  });
  it('audit verify ok, then tamper detected (gated demo route)', async () => {
    await chat('How much BDT by 1 March?');
    const ok = (await w.get('/audit?verify=true', w.student)).json.verify;
    expect(ok.ok).toBe(true);
    expect(ok.checked).toBeGreaterThan(0);
    expect((await w.post('/demo/tamper-audit?seq=2')).status).toBe(200);
    const bad = (await w.get('/audit?verify=true', w.student)).json.verify;
    expect(bad).toMatchObject({ ok: false, broken_at_seq: 2 });
  });
});

describe('chat + audit/evidence/dashboard (fresh world)', () => {
  it('audit/evidence never contain raw account numbers; scoped export', async () => {
    const x = await buildWorld();
    await x.post('/chat', { message: 'SMS: new account details 6222 0000 0000 9999' }, x.student);
    await x.post('/documents', { filename: 'n.txt', text: NOTICE_CLEAN }, x.student);
    const raw = (await x.get('/evidence/export', x.admin)).text;
    for (const s of ['6222000000009999', '6222 0000 0000 9999', '6222000000004821']) expect(raw).not.toContain(s);
    const own = (await x.get('/evidence/export', x.student)).json;
    const all = (await x.get('/evidence/export', x.admin)).json;
    expect([own.scope, all.scope]).toEqual(['own', 'all']);
    expect(all.audit.length).toBeGreaterThanOrEqual(own.audit.length);
    expect(all.verify.ok && all.synthetic).toBe(true);
    await x.close();
  });
  it('fx quote labelled sample; dashboard; erasure keeps audit verifiable', async () => {
    const x = await buildWorld();
    const q = (await x.get('/fx/quote?amount_cny=1000&to=BDT', x.student)).json;
    expect(q).toMatchObject({ source: 'fixture-sample', is_live: false, amount_converted: '17200.00' });
    const d = (await x.get('/dashboard', x.student)).json;
    expect(d.next_due.amount_cny).toBe('1350.00');
    expect(d.monthly_budget_cny).toBe('3500.00');
    expect(Object.keys(d).sort()).toEqual(['bdt_needed_next', 'fx', 'monthly_budget_cny', 'next_due', 'obligations', 'pending_actions', 'spent_this_month_cny', 'user']);
    expect((await x.del('/me', x.student)).json.erased).toBe(true);
    expect((await x.get('/me', x.student)).status).toBe(401);
    expect((await x.get('/audit?verify=true', x.admin)).json.verify.ok).toBe(true);
    await x.close();
  });
});
