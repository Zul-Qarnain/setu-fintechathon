import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, type Config } from './config.js';
import { openDb, type Db } from './db/connection.js';
import { createSchema } from './db/schema.js';
import { envelope, errorHandler } from './errors.js';
import { redactPaths } from './logging.js';

export interface AppContext {
  config: Config;
  db: Db;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export interface BuildOptions {
  config?: Config;
  db?: Db;
  logger?: boolean;
}

/** Builds the Fastify app WITHOUT listening (use fastify.inject in tests). */
export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const db = opts.db ?? openDb(config.DATABASE_URL);
  createSchema(db);

  const app = Fastify({
    logger: opts.logger ? { level: 'info', redact: redactPaths } : false,
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return (Array.isArray(h) ? h[0] : h) || `req_${randomBytes(6).toString('hex')}`;
    },
    requestIdHeader: false,
    bodyLimit: 12 * 1024 * 1024,
  });
  app.decorate('ctx', { config, db });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => reply.status(404).send(envelope('http_404', 'Not Found', req.id)));

  app.get('/health', async () => ({
    status: 'ok',
    offline_mode: config.ALLOW_OFFLINE,
    llm_provider: config.LLM_PROVIDER,
    fx_mode: config.FX_MODE,
    synthetic_data: true,
    version: '0.1.0',
  }));

  app.addHook('onClose', async () => {
    if (!opts.db) db.close();
  });
  return app;
}
