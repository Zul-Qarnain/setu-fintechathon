import { describe, expect, it } from 'vitest';
import { propose } from '../../src/actionsService.js';
import type { UserRow } from '../../src/db/schema.js';
import { tsFromMs } from '../../src/domain/audit.js';
import { buildWorld, payAction, type Persona, type World } from '../../src/evalkit/world.js';

const approve = (w: World, who: Persona, id: string, code?: string) => w.post(`/actions/${id}/approve`, { totp_code: code ?? who.code() }, who);
const user = (w: World, id: string) => w.app.ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;

describe('actions lifecycle', () => {
  it('T3 needs student TOTP then family approver, then executes in the sandbox', async () => {
    const w = await buildWorld();
    const a = await payAction(w);
    expect(a).toMatchObject({ tier: 'T3', status: 'awaiting_approval' });
    expect(a.decision.required).toEqual(['totp', 'family_approver']);
    const r1 = await approve(w, w.student, a.id);
    expect(r1.status).toBe(200);
    expect(r1.json.status).toBe('awaiting_approval');
    expect(r1.json.decision.required).toEqual(['family_approver']);
    const r2 = await approve(w, w.approver, a.id);
    expect(r2.status).toBe(200);
    expect(r2.json).toMatchObject({ status: 'executed' });
    expect(r2.json.result).toMatchObject({ state: 'settled', sandbox: true });
    expect(r2.json.approvals.map((x: { kind: string }) => x.kind)).toEqual(['totp', 'family_approver']);
    // sandbox money moved exactly once; obligation paid
    expect((await w.get('/sandbox/account', w.student)).json.account.balance_cny).toBe('181500.00');
    const obs = (await w.get('/obligations', w.student)).json as { amount_cny: string; status: string }[];
    expect(obs.filter((o) => o.amount_cny === '18500.00').map((o) => o.status)).toEqual(['paid']);
    // replay after execution
    const r3 = await approve(w, w.approver, a.id);
    expect(r3.status).toBe(409);
    expect(r3.json.error.code).toBe('INVALID_STATE');
    await w.close();
  });
  it('T2 within cap needs only student TOTP', async () => {
    const w = await buildWorld();
    const a = (await w.post('/chat', { message: 'Pay my dorm fee' }, w.student)).json.proposed_actions[0];
    expect(a.params.amount_cny).toBe('1350.00');
    expect(a.tier).toBe('T2');
    expect(a.decision.required).toEqual(['totp']);
    expect((await approve(w, w.student, a.id)).json.status).toBe('executed');
    await w.close();
  });
  it('wrong TOTP rejected and audited', async () => {
    const w = await buildWorld();
    const a = await payAction(w);
    const r = await approve(w, w.student, a.id, '000000');
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('TOTP_INVALID');
    expect((await w.get('/audit', w.student)).json.entries.map((e: { event: string }) => e.event)).toContain('totp.failed');
    await w.close();
  });
  it('same user cannot approve twice; admin cannot approve', async () => {
    const w = await buildWorld();
    const a = await payAction(w);
    await approve(w, w.student, a.id);
    expect([403, 409]).toContain((await approve(w, w.student, a.id)).status);
    expect((await approve(w, w.admin, a.id)).status).toBe(403);
    await w.close();
  });
  it('reject, and scoping per user/approver', async () => {
    const w = await buildWorld();
    const a = await payAction(w);
    expect((await w.get('/actions', w.other)).json).toEqual([]);
    expect((await w.get(`/actions/${a.id}`, w.other)).status).toBe(404);
    expect(((await w.get('/actions', w.approver)).json as { id: string }[]).map((x) => x.id)).toEqual([a.id]);
    const r = await w.post(`/actions/${a.id}/reject`, { reason: 'not me' }, w.approver);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('rejected');
    expect((await approve(w, w.student, a.id)).status).toBe(409);
    await w.close();
  });
  it('cooling-off blocks approval until elapsed', async () => {
    const w = await buildWorld();
    const p = (await w.post('/payees', { name: 'Landlord Li (SYNTHETIC)', account_number: '6222000000005555', bank: 'B' }, w.student)).json;
    await w.post(`/payees/${p.id}/verify`, {}, w.approver);
    const [row, d] = propose(w.app.ctx, user(w, w.student.id), 'payment', { amount_cny: '500.00', payee_id: p.id }, 'user_instruction');
    expect(d.outcome).toBe('REQUIRE_COOLING_OFF');
    expect(d.reasons).toContain('NEW_PAYEE');
    const resp = await approve(w, w.student, row.id);
    expect(resp.status).toBe(409);
    expect(resp.json.error.code).toBe('COOLING_OFF_ACTIVE');
    w.app.ctx.db.prepare('UPDATE payees SET cooling_off_until = ? WHERE id = ?').run(tsFromMs(Date.now() - 60_000), p.id);
    expect((await approve(w, w.student, row.id)).status).toBe(200);
    expect(['executed', 'failed']).toContain((await w.get(`/actions/${row.id}`, w.student)).json.status);
    await w.close();
  });
  it('sandbox failure marks the action failed (dest ...0013 -> ACCOUNT_CLOSED)', async () => {
    const w = await buildWorld();
    const p = (await w.post('/payees', { name: 'Closed Co', account_number: '6222000000000013', bank: 'B' }, w.student)).json;
    w.app.ctx.db.prepare('UPDATE payees SET verified_at = ?, cooling_off_until = NULL WHERE id = ?').run(tsFromMs(Date.now()), p.id);
    const [row] = propose(w.app.ctx, user(w, w.student.id), 'payment', { amount_cny: '100.00', payee_id: p.id }, 'user_instruction');
    const j = (await approve(w, w.student, row.id)).json;
    expect(j.status).toBe('failed');
    expect(j.result.failure_code).toBe('ACCOUNT_CLOSED');
    await w.close();
  });
});
