/** /demo/* helpers — SYNTHETIC data only. Available only when DEMO_MODE=true or a valid X-Admin-Token equals ADMIN_TOKEN. Port of backend/app/routes/demo.py. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppContext } from '../app.js';
import type { UserRow } from '../db/schema.js';
import { apiError } from '../deps.js';
import { safeEqual } from '../domain/crypto.js';
import * as security from '../security.js';
import { loadPersonas, seedAll } from '../seed.js';

function guard(ctx: AppContext, req: FastifyRequest): void {
  if (ctx.config.DEMO_MODE) return;
  const h = req.headers['x-admin-token'];
  const tok = Array.isArray(h) ? h[0] : h;
  if (ctx.config.ADMIN_TOKEN && tok && safeEqual(tok, ctx.config.ADMIN_TOKEN)) return;
  throw apiError(404, 'NOT_FOUND', 'Not found');
}

export const demoRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  const { db, config } = ctx;
  app.addHook('onRequest', async (req) => guard(ctx, req));

  app.get('/personas', async () => {
    try {
      return loadPersonas(config.dataDir).map((u) => ({
        email: u.email,
        password: u.password,
        role: u.role,
        name: u.display_name ?? null,
        locale: u.locale ?? 'en',
        synthetic: true,
      }));
    } catch {
      return [];
    }
  });

  app.get('/notices', async () => {
    const dir = join(config.dataDir, 'fee_notices');
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
    } catch {
      return [];
    }
    const items = (
      Array.isArray(manifest) ? manifest : (manifest as { notices: unknown[] }).notices
    ) as { file: string; label: string; language: string; category: string }[];
    const out: Record<string, unknown>[] = [];
    for (const m of items) {
      try {
        const text = readFileSync(join(dir, m.file), 'utf-8');
        out.push({
          id: m.file,
          label: `${m.file} (${m.label}, SYNTHETIC)`,
          language: m.language,
          category: m.category,
          expected_label: m.label,
          text,
        });
      } catch {
        /* missing file: skip */
      }
    }
    return out;
  });

  app.get<{ Params: { email: string } }>('/totp/:email', async (req) => {
    const email = req.params.email;
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
      UserRow | undefined;
    if (!u || !u.totp_secret_enc) throw apiError(404, 'NOT_FOUND', 'No TOTP for that user');
    return {
      email,
      code: security.totpNow(security.decryptSecret(u.totp_secret_enc, u.id)),
      valid_for_seconds: String(30 - (Math.floor(Date.now() / 1000) % 30)),
    };
  });

  app.post('/tamper-audit', async (req) => {
    const seq = Number.parseInt((req.query as { seq?: string }).seq ?? '2', 10);
    const row = db.prepare('SELECT event FROM audit WHERE seq = ?').get(seq) as
      { event: string } | undefined;
    if (!row) throw apiError(404, 'NOT_FOUND', 'No such audit row');
    db.prepare('UPDATE audit SET event = ? WHERE seq = ?').run(row.event + '.TAMPERED', seq);
    return {
      tampered_seq: seq,
      note: 'row edited out-of-band; GET /audit?verify=true will report broken_at_seq',
    };
  });

  app.post('/reset', async () => {
    db.transaction(() => {
      for (const t of [
        'sbx_txns',
        'sbx_accounts',
        'actions',
        'plans',
        'obligations',
        'documents',
        'payees',
      ])
        db.prepare(`DELETE FROM ${t}`).run();
      db.prepare('UPDATE users SET approver_id = NULL').run();
      db.prepare('DELETE FROM users').run();
      db.prepare('DELETE FROM audit').run();
    })();
    ctx.limiter.reset();
    const r = await seedAll(ctx);
    return { reset: true, users: r.users, obligations: r.obligations };
  });
};
