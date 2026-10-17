/** POST /chat — port of backend/app/routes/chat.py */
import type { FastifyPluginAsync } from 'fastify';
import { runChat } from '../agents/graph.js';
import { currentUser, rateLimit } from '../deps.js';
import { parse } from '../errors.js';
import { ChatRequest } from '../schemas.js';

export const chatRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));
  app.post('/', async (req) => {
    const user = await currentUser(ctx, req);
    return runChat(ctx, user, parse(ChatRequest, req.body));
  });
};
