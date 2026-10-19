import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, type Config } from './config.js';
import { openDb, type Db } from './db/connection.js';
import { createSchema } from './db/schema.js';
import { errorHandler } from './errors.js';
import { redactLog, redactPaths } from './logging.js';
import { RateLimiter } from './deps.js';
import { FxService } from './domain/fx.js';
import { demoRoutes } from './routes/demo.js';
import { chatRoutes } from './routes/chat.js';
import { documentRoutes } from './routes/documents.js';
import { actionRoutes } from './routes/actions.js';
import { auditRoutes } from './routes/audit.js';
import { evidenceRoutes } from './routes/evidence.js';
import { sandboxRoutes } from './routes/sandbox.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { fxRoutes } from './routes/fx.js';
import { payeeRoutes } from './routes/payees.js';
import * as keys from './domain/keys.js';

export interface AppContext {
  config: Config;
  db: Db;
  limiter: RateLimiter;
  fx: FxService;
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
  /** test hook: capture log output (A10 PII-in-logs attack). */
  logStream?: { write(chunk: string): void };
}

/** Builds the Fastify app WITHOUT listening (use fastify.inject in tests). */
export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const db = opts.db ?? openDb(config.DATABASE_URL);
  createSchema(db);

  // Configure key material for this app instance
  keys.configureKeys({ hmacKey: config.HMAC_KEY, aesKeyB64: config.AES_KEY_B64 });

  // Assert non-default keys in production
  if (process.env.NODE_ENV === 'production') {
    keys.assertNonDefaultKeys({
      HMAC_KEY: config.HMAC_KEY,
      JWT_SECRET: config.JWT_SECRET,
      AES_KEY_B64: config.AES_KEY_B64,
    });
  }

  const app = Fastify({
    logger: opts.logger
      ? {
          level: 'info',
          redact: redactPaths,
          ...(opts.logStream ? { stream: opts.logStream } : {}),
          // defence in depth: free-text PII (account numbers, emails, phones) in any log message/object is masked
          hooks: {
            logMethod(args, method) {
              (method as (...a: unknown[]) => void).apply(
                this,
                args.map((a) => redactLog(a))
              );
            },
          },
        }
      : false,
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return (Array.isArray(h) ? h[0] : h) || `req_${randomBytes(6).toString('hex')}`;
    },
    requestIdHeader: false,
    bodyLimit: 12 * 1024 * 1024,
  });

  app.decorate('ctx', {
    config,
    db,
    limiter: new RateLimiter(),
    fx: new FxService({ mode: config.FX_MODE, dataDir: config.dataDir }),
  } satisfies AppContext);

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    // Security headers (JSON API: nothing here is ever meant to be framed, sniffed, cached or executed)
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-resource-policy', 'same-site');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('cache-control', 'no-store');
    reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
  });
  app.setErrorHandler(errorHandler);
  // API contract: unknown routes bypass the error envelope and return {"detail":"Not Found"} (see docs/API.md).
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ detail: 'Not Found' }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(payeeRoutes, { prefix: '/payees' });
  await app.register(fxRoutes, { prefix: '/fx' });
  await app.register(dashboardRoutes);
  await app.register(demoRoutes, { prefix: '/demo' });
  await app.register(chatRoutes, { prefix: '/chat' });
  await app.register(documentRoutes, { prefix: '/documents' });
  await app.register(actionRoutes, { prefix: '/actions' });
  await app.register(auditRoutes, { prefix: '/audit' });
  await app.register(evidenceRoutes, { prefix: '/evidence' });
  await app.register(sandboxRoutes, { prefix: '/sandbox' });

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
