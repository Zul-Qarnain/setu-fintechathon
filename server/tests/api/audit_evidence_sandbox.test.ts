import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, type World } from '../../src/evalkit/world.js';

let w: World;
beforeAll(async () => {
  w = await buildWorld();
  await w.post(
    '/payees',
    { name: 'Landlord', account_number: '6222000000005555', bank: 'B' },
    w.student
  );
  await w.post('/auth/login', { email: w.student.email, password: 'demo-password-123' });
});
afterAll(() => w.close());

describe('audit / evidence / sandbox', () => {
  it('audit lists own events, verify ok, entry shape', async () => {
    const r = await w.get('/audit?verify=true', w.student);
    expect(r.status).toBe(200);
    expect(r.json.verify).toMatchObject({ ok: true, broken_at_seq: null, reason: null });
    const events = r.json.entries.map((e: { event: string }) => e.event);
    expect(events).toContain('payee.created');
    expect(Object.keys(r.json.entries[0]).sort()).toEqual([
      'actor',
      'event',
      'hash',
      'payload',
      'payload_hash',
      'prev_hash',
      'seq',
      'ts',
    ]);
    expect(r.json.entries.map((e: { seq: number }) => e.seq)).toEqual(
      [...r.json.entries.map((e: { seq: number }) => e.seq)].sort((a, b) => a - b)
    );
    expect((await w.get('/audit', w.student)).json.verify).toBeNull();
  });
  it('another student does not see my payee events', async () => {
    const r = await w.get('/audit', w.other);
    expect(r.json.entries.filter((e: { event: string }) => e.event === 'payee.created')).toEqual(
      []
    );
  });
  it('evidence export is scoped and never contains raw account numbers', async () => {
    const own = (await w.get('/evidence/export', w.student)).json;
    const all = await w.get('/evidence/export', w.admin);
    expect(own.scope).toBe('own');
    expect(all.json.scope).toBe('all');
    expect(all.json.audit.length).toBeGreaterThanOrEqual(own.audit.length);
    expect(own.verify.ok).toBe(true);
    expect(own.head_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(all.text).not.toContain('6222000000005555');
  });
  it('sandbox account is masked', async () => {
    const r = await w.get('/sandbox/account', w.student);
    expect(r.json).toEqual({
      account: { account_masked: '****0001', holder: 'Aisha', balance_cny: '200000.00' },
      synthetic: true,
      sandbox: true,
    });
    expect((await w.get('/sandbox/transactions', w.student)).json).toEqual({
      transactions: [],
      synthetic: true,
    });
    expect((await w.get('/sandbox/account', w.admin)).json).toEqual({
      account: null,
      synthetic: true,
    });
  });
});
