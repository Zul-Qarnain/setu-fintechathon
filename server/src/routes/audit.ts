/** GET /audit — port of backend/app/routes/audit.py */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../app.js';
import { verifyAudit } from '../db/auditStore.js';
import type { AuditRow, UserRow } from '../db/schema.js';
import { currentUser, rateLimit } from '../deps.js';

export function entryOut(r: AuditRow, withPayload = true) {
  return {
    seq: r.seq,
    ts: r.ts,
    actor: r.actor,
    event: r.event,
    payload_hash: r.payload_hash,
    prev_hash: r.prev_hash,
    hash: r.hash,
    payload: withPayload && r.payload_json ? (JSON.parse(r.payload_json) as unknown) : null,
  };
}

/** Audit rows the user may see: admin all; others their own (+ linked students for approvers) + executor rows (no PII). */
export function visibleAudit(ctx: AppContext, user: UserRow, limit = 200): AuditRow[] {
  const { db } = ctx;
  let rows: AuditRow[];
  if (user.role === 'admin') {
    rows = db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?').all(limit) as AuditRow[];
  } else {
    const ids = [user.id];
    if (user.role === 'family_approver')
      ids.push(
        ...(
          db.prepare('SELECT id FROM users WHERE approver_id = ?').all(user.id) as { id: string }[]
        ).map((u) => u.id)
      );
    ids.push('executor');
    rows = db
      .prepare(
        `SELECT * FROM audit WHERE actor IN (${ids.map(() => '?').join(',')}) ORDER BY seq DESC LIMIT ?`
      )
      .all(...ids, limit) as AuditRow[];
  }
  return rows.sort((a, b) => a.seq - b.seq);
}

export const auditRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));
  app.get('/', async (req) => {
    const user = await currentUser(ctx, req);
    const q = req.query as { verify?: string; limit?: string };
    const n = Number.parseInt(q.limit ?? '200', 10);
    const limit = Math.max(1, Math.min(Number.isFinite(n) ? n : 200, 1000));
    const entries = visibleAudit(ctx, user, limit).map((r) => entryOut(r));
    let verify: {
      ok: boolean;
      checked: number;
      broken_at_seq: number | null;
      reason: string | null;
    } | null = null;
    if (['1', 'true', 'yes', 'on'].includes((q.verify ?? '').toLowerCase())) {
      const r = verifyAudit(ctx.db); // the chain is global: verification always covers every row
      verify = { ok: r.ok, checked: r.checked, broken_at_seq: r.broken_at_seq, reason: r.reason };
    }
    return { entries, verify };
  });
};
