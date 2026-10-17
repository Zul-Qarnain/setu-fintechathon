/** /me, /obligations, DELETE /me (PIPL erasure) — port of backend/app/routes/dashboard.py (GET /dashboard added with agent tools in M4). */
import type { FastifyPluginAsync } from 'fastify';
import { appendAudit } from '../db/auditStore.js';
import type { ObligationRow } from '../db/schema.js';
import { currentUser, rateLimit } from '../deps.js';
import { obligationOut, userOut } from '../services.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));

  app.get('/me', async (req) => userOut(await currentUser(ctx, req)));

  app.get('/obligations', async (req) => {
    const user = await currentUser(ctx, req);
    const rows = db.prepare('SELECT * FROM obligations WHERE user_id = ? ORDER BY due_date').all(user.id) as ObligationRow[];
    return rows.map((o) => obligationOut(ctx, o));
  });

  app.delete('/me', async (req) => {
    const user = await currentUser(ctx, req);
    db.transaction(() => {
      for (const [t, col] of [['actions', 'owner_id'], ['plans', 'owner_id'], ['obligations', 'user_id'], ['documents', 'owner_id'], ['payees', 'owner_id']] as const) {
        db.prepare(`DELETE FROM ${t} WHERE ${col} = ?`).run(user.id);
      }
      db.prepare("UPDATE users SET email = ?, password_hash = '!', totp_secret_enc = NULL, totp_enabled = 0, display_name = NULL, erased = 1 WHERE id = ?").run(`erased+${user.id}@erased.invalid`, user.id);
      appendAudit(db, user.id, 'user.erased', { pipl: 'erasure', audit_retained: 'hashes only' });
    })();
    return { erased: true, audit_retained: 'redacted payload hashes only' };
  });
};
