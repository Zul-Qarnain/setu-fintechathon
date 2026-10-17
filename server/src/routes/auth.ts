/** Auth routes: register, login, TOTP setup/verify. Port of backend/app/routes/auth.py */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { appendAudit } from '../db/auditStore.js';
import { apiError, requireUser, rateLimit, verifyUserTotp } from '../deps.js';
import * as security from '../security.js';
import * as services from '../services.js';
import type { Config } from '../config.js';
import type { RegisterBody, LoginBody, TotpVerifyBody } from '../services.js';
import type { UserRow } from '../db/schema.js';

interface AuthRoutesOptions {
  config: Config;
  db: Database.Database;
}

export async function authRoutes(fastify: FastifyInstance, opts: AuthRoutesOptions) {
  const { config, db } = opts;

  // Rate limiter dependency - wrap in a hook for all /auth routes
  fastify.addHook('preHandler', async (request, _reply) => {
    if (request.url.startsWith('/auth/')) {
      const clientHost = request.headers['x-forwarded-for'] || 
                         request.headers['x-real-ip'] || 
                         (request.ip || 'unknown');
      rateLimit(String(clientHost), request.url, config.RATE_LIMIT_PER_MINUTE);
    }
  });

  // POST /auth/register
  fastify.post<{ Body: RegisterBody }>('/auth/register', async (request, reply) => {
    try {
      const body = request.body;
      const user = await services.registerUser(db, body, config);
      
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        locale: user.locale,
        totp_enabled: Boolean(user.totp_enabled),
        approver_id: user.approver_id || null,
      };
    } catch (error) {
      if (error instanceof services.ApiError || error instanceof Error) {
        const err = error as { status?: number; code?: string; message?: string; details?: object };
        if (err.status && err.code) {
          return reply.status(err.status).send({ error: { code: err.code, message: err.message || '', details: err.details || {} }, request_id: request.id });
        }
      }
      throw error;
    }
  });

  // POST /auth/login
  fastify.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    try {
      const body = request.body;
      const email = body.email.trim().toLowerCase();
      
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as 
        | UserRow
        | undefined;
      
      // Constant-time check for unknown users
      const ok = user && !user.erased ? 
        await security.verifyPassword(body.password, user.password_hash) : 
        false;
      
      if (!user || user.erased || !ok) {
        const actor = user?.id || 'anonymous';
        appendAudit(db, actor, 'login.failed', {});
        throw apiError(401, 'UNAUTHORIZED', 'Invalid email or password');
      }
      
      const { token, ttl } = await security.createToken(user.id, user.role, config.JWT_SECRET, config.JWT_TTL_SECONDS);
      appendAudit(db, user.id, 'login.ok', {});
      
      return {
        access_token: token,
        token_type: 'bearer',
        expires_in: ttl,
        user: services.userOut(user),
      };
    } catch (error) {
      if (error instanceof services.ApiError || error instanceof Error) {
        const err = error as { status?: number; code?: string; message?: string; details?: object };
        if (err.status && err.code) {
          return reply.status(err.status).send({ error: { code: err.code, message: err.message || '', details: err.details || {} }, request_id: request.id });
        }
      }
      throw error;
    }
  });

  // POST /auth/totp/setup
  fastify.post<{ Reply: { secret: string; otpauth_uri: string } }>('/auth/totp/setup', 
    { preHandler: async (request) => requireUser(request, db, config) },
    async (request, _reply) => {
      const user = await requireUser(request, db, config);
      
      if (user.totp_enabled) {
        throw apiError(409, 'TOTP_ALREADY_ENABLED', 'TOTP already enabled');
      }
      
      const secret = security.newTotpSecret();
      user.totp_secret_enc = security.encryptSecret(secret, user.id);
      appendAudit(db, user.id, 'totp.setup_started', {});
      
      return {
        secret,
        otpauth_uri: security.totpUri(secret, user.email),
      };
    }
  );

  // POST /auth/totp/verify
  fastify.post<{ Body: TotpVerifyBody; Reply: { verified: boolean; totp_enabled: boolean } }>('/auth/totp/verify',
    { preHandler: async (request) => requireUser(request, db, config) },
    async (request, _reply) => {
      const user = await requireUser(request, db, config);
      
      if (!user.totp_secret_enc) {
        throw apiError(409, 'TOTP_NOT_STARTED', 'Call /auth/totp/setup first');
      }
      
      const enrolling = !user.totp_enabled;
      verifyUserTotp(db, user, request.body.code, enrolling);
      
      if (!user.totp_enabled) {
        db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
        appendAudit(db, user.id, 'totp.enabled', {});
      }
      
      return { verified: true, totp_enabled: true };
    }
  );
}

export default authRoutes;
