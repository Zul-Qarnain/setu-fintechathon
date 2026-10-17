/** /fx/quote — port of backend/app/routes/fx.py */
import type { FastifyPluginAsync } from 'fastify';
import { currentUser, rateLimit, apiError } from '../deps.js';
import { Decimal } from '../domain/money.js';
import { FxError } from '../domain/fx.js';
import { AppError } from '../errors.js';
import { fxQuoteOut } from '../services.js';

const bad = (field: string, msg: string) =>
  new AppError('validation_error', 'Request validation failed', 422, {
    errors: [{ loc: ['query', field], msg }],
  });

export const fxRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));

  app.get('/quote', async (req) => {
    await currentUser(ctx, req);
    const q = req.query as { amount_cny?: string; to?: string };
    const raw = q.amount_cny ?? '1000';
    let amt: Decimal;
    try {
      amt = new Decimal(raw);
    } catch {
      throw bad('amount_cny', 'Input should be a valid decimal');
    }
    if (!amt.isFinite() || amt.lte(0)) throw bad('amount_cny', 'Input should be greater than 0');
    if (amt.gte(100_000_000)) throw bad('amount_cny', 'Input should be less than 100000000');
    const to = q.to ?? 'BDT';
    if (to.length !== 3) throw bad('to', 'String should have at least 3 characters');
    try {
      return await fxQuoteOut(ctx, raw, to.toUpperCase());
    } catch (e) {
      if (e instanceof FxError) throw apiError(422, 'UNSUPPORTED_PAIR', e.message);
      throw e;
    }
  });
};
