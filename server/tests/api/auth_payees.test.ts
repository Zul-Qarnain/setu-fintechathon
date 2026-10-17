import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, PW, type World } from '../../src/evalkit/world.js';
import { totpAt } from '../../src/security.js';

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(() => w.close());

describe('auth', () => {
  it('health is public', async () => {
    const j = (await w.get('/health')).json;
    expect(j.status).toBe('ok');
    expect(j.synthetic_data).toBe(true);
    expect(j.offline_mode).toBe(true);
  });

  it('protected routes need a token', async () => {
    for (const p of ['/me', '/payees', '/obligations', '/fx/quote']) {
      const r = await w.get(p);
      expect(r.status, p).toBe(401);
      expect(r.json.error.code).toBe('UNAUTHORIZED');
      expect(r.json.request_id).toMatch(/^req_/);
    }
  });

  it('register / login / me roundtrip + duplicate + shape', async () => {
    let r = await w.post('/auth/register', {
      email: 'Nusrat@Demo.Setu.Test',
      password: 'a-long-password-1',
      role: 'student',
    });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({
      id: expect.stringMatching(/^usr_/),
      email: 'nusrat@demo.setu.test',
      role: 'student',
      locale: 'en',
      totp_enabled: false,
      approver_id: null,
      synthetic: true,
    });
    expect(
      (
        await w.post('/auth/register', {
          email: 'nusrat@demo.setu.test',
          password: 'a-long-password-1',
        })
      ).status
    ).toBe(409);
    r = await w.post('/auth/login', {
      email: 'nusrat@demo.setu.test',
      password: 'a-long-password-1',
    });
    expect(r.status).toBe(200);
    expect(r.json.token_type).toBe('bearer');
    expect(typeof r.json.expires_in).toBe('number');
    const me = await w.get('/me', null, { authorization: `Bearer ${r.json.access_token}` });
    expect(me.json.role).toBe('student');
  });

  it('bad password and unknown user give the same generic error', async () => {
    const a = await w.post('/auth/login', {
      email: w.student.email,
      password: 'wrong-password-xx',
    });
    const b = await w.post('/auth/login', {
      email: 'nobody@demo.setu.test',
      password: 'wrong-password-xx',
    });
    expect(a.status).toBe(401);
    expect(a.json.error.message).toBe(b.json.error.message);
  });

  it('short password -> 422 validation_error with details.errors', async () => {
    const r = await w.post('/auth/register', { email: 'x@y.z', password: 'short' });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('validation_error');
    expect(r.json.error.details.errors[0].loc).toEqual(['body', 'password']);
  });

  it('admin cannot self-register; unknown approver rejected', async () => {
    expect(
      (await w.post('/auth/register', { email: 'a@demo.setu.test', password: PW, role: 'admin' }))
        .status
    ).toBe(403);
    expect(
      (
        await w.post('/auth/register', {
          email: 'z@demo.setu.test',
          password: PW,
          approver_email: w.student.email,
        })
      ).status
    ).toBe(422);
  });

  it('TOTP enrolment: setup, wrong code 403, right code enables, replay rejected', async () => {
    await w.post('/auth/register', { email: 'new@demo.setu.test', password: PW });
    const tok = (await w.post('/auth/login', { email: 'new@demo.setu.test', password: PW })).json
      .access_token;
    const h = { authorization: `Bearer ${tok}` };
    expect((await w.post('/auth/totp/verify', { code: '000000' }, null, h)).json.error.code).toBe(
      'TOTP_NOT_STARTED'
    );
    const setup = (await w.post('/auth/totp/setup', {}, null, h)).json;
    expect(setup.otpauth_uri.startsWith('otpauth://totp/')).toBe(true);
    expect((await w.post('/auth/totp/verify', { code: '000000' }, null, h)).status).toBe(403);
    const code = totpAt(setup.secret, Math.floor(Date.now() / 1000));
    const ok = await w.post('/auth/totp/verify', { code }, null, h);
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ verified: true, totp_enabled: true });
    expect((await w.get('/me', null, h)).json.totp_enabled).toBe(true);
    expect((await w.post('/auth/totp/setup', {}, null, h)).json.error.code).toBe(
      'TOTP_ALREADY_ENABLED'
    );
    expect((await w.post('/auth/totp/verify', { code }, null, h)).json.error.code).toBe(
      'TOTP_INVALID'
    ); // replay of same step
  });

  it('TOTP lockout after 5 failures -> 429 TOTP_LOCKED', async () => {
    const x = await buildWorld();
    const tok = (await x.post('/auth/login', { email: x.student.email, password: PW })).json
      .access_token;
    const h = { authorization: `Bearer ${tok}` };
    for (let i = 0; i < 5; i++)
      expect((await x.post('/auth/totp/verify', { code: '000000' }, null, h)).json.error.code).toBe(
        'TOTP_INVALID'
      );
    const r = await x.post('/auth/totp/verify', { code: x.student.code() }, null, h);
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('TOTP_LOCKED');
    expect(r.json.error.details.retry_after_seconds).toBeGreaterThan(0);
    await x.close();
  });
});

