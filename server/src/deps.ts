/** Request-scoped helpers: auth, roles, TOTP verification, rate limiting. Port of backend/app/deps.py. */
import type { FastifyRequest } from 'fastify';
import type { AppContext } from './app.js';
import { appendAudit } from './db/auditStore.js';
import type { UserRow } from './db/schema.js';
import { tsFromMs } from './domain/audit.js';
import { AppError } from './errors.js';
import * as security from './security.js';

export const apiError = (status: number, code: string, message: string, details: Record<string, unknown> = {}): AppError =>
  new AppError(code, message, status, details);

/** Sliding-window limiter keyed by (client, path); one instance per app. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private now: () => number = () => performance.now()) {}
  check(key: string, limit: number, windowMs = 60_000): boolean {
    const t = this.now();
    const q = (this.hits.get(key) ?? []).filter((x) => t - x <= windowMs);
    if (q.length >= limit) {
      this.hits.set(key, q);
      return false;
    }
    q.push(t);
    this.hits.set(key, q);
    return true;
  }
  reset(): void {
    this.hits.clear();
  }
}

export function rateLimit(ctx: AppContext, req: FastifyRequest): void {
  const path = req.url.split('?')[0] ?? req.url;
  if (!ctx.limiter.check(`${req.ip}:${path}`, ctx.config.RATE_LIMIT_PER_MINUTE)) throw apiError(429, 'RATE_LIMITED', 'Too many requests');
}

export async function currentUser(ctx: AppContext, req: FastifyRequest): Promise<UserRow> {
  const h = req.headers.authorization;
  if (!h || !h.toLowerCase().startsWith('bearer ')) throw apiError(401, 'UNAUTHORIZED', 'Missing bearer token');
  const token = h.slice(7).trim();
  let claims;
  try {
    claims = await security.decodeToken(token, ctx.config.JWT_SECRET);
  } catch {
    throw apiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
  const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(claims.sub) as UserRow | undefined;
  if (!user || user.erased || user.role !== claims.role) throw apiError(401, 'UNAUTHORIZED', 'Invalid token subject');
  return user;
}

export async function requireRoles(ctx: AppContext, req: FastifyRequest, ...roles: string[]): Promise<UserRow> {
  const u = await currentUser(ctx, req);
  if (!roles.includes(u.role)) throw apiError(403, 'FORBIDDEN', 'Role not permitted for this operation');
  return u;
}

/** TOTP check with replay protection and lockout. Persists failure counters even though it throws. */
export function verifyUserTotp(ctx: AppContext, user: UserRow, code: string, enrolling = false, nowMs: number = Date.now()): void {
  const { db, config } = ctx;
  if (user.totp_locked_until && Date.parse(user.totp_locked_until) > nowMs) {
    const secs = Math.floor((Date.parse(user.totp_locked_until) - nowMs) / 1000);
    throw apiError(429, 'TOTP_LOCKED', 'Too many failed TOTP attempts; try again later', { retry_after_seconds: secs });
  }
  if ((!user.totp_enabled && !enrolling) || !user.totp_secret_enc) throw apiError(403, 'TOTP_NOT_ENABLED', 'TOTP is not enabled for this user');
  const secret = security.decryptSecret(user.totp_secret_enc, user.id);
  const step = security.checkTotp(secret, code, user.totp_last_step, nowMs / 1000);
  if (step === null) {
    const failures = user.totp_failures + 1;
    appendAudit(db, user.id, 'totp.failed', { failures });
    if (failures >= config.TOTP_MAX_FAILURES) {
      db.prepare('UPDATE users SET totp_failures = 0, totp_locked_until = ? WHERE id = ?').run(tsFromMs(nowMs + config.TOTP_LOCK_SECONDS * 1000), user.id);
      appendAudit(db, user.id, 'totp.locked', { seconds: config.TOTP_LOCK_SECONDS });
    } else {
      db.prepare('UPDATE users SET totp_failures = ? WHERE id = ?').run(failures, user.id);
    }
    throw apiError(403, 'TOTP_INVALID', 'Invalid or expired TOTP code');
  }
  db.prepare('UPDATE users SET totp_failures = 0, totp_last_step = ? WHERE id = ?').run(step, user.id);
  user.totp_failures = 0;
  user.totp_last_step = step;
}
