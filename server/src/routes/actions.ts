/** /actions */
import type { FastifyPluginAsync } from 'fastify';
import { actionOut, approve, getVisible, reject, visibleActions } from '../actionsService.js';
import { currentUser, rateLimit } from '../deps.js';
import { parse } from '../errors.js';
import { ApproveRequest, RejectRequest } from '../schemas.js';

export const actionRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));
  app.get('/', async (req) => {
    const user = await currentUser(ctx, req);
    return visibleActions(ctx, user, (req.query as { status?: string }).status).map((r) =>
      actionOut(ctx, r)
    );
  });
  app.get<{ Params: { id: string } }>('/:id', async (req) =>
    actionOut(ctx, getVisible(ctx, await currentUser(ctx, req), req.params.id))
  );
  app.post<{ Params: { id: string } }>('/:id/approve', async (req) => {
    const user = await currentUser(ctx, req);
    return actionOut(
      ctx,
      approve(ctx, user, req.params.id, parse(ApproveRequest, req.body).totp_code)
    );
  });
  app.post<{ Params: { id: string } }>('/:id/reject', async (req) => {
    const user = await currentUser(ctx, req);
    return actionOut(
      ctx,
      reject(ctx, user, req.params.id, parse(RejectRequest, req.body ?? {}).reason)
    );
  });
};
