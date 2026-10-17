import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, NOTICE_CLEAN, NOTICE_INJECTED, NOTICE_PAYEE_CHANGED, type Persona, type World } from '../../src/evalkit/world.js';

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(() => w.close());
const upload = (text: string, who?: Persona) => w.post('/documents', { filename: 'n.txt', text }, who ?? w.student);
const confirmBody = { amount_cny: '18500.00', due_date: '2027-03-01', payee_name: 'Shenzhen Example University (SYNTHETIC)' };

describe('documents', () => {
  it('clean upload parses fields', async () => {
    const r = await upload(NOTICE_CLEAN);
    expect(r.status).toBe(201);
    const j = r.json;
    expect(j).toMatchObject({ status: 'pending_confirmation', untrusted: true, synthetic: true });
    expect(j.parsed).toMatchObject({ amount_cny: '18500.00', due_date: '2027-03-01', account_masked: '****4821' });
    expect(j.guardian.verdict).toBe('clean');
    expect(j.doc_hash.startsWith('sha256:')).toBe(true);
  });
  it('confirm creates obligation with the registry payee; second confirm 409', async () => {
    const d = (await upload(NOTICE_CLEAN)).json;
    const r = await w.post(`/documents/${d.id}/confirm`, confirmBody, w.student);
    expect(r.status).toBe(200);
    expect(r.json.blocked).toBe(false);
    expect(r.json.obligation.payee_id).toBe(w.payeeId);
    expect(r.json.obligation.doc_hash).toBe(d.doc_hash);
    expect((await w.post(`/documents/${d.id}/confirm`, confirmBody, w.student)).status).toBe(409);
  });
  it('amount mismatch rejected', async () => {
    const d = (await upload(NOTICE_CLEAN)).json;
    const r = await w.post(`/documents/${d.id}/confirm`, { amount_cny: '1850.00', due_date: '2027-03-01', payee_name: 'x' }, w.student);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('AMOUNT_MISMATCH');
  });
  it('injected notice is blocked and audited', async () => {
    const d = (await upload(NOTICE_INJECTED)).json;
    expect(d.status).toBe('blocked');
    expect(d.guardian.verdict).toBe('blocked');
    expect(d.guardian.flags.map((f: { code: string }) => f.code)).toContain('INJECTION_PHRASE');
    const j = (await w.post(`/documents/${d.id}/confirm`, { amount_cny: '18500.00', due_date: '2027-03-01', payee_name: 'x' }, w.student)).json;
    expect(j.blocked).toBe(true);
    expect(j.obligation).toBeNull();
    const events = (await w.get('/audit', w.student)).json.entries.map((e: { event: string }) => e.event);
    expect(events).toContain('guardian.blocked');
    expect(events).toContain('document.confirm_blocked');
  });
  it('payee-changed notice creates an UNVERIFIED payee', async () => {
    const d = (await upload(NOTICE_PAYEE_CHANGED)).json;
    expect(d.guardian.verdict).toBe('suspicious');
    const codes = new Set(d.guardian.flags.map((f: { code: string }) => f.code));
    expect(codes.has('PAYEE_CHANGE_NOTICE') && codes.has('PAYEE_CHANGED')).toBe(true);
    const j = (await w.post(`/documents/${d.id}/confirm`, confirmBody, w.student)).json;
    expect(j.obligation.payee_id).not.toBe(w.payeeId);
    const payees = (await w.get('/payees', w.student)).json as { id: string; verified: boolean }[];
    expect(payees.find((p) => p.id === j.obligation.payee_id)?.verified).toBe(false);
  });
  it('multipart .txt upload works; PDF is rejected (422, out of scope)', async () => {
    const boundary = '----setu';
    const mp = (name: string, body: string, ct: string) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${ct}\r\n\r\n${body}\r\n--${boundary}--\r\n`);
    const headers = { ...w.student.h, 'content-type': `multipart/form-data; boundary=${boundary}` };
    const r = await w.app.inject({ method: 'POST', url: '/documents', headers, payload: mp('n.txt', NOTICE_CLEAN, 'text/plain') });
    expect(r.statusCode).toBe(201);
    expect(r.json().parsed.amount_cny).toBe('18500.00');
    const p = await w.app.inject({ method: 'POST', url: '/documents', headers, payload: mp('n.pdf', '%PDF-1.4 not really', 'application/pdf') });
    expect(p.statusCode).toBe(422);
  });
  it('document IDOR returns 404', async () => {
    const d = (await upload(NOTICE_CLEAN)).json;
    expect((await w.post(`/documents/${d.id}/confirm`, { amount_cny: '18500.00', due_date: '2027-03-01', payee_name: 'x' }, w.other)).status).toBe(404);
  });
});
