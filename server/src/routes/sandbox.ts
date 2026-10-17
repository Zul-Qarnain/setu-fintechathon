/** Read-only sandbox bank API at /sandbox — port of backend/app/sandbox_bank/api.py */
import type { FastifyPluginAsync } from 'fastify';
import { currentUser } from '../deps.js';
import { getAccountByOwner, listTransactions } from '../sandboxBank/ledger.js';

export const sandboxRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  app.get('/account', async (req) => {
    const user = await currentUser(ctx, req);
    const a = getAccountByOwner(ctx.db, user.id);
    if (!a) return { account: null, synthetic: true };
    return { account: { account_masked: `****${a.account_number.slice(-4)}`, holder: a.holder, balance_cny: a.balance_cny }, synthetic: true, sandbox: true };
  });
  app.get('/transactions', async (req) => {
    const user = await currentUser(ctx, req);
    const a = getAccountByOwner(ctx.db, user.id);
    if (!a) return { transactions: [], synthetic: true };
    return {
      transactions: listTransactions(ctx.db, a.account_number).map((t) => ({
        id: t.id, state: t.state, failure_code: t.failure_code, amount_cny: t.amount_cny, reference: t.reference,
        to_masked: `****${t.to_account_number.slice(-4)}`, created_at: t.created_at,
      })),
      synthetic: true,
    };
  });
};