describe('payees', () => {
  const newPayee = (acct = '6222000000005555', name = 'Landlord Li (SYNTHETIC)') =>
    w.post('/payees', { name, account_number: acct, bank: 'Sandbox Bank' }, w.student);

  it('creates an unverified payee with cooling-off and masked/tokenised account', async () => {
    const r = await newPayee();
    expect(r.status).toBe(201);
    expect(r.json.verified).toBe(false);
    expect(r.json.cooling_off_until).not.toBeNull();
    expect(r.json.account_masked).toBe('****5555');
    expect(r.json.account_token).toMatch(/^ACCT_/);
    expect(r.text).not.toContain('6222000000005555');
    expect(Object.keys(r.json).sort()).toEqual([
      'account_masked',
      'account_token',
      'bank',
      'cooling_off_until',
      'created_at',
      'id',
      'name',
      'owner_id',
      'verified',
      'verified_at',
    ]);
  });

  it('rejects invalid and homoglyph account numbers', async () => {
    for (const bad of ['12ab', '６２２２００００００００５５５５', '6222 0000 0000 55x5']) {
      const r = await w.post('/payees', { name: 'X', account_number: bad, bank: 'B' }, w.student);
      expect(r.status, bad).toBe(422);
    }
  });

  it('student cannot verify own payee; linked approver can and cooling-off persists', async () => {
    const pid = (await newPayee('6222000000006666')).json.id;
    expect((await w.post(`/payees/${pid}/verify`, {}, w.student)).status).toBe(403);
    const r = await w.post(`/payees/${pid}/verify`, {}, w.approver);
    expect(r.status).toBe(200);
    expect(r.json.verified).toBe(true);
    expect(r.json.cooling_off_until).not.toBeNull();
  });

  it('unlinked approver gets 404 (IDOR-safe)', async () => {
    await w.post('/auth/register', {
      email: 'stranger@demo.setu.test',
      password: 'a-long-password-1',
      role: 'family_approver',
    });
    const tok = (
      await w.post('/auth/login', {
        email: 'stranger@demo.setu.test',
        password: 'a-long-password-1',
      })
    ).json.access_token;
    const pid = (await newPayee('6222000000006767')).json.id;
    expect(
      (await w.post(`/payees/${pid}/verify`, {}, null, { authorization: `Bearer ${tok}` })).status
    ).toBe(404);
  });

  it('same name + new account is unverified (PAYEE_CHANGED path)', async () => {
    const r = await newPayee('6222000000007777', 'Shenzhen Example University (SYNTHETIC)');
    expect(r.status).toBe(201);
    expect(r.json.verified).toBe(false);
  });

  it("another student's payees are not listed; approver sees linked student's", async () => {
    expect((await w.get('/payees', w.other)).json).toEqual([]);
    const owners = new Set(
      (await w.get('/payees', w.approver)).json.map((p: { owner_id: string }) => p.owner_id)
    );
    expect([...owners]).toEqual([w.student.id]);
  });
});

describe('fx + obligations + erasure', () => {
  it('fx quote shape', async () => {
    const r = await w.get('/fx/quote?amount_cny=1000&to=bdt', w.student);
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual([
      'amount_cny',
      'amount_converted',
      'as_of',
      'base',
      'cached',
      'disclaimer',
      'is_live',
      'pair',
      'quote',
      'rate',
      'source',
    ]);
    expect(r.json.pair).toBe('CNY/BDT');
    expect(r.json.rate).toMatch(/^\d+\.\d{4}$/);
    expect(r.json.is_live).toBe(false);
    expect(r.json.source).toBe('fixture-sample');
  });
  it('fx validation + unsupported pair', async () => {
    expect((await w.get('/fx/quote?amount_cny=-5', w.student)).json.error.code).toBe(
      'validation_error'
    );
    expect((await w.get('/fx/quote?to=XXX', w.student)).json.error.code).toBe('UNSUPPORTED_PAIR');
  });
  it('obligations list', async () => {
    const r = await w.get('/obligations', w.student);
    expect(r.json.map((o: { due_date: string }) => o.due_date)).toEqual([
      '2026-11-15',
      '2027-03-01',
    ]);
    expect(r.json[0].amount_cny).toBe('1350.00');
    expect(r.json[0].payee_name).toBe('Shenzhen Example University (SYNTHETIC)');
  });
  it('DELETE /me erases PII but keeps audit', async () => {
    const x = await buildWorld();
    const r = await x.del('/me', x.other);
    expect(r.json).toEqual({ erased: true, audit_retained: 'redacted payload hashes only' });
    expect((await x.get('/me', x.other)).status).toBe(401);
    await x.close();
  });
});
