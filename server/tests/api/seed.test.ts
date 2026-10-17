import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDb } from '../../src/db/connection.js';
import { verifyAudit } from '../../src/db/auditStore.js';
import { seedIfEmpty } from '../../src/seed.js';

describe('seed', () => {
  it('seeds personas once, logs a verifiable audit head, and demo logins work', async () => {
    const app = await buildApp({ config: loadConfig({ RATE_LIMIT_PER_MINUTE: '100000' }), db: openDb(':memory:') });
    const r = await seedIfEmpty(app.ctx);
    expect(r).not.toBeNull();
    expect(r?.users).toBe(7);
    expect(r?.auditHead.head_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await seedIfEmpty(app.ctx)).toBeNull();
    expect(verifyAudit(app.ctx.db).ok).toBe(true);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'aisha@demo.setu.test', password: 'demo-password-123' } });
    expect(login.statusCode).toBe(200);
    const tok = (login.json() as { access_token: string }).access_token;
    const obl = await app.inject({ method: 'GET', url: '/obligations', headers: { authorization: `Bearer ${tok}` } });
    expect((obl.json() as unknown[]).length).toBe(2);
    await app.close();
  });
});
