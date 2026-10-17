/** Fastify dependencies: auth, roles, TOTP verification, rate limiting */

import type { FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import * as security from './security.js';
import type { Config } from './config.js';
import type { UserRow } from './db/schema.js';

import { AppError } from './errors.js';

export { AppError as ApiError };

export function apiError(status: number, code: string, message: string, details: Record<string, unknown> = {}): AppError {
  return new AppError(code, message, status, details);
}

// In-memory sliding-window rate limiter keyed by (client, path-group)
class RateLimiter {
  private hits: Map<string, number[]> = new Map();

  check(key: string, limit: number, windowMs: number = 60_000): boolean {
    const now = Date.now();
    const q = this.hits.get(key) || [];
    // Remove old entries
    const validHits = q.filter((t) => now - t <= windowMs);
    
    if (validHits.length >= limit) {
      this.hits.set(key, validHits);
      return false;
    }
    
    validHits.push(now);
    this.hits.set(key, validHits);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}

const limiter = new RateLimiter();

export function rateLimit(clientHost: string, path: string, limit: number, windowMs: number = 60_000): void {
  const key = `${clientHost}:${path}`;
  if (!limiter.check(key, limit, windowMs)) {
    throw apiError(429, 'RATE_LIMITED', 'Too many requests');
  }
}

export async function requireUser(request: FastifyRequest, db: Database.Database, config: Config): Promise<UserRow> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    throw apiError(401, 'UNAUTHORIZED', 'Missing bearer token');
  }

  const parts = authHeader.split(' ', 2);
  if (parts.length < 2 || !parts[1]) {
    throw apiError(401, 'UNAUTHORIZED', 'Missing bearer token');
  }
  const token = parts[1].trim();
  if (!token) {
    throw apiError(401, 'UNAUTHORIZED', 'Missing bearer token');
  }
  
  try {
    const decoded = await security.decodeToken(token, config.JWT_SECRET);
    const userId = decoded.sub as string;
    const role = decoded.role as string;
    
    const stmt = db.prepare('SELECT * FROM users WHERE id = ? AND erased = 0');
    const user = stmt.get(userId) as UserRow | undefined;
    
    if (!user || user.erased || user.role !== role) {
      throw apiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    
    return user;
  } catch {
    throw apiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

export function requireRoles(...roles: string[]) {
  return async (request: FastifyRequest, db: Database.Database, config: Config): Promise<UserRow> => {
    const user = await requireUser(request, db, config);
    if (!roles.includes(user.role)) {
      throw apiError(403, 'FORBIDDEN', 'Role not permitted for this operation');
    }
    return user;
  };
}

export function verifyUserTotp(db: Database.Database, user: UserRow, code: string, enrolling: boolean = false, clockSec: number = Math.floor(Date.now() / 1000)): void {
  /** Check a TOTP for `user` with replay protection and brute-force lockout. Raises on failure */
  const st = { totpMaxFailures: 5, totpLockSeconds: 300 };
  const nowSec = clockSec;
  
  // Check lockout
  if (user.totp_locked_until) {
    const lockedUntil = new Date(user.totp_locked_until).getTime() / 1000;
    if (lockedUntil > nowSec) {
      throw apiError(429, 'TOTP_LOCKED', 'Too many failed TOTP attempts; try again later', {
        retryAfterSeconds: Math.ceil(lockedUntil - nowSec) 
      });
    }
  }

  if ((user.totp_enabled && !enrolling) || !user.totp_secret_enc) {
    throw apiError(403, 'TOTP_NOT_ENABLED', 'TOTP is not enabled for this user');
  }

  const secret = security.decryptSecret(user.totp_secret_enc, user.id);
  const step = security.checkTotp(secret, code, user.totp_last_step, nowSec);

  if (step === null) {
    user.totp_failures += 1;
    db.prepare('UPDATE users SET totp_failures = ? WHERE id = ?').run(user.totp_failures, user.id);
    
    if (user.totp_failures >= st.totpMaxFailures) {
      const lockedUntil = new Date((nowSec + st.totpLockSeconds) * 1000).toISOString();
      db.prepare('UPDATE users SET totp_failures = 0, totp_locked_until = ? WHERE id = ?').run(lockedUntil, user.id);
    } else {
      db.prepare('UPDATE users SET totp_failures = ? WHERE id = ?').run(user.totp_failures, user.id);
    }
    
    throw apiError(403, 'TOTP_INVALID', 'Invalid or expired TOTP code');
  }

  user.totp_failures = 0;
  user.totp_last_step = step;
  db.prepare('UPDATE users SET totp_failures = ?, totp_last_step = ? WHERE id = ?').run(user.totp_failures, user.totp_last_step, user.id);
}

export function getCurrentTimestamp(clock: number = Date.now()): string {
  /** Returns ISO string like Python's nowTs() */
  const date = new Date(clock);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0').repeat(3); // microsecond precision padding
  return `${year}-${month}-${day}T${hours}:${mins}:${secs}.${ms}Z`;
}

// Reusable preHandler that wraps requireUser for Fastify
export async function createPreHandler(config: Config, db: Database.Database) {
  return async (request: FastifyRequest) => {
    await requireUser(request, db, config);
  };
}
