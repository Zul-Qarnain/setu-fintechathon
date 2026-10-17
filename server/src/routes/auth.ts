/** /auth/* — port of backend/app/routes/auth.py */
import type { FastifyPluginAsync } from 'fastify';
import { appendAudit } from '../db/auditStore.js';
import type { UserRow } from '../db/schema.js';
import { apiError, currentUser, rateLimit, verifyUserTotp } from '../deps.js';
import { parse } from '../errors.js';
import { LoginRequest, RegisterRequest, TotpVerifyRequest } from '../schemas.js';
import * as security from '../security.js';
import { registerUser, userOut } from '../services.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));

  app.post('/register', async (req, reply) => {
    const body = parse(RegisterRequest, req.body);
    return reply.status(201).send(userOut(await registerUser(ctx, body)));
  });

  app.post('/login', async (req) => {
    const body = parse(LoginRequest, req.body);
    const user = ctx.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(body.email.trim().toLowerCase()) as UserRow | undefined;
    // do comparable work for unknown users to limit enumeration timing
    const ok = await security.verifyPassword(
      body.password,
      user ? user.password_hash : await security.hashPassword('x')
    );
    if (!user || user.erased || !ok) {
      appendAudit(ctx.db, user ? user.id : 'anonymous', 'login.failed', {});
      throw apiError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }
    const { token, ttl } = await security.createToken(
      user.id,
      user.role,
      ctx.config.JWT_SECRET,
      ctx.config.JWT_TTL_SECONDS
    );
    appendAudit(ctx.db, user.id, 'login.ok', {});
    return { access_token: token, token_type: 'bearer', expires_in: ttl, user: userOut(user) };
  });

  app.post('/totp/setup', async (req) => {
    const user = await currentUser(ctx, req);
    if (user.totp_enabled) throw apiError(409, 'TOTP_ALREADY_ENABLED', 'TOTP already enabled');
    const secret = security.newTotpSecret();
    ctx.db
      .prepare('UPDATE users SET totp_secret_enc = ? WHERE id = ?')
      .run(security.encryptSecret(secret, user.id), user.id);
    appendAudit(ctx.db, user.id, 'totp.setup_started', {});
    return { secret, otpauth_uri: security.totpUri(secret, user.email) };
  });

  app.post('/totp/verify', async (req) => {
    const user = await currentUser(ctx, req);
    const body = parse(TotpVerifyRequest, req.body);
    if (!user.totp_secret_enc)
      throw apiError(409, 'TOTP_NOT_STARTED', 'Call /auth/totp/setup first');
    verifyUserTotp(ctx, user, body.code, !user.totp_enabled);
    if (!user.totp_enabled) {
      ctx.db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
      appendAudit(ctx.db, user.id, 'totp.enabled', {});
    }
    return { verified: true, totp_enabled: true };
  });
};
