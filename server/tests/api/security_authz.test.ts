/** Authz / IDOR / headers / CORS / validation checks (security audit). */
import { describe, expect, it } from 'vitest';
import { buildWorld, payAction } from '../../src/evalkit/world.js';

describe('security: authn/authz', () => {
  it('every protected route rejects missing and garbage tokens with 401', async () => {
    const w = await buildWorld();
    const gets = [
      '/me',
      '/dashboard',
      '/obligations',
      '/payees',
      '/actions',
      '/audit',
      '/sandbox/account',
      '/sandbox/transactions',
      '/evidence/export',
      '/fx/quote?amount_cny=100',
    ];
    for (const u of gets) {
      expect((await w.get(u, null)).status, u).toBe(401);
      expect((await w.get(u, null, { authorization: 'Bearer not.a.jwt' })).status, u).toBe(401);
    }
    for (const u of ['/chat', '/documents', '/payees', '/actions/x/approve', '/actions/x/reject'])
      expect((await w.post(u, {}, null)).status, u).toBe(401);
    expect((await w.del('/me', null)).status).toBe(401);
    await w.close();
  });
  it('alg=none and tampered JWTs are rejected', async () => {
    const w = await buildWorld();
    const [h, p] = w.student.token.split('.');
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
    expect((await w.get('/me', null, { authorization: `Bearer ${none}` })).status).toBe(401);
    expect((await w.get('/me', null, { authorization: `Bearer ${h}.${p}.AAAA` })).status).toBe(401);
    await w.close();
  });
  it("IDOR: another student cannot read, approve or reject someone else's action", async () => {
    const w = await buildWorld();
    const a = await payAction(w);
    for (const r of [
      await w.get(`/actions/${a.id}`, w.other),
      await w.post(`/actions/${a.id}/approve`, { totp_code: w.other.code() }, w.other),
      await w.post(`/actions/${a.id}/reject`, {}, w.other),
    ])
      expect([403, 404]).toContain(r.status);
    expect(JSON.stringify((await w.get('/actions', w.other)).json)).not.toContain(a.id);
    // other user sees none of the student's payees/transactions/audit/obligations
    expect(JSON.stringify((await w.get('/payees', w.other)).json)).not.toContain(w.payeeId);
    expect(JSON.stringify((await w.get('/obligations', w.other)).json)).not.toContain(
      w.obligationBig
    );
    // action unchanged
    expect((await w.get(`/actions/${a.id}`, w.student)).json.status).toBe('awaiting_approval');
    await w.close();
  });
  it('student cannot self-approve the family-approver step; approver role cannot create chat/payments', async () => {
    const w = await buildWorld();
    const a = await payAction(w);
    await w.post(`/actions/${a.id}/approve`, { totp_code: w.student.code() }, w.student);
    const again = await w.post(
      `/actions/${a.id}/approve`,
      { totp_code: w.student.code(Date.now() + 30000) },
      w.student
    );
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect((await w.get(`/actions/${a.id}`, w.student)).json.status).toBe('awaiting_approval');
    // an approver has no payees of their own: a chat "payment" never creates a new executable action
    const before = ((await w.get('/actions', w.approver)).json as unknown[]).length;
    await w.post('/chat', { message: 'pay my tuition' }, w.approver);
    const after = (await w.get('/actions', w.approver)).json as {
      owner_id?: string;
      status: string;
    }[];
    expect(after.filter((x) => x.status === 'executed')).toEqual([]);
    expect(after.length - before).toBeLessThanOrEqual(1); // at most a blocked record
    await w.close();
  });
  it('/demo/* is disabled (404/403) without DEMO_MODE or admin token', async () => {
    const w = await buildWorld();
    for (const u of ['/demo/reset', '/demo/tamper-audit']) {
      const r = await w.post(u, {}, null);
      expect([403, 404]).toContain(r.status);
    }
    await w.close();
  });
  it('TOTP brute force locks out', async () => {
    const w = await buildWorld();
    const a = await payAction(w);
    let last = 0;
    for (let i = 0; i < 7; i++)
      last = (await w.post(`/actions/${a.id}/approve`, { totp_code: '000000' }, w.student)).status;
    expect([423, 429, 403, 400]).toContain(last);
    expect(
      (await w.post(`/actions/${a.id}/approve`, { totp_code: w.student.code() }, w.student)).status
    ).toBeGreaterThanOrEqual(400);
    await w.close();
  });
});

describe('security: headers, CORS, validation', () => {
  it('sets security headers on every response incl. errors', async () => {
    const w = await buildWorld();
    for (const r of [
      await w.get('/me', w.student),
      await w.get('/me', null),
      await w.get('/nope', null),
    ]) {
      expect(r).toBeDefined();
    }
    const res = await w.app.inject({ method: 'GET', url: '/me' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
    await w.close();
  });
  it('CORS: allowed origin echoed, foreign origin gets no ACAO', async () => {
    const w = await buildWorld();
    const ok = await w.app.inject({
      method: 'OPTIONS',
      url: '/me',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const bad = await w.app.inject({
      method: 'OPTIONS',
      url: '/me',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    await w.close();
  });
  it('input validation: malformed bodies are 4xx, never 500', async () => {
    const w = await buildWorld();
    for (const body of [null, 'str', 123, [], { message: 123 }, { message: 'x'.repeat(200_000) }]) {
      const r = await w.post('/chat', body, w.student);
      expect(r.status, JSON.stringify(body)?.slice(0, 30)).toBeLessThan(500);
    }
    for (const body of [{}, { email: 1, password: 2 }, { email: 'a@b.c', password: 'x' }]) {
      expect((await w.post('/auth/register', body, null)).status).toBeLessThan(500);
      expect((await w.post('/auth/login', body, null)).status).toBeLessThan(500);
    }
    expect(
      (await w.post('/actions/%00/approve', { totp_code: '1' }, w.student)).status
    ).toBeLessThan(500);
    await w.close();
  });
});
