/** /payees */
import type { FastifyPluginAsync } from 'fastify';
import type { PayeeRow, UserRow } from '../db/schema.js';
import { apiError, currentUser, rateLimit, requireRoles } from '../deps.js';
import { parse } from '../errors.js';
import { PayeeCreate } from '../schemas.js';
import { createPayee, payeeOut, verifyPayee } from '../services.js';

export const payeeRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  const { db } = ctx;
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));

  app.get('/', async (req) => {
    const user = await currentUser(ctx, req);
    let owners: string[];
    if (user.role === 'student') owners = [user.id];
    else if (user.role === 'family_approver')
      owners = (
        db.prepare('SELECT id FROM users WHERE approver_id = ?').all(user.id) as { id: string }[]
      ).map((u) => u.id);
    else owners = (db.prepare('SELECT id FROM users').all() as { id: string }[]).map((u) => u.id);
    if (!owners.length) return [];
    const rows = db
      .prepare(
        `SELECT * FROM payees WHERE owner_id IN (${owners.map(() => '?').join(',')}) ORDER BY created_at`
      )
      .all(...owners) as PayeeRow[];
    return rows.map(payeeOut);
  });

  app.post('/', async (req, reply) => {
    const user = await requireRoles(ctx, req, 'student');
    const b = parse(PayeeCreate, req.body);
    const [p] = createPayee(ctx, user, b.name, b.account_number, b.bank, { source: b.source });
    return reply.status(201).send(payeeOut(p));
  });

  app.post<{ Params: { id: string } }>('/:id/verify', async (req) => {
    const user = await requireRoles(ctx, req, 'family_approver', 'admin');
    const p = db.prepare('SELECT * FROM payees WHERE id = ?').get(req.params.id) as
      PayeeRow | undefined;
    const owner = p
      ? (db.prepare('SELECT * FROM users WHERE id = ?').get(p.owner_id) as UserRow | undefined)
      : undefined;
    if (!p || !owner) throw apiError(404, 'NOT_FOUND', 'Payee not found');
    if (user.role === 'family_approver' && owner.approver_id !== user.id)
      throw apiError(404, 'NOT_FOUND', 'Payee not found'); // IDOR-safe
    return payeeOut(verifyPayee(ctx, user, p));
  });
};
