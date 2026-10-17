/** GET /evidence/export — port of backend/app/routes/evidence.py */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { verifyAudit } from '../db/auditStore.js';
import type { UserRow } from '../db/schema.js';
import { currentUser, rateLimit } from '../deps.js';
import { entryOut, visibleAudit } from './audit.js';

export function buildExport(ctx: AppContext, user: UserRow) {
  const res = verifyAudit(ctx.db);
  const rows = visibleAudit(ctx, user, 100000);
  return {
    synthetic: true,
    generated_at: new Date().toISOString(),
    scope: user.role === 'admin' ? 'all' : 'own',
    audit: rows.map((r) => entryOut(r)),
    verify: { ok: res.ok, checked: res.checked, broken_at_seq: res.broken_at_seq, reason: res.reason },
    head_hash: rows.length ? rows[rows.length - 1]?.hash : null,
  };
}

export const evidenceRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));
  app.get('/export', async (req) => buildExport(ctx, await currentUser(ctx, req)));
};
