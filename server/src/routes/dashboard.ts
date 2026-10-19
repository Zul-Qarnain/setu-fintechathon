/** /me, /obligations, DELETE /me (PIPL erasure) (GET /dashboard added with agent tools in M4). */
import type { FastifyPluginAsync } from 'fastify';
import { appendAudit } from '../db/auditStore.js';
import type { ObligationRow } from '../db/schema.js';
import { currentUser, rateLimit } from '../deps.js';
import { newToolState, budgetSummary } from '../agents/tools.js';
import { todayIso } from '../agents/graph.js';
import { computeCosts } from '../domain/costs.js';
import { Decimal } from '../domain/money.js';
import { countPendingActions, fxQuoteOut, obligationOut, userOut } from '../services.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));

  app.get('/me', async (req) => userOut(await currentUser(ctx, req)));

  app.get('/obligations', async (req) => {
    const user = await currentUser(ctx, req);
    const rows = db
      .prepare('SELECT * FROM obligations WHERE user_id = ? ORDER BY due_date')
      .all(user.id) as ObligationRow[];
    return rows.map((o) => obligationOut(ctx, o));
  });

  app.get('/dashboard', async (req) => {
    const user = await currentUser(ctx, req);
    const rows = db
      .prepare('SELECT * FROM obligations WHERE user_id = ? ORDER BY due_date')
      .all(user.id) as ObligationRow[];
    const obs = rows.map((o) => obligationOut(ctx, o));
    const nxt = obs.find((o) => o.status === 'open') ?? null;
    const bdt = nxt
      ? (await computeCosts(new Decimal(nxt.amount_cny), ctx.fx)).bdt_needed.toFixed(2)
      : null;
    const b = budgetSummary(newToolState(ctx, user, todayIso(ctx)));
    return {
      synthetic: true,
      user: userOut(user),
      obligations: obs,
      next_due: nxt,
      bdt_needed_next: bdt,
      pending_actions: countPendingActions(ctx, user),
      monthly_budget_cny: b.monthly_budget_cny,
      spent_this_month_cny: b.spent_this_month_cny,
      fx: await fxQuoteOut(ctx, '1000'),
    };
  });

  app.delete('/me', async (req) => {
    const user = await currentUser(ctx, req);
    db.transaction(() => {
      for (const [t, col] of [
        ['actions', 'owner_id'],
        ['plans', 'owner_id'],
        ['obligations', 'user_id'],
        ['documents', 'owner_id'],
        ['payees', 'owner_id'],
      ] as const) {
        db.prepare(`DELETE FROM ${t} WHERE ${col} = ?`).run(user.id);
      }
      db.prepare(
        "UPDATE users SET email = ?, password_hash = '!', totp_secret_enc = NULL, totp_enabled = 0, display_name = NULL, erased = 1 WHERE id = ?"
      ).run(`erased+${user.id}@erased.invalid`, user.id);
      appendAudit(db, user.id, 'user.erased', { pipl: 'erasure', audit_retained: 'hashes only' });
    })();
    return { erased: true, audit_retained: 'redacted payload hashes only' };
  });
};
