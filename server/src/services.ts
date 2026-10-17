/** Application services (business logic). Port of backend/app/services.py */

import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Decimal } from './domain/money.js';
import * as crypto from './domain/crypto.js';
import * as tokenize from './domain/tokenize.js';
import { FxService } from './domain/fx.js';
import { appendAudit } from './db/auditStore.js';
import { apiError, getCurrentTimestamp } from './deps.js';
import { hashPassword } from './security.js';
import type { Config } from './config.js';
import type { ObligationRow, PayeeRow, UserRow } from './db/schema.js';

export function userOut(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    locale: u.locale,
    totp_enabled: Boolean(u.totp_enabled),
    approver_id: u.approver_id || null,
    synthetic: true,
  };
}

export async function registerUser(db: Database.Database, body: RegisterBody, config: Config): Promise<UserRow> {
  const email = body.email.trim().toLowerCase();
  if (!email.includes('@') || email.length > 254) {
    throw apiError(422, 'validation_error', 'Invalid email');
  }
  
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
  if (existing) {
    throw apiError(409, 'EMAIL_EXISTS', 'Email already registered');
  }
  
  let approverId: string | null = null;
  if (body.approver_email) {
    const apEmail = body.approver_email.trim().toLowerCase();
    const approver = db.prepare('SELECT id, role FROM users WHERE email = ?').get(apEmail) as { id: string; role: string } | undefined;
    if (!approver || approver.role !== 'family_approver') {
      throw apiError(422, 'validation_error', 'approver_email must be a registered family_approver');
    }
    approverId = approver.id;
  }
  
  if (body.role === 'admin' && !config.DEMO_MODE) {
    throw apiError(403, 'FORBIDDEN', 'Admin accounts cannot self-register');
  }
  
  const passwordHash = await hashPassword(body.password);
  const now = getCurrentTimestamp();
  
  const userId = `usr_${randomBytes(12).toString('hex')}`;
  db.prepare(`
    INSERT INTO users (id, email, password_hash, role, locale, approver_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, email, passwordHash, body.role, body.locale, approverId, now);
  
  appendAudit(db, userId, 'user.registered', { role: body.role, locale: body.locale });
  
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
}

export function payeeOut(p: PayeeRow) {
  const verified = p.verified_at !== null && p.verified_at !== undefined;
  return {
    id: p.id,
    owner_id: p.owner_id,
    name: p.name,
    account_masked: p.account_masked,
    account_token: p.account_token,
    bank: p.bank,
    verified,
    verified_at: p.verified_at || null,
    cooling_off_until: p.cooling_off_until || null,
    created_at: p.created_at,
  };
}

export function findPayeeByAccount(db: Database.Database, ownerId: string, accountNumber: string): PayeeRow | null {
  const h = tokenize.accountHash(accountNumber);
  const stmt = db.prepare('SELECT * FROM payees WHERE owner_id = ? AND account_hash = ?');
  const result = stmt.get(ownerId, h) as PayeeRow | undefined;
  return result || null;
}

export function findPayeesByName(db: Database.Database, ownerId: string, name: string): PayeeRow[] {
  const sk = tokenize.nameSkeleton(name);
  const stmt = db.prepare('SELECT * FROM payees WHERE owner_id = ? AND name_skeleton = ?');
  return stmt.all(ownerId, sk) as PayeeRow[];
}

export function createPayee(
  db: Database.Database,
  owner: UserRow,
  name: string,
  accountNumber: string,
  bank: string,
  source: string = 'manual',
  verified: boolean = false,
  coolingHours: number | null = null,
  clockMs: number = Date.now()
): [PayeeRow, string[]] {
  /** Create a payee in the registry. Returns (payee, warnings). New payees start UNVERIFIED */
  const warnings: string[] = [];
  
  if (!tokenize.isValidAccount(accountNumber)) {
    throw apiError(422, 'INVALID_ACCOUNT', 'Account number must be 8-24 ASCII digits (no lookalike characters)');
  }
  
  const existing = findPayeeByAccount(db, owner.id, accountNumber);
  if (existing) {
    return [existing, ['ALREADY_EXISTS']];
  }
  
  let changedFrom: string | null = null;
  const normalizedName = name.trim();
  for (const other of findPayeesByName(db, owner.id, name)) {
    if (other.verified_at) {
      changedFrom = other.id;
      warnings.push('PAYEE_CHANGED');
      break;
    }
  }
  
  if (tokenize.hasHomoglyphs(name)) {
    warnings.push('HOMOGLYPH_NAME');
  }
  
  const hours = coolingHours ?? 24; // coolingOffHours default
  const nowSec = Math.floor(clockMs / 1000);
  const nowIso = new Date(clockMs).toISOString();
  const coolingOffUntil = hours ? new Date((nowSec + hours * 60) * 1000).toISOString() : null;
  
  const payeeId = `pay_${randomBytes(12).toString('hex')}`;
  
  db.prepare(`
    INSERT INTO payees (
      id, owner_id, name, name_skeleton, account_hash, account_masked, account_token, bank,
      source, verified_at, cooling_off_until, changed_from_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payeeId,
    owner.id,
    normalizedName,
    tokenize.nameSkeleton(name),
    tokenize.accountHash(accountNumber),
    tokenize.maskAccount(accountNumber),
    tokenize.accountToken(accountNumber),
    bank.trim(),
    source,
    verified ? nowIso : null,
    coolingOffUntil,
    changedFrom,
    nowIso
  );
  
  const normalizedAcc = tokenize.normalizeAccount(accountNumber);
  const enc = crypto.encrypt(normalizedAcc, { aad: `payee:${payeeId}` });
  db.prepare('UPDATE payees SET account_enc = ? WHERE id = ?').run(enc, payeeId);
  
  appendAudit(db, owner.id, 'payee.created', {
    payee_id: payeeId,
    source,
    account_token: tokenize.accountToken(accountNumber),
    changed_from: changedFrom,
    warnings,
  });
  
  const payee = db.prepare('SELECT * FROM payees WHERE id = ?').get(payeeId) as PayeeRow;
  return [payee, warnings];
}

export function payeeAccountNumber(p: PayeeRow): string {
  return crypto.decrypt(p.account_enc, { aad: `payee:${p.id}` });
}

export function verifyPayee(db: Database.Database, approver: UserRow, p: PayeeRow): PayeeRow {
  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(p.owner_id) as UserRow | undefined;
  if (!owner) {
    throw apiError(404, 'NOT_FOUND', 'Payee not found');
  }
  
  if (approver.role !== 'admin' && !(approver.role === 'family_approver' && owner.approver_id === approver.id)) {
    throw apiError(403, 'FORBIDDEN', 'Only the owner\'s linked family approver (or admin) can verify');
  }
  
  const nowIso = getCurrentTimestamp();
  db.prepare('UPDATE payees SET verified_at = ? WHERE id = ?').run(nowIso, p.id);
  
  appendAudit(db, approver.id, 'payee.verified', {
    payee_id: p.id,
    owner_id: p.owner_id,
    cooling_off_until: p.cooling_off_until || null,
  });
  
  return p;
}

export function obligationOut(o: ObligationRow, db: Database.Database) {
  const payee = o.payee_id ? db.prepare('SELECT name FROM payees WHERE id = ?').get(o.payee_id) as { name: string } | undefined : null;
  return {
    id: o.id,
    amount_cny: o.amount_cny,
    due_date: o.due_date,
    payee_id: o.payee_id,
    payee_name: payee?.name || null,
    doc_hash: o.doc_hash,
    status: o.status,
  };
}

export async function fxQuoteOut(amount: string, quoteCcy = 'BDT'): Promise<{
  pair: string;
  base: string;
  quote: string;
  rate: string;
  amount_cny: string;
  amount_converted: string;
  source: string;
  is_live: boolean;
  as_of: Date;
  cached: boolean;
  disclaimer: string;
}> {
  const svc = new FxService();
  // For fixture mode (default), convert is effectively sync via cached rates
  const [conv, r] = await svc.convert(new Decimal(amount), 'CNY', quoteCcy);
  return {
    pair: `${r.base}/${r.quote}`,
    base: r.base,
    quote: r.quote,
    rate: r.rate.toString(),
    amount_cny: amount,
    amount_converted: conv.toString(),
    source: r.source,
    is_live: r.is_live,
    as_of: r.as_of,
    cached: r.cached,
    disclaimer: r.disclaimer,
  };
}

export function parseJson(text: string | null, def?: unknown): unknown {
  return text ? JSON.parse(text) : def;
}

export function countPendingActions(db: Database.Database, user: UserRow): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) c FROM actions 
    WHERE status IN ('awaiting_approval', 'cooling_off')
    AND owner_id = ?
  `);
  
  const result = stmt.get(user.id) as { c: number };
  return result.c;
}

// Body types for API routes
export interface RegisterBody {
  email: string;
  password: string;
  role: 'student' | 'family_approver' | 'admin';
  locale: 'en' | 'zh-CN';
  approver_email?: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface TotpVerifyBody {
  code: string;
}

export interface PayeeCreateBody {
  name: string;
  account_number: string;
  bank: string;
  source?: 'manual' | 'document' | 'sms';
}

// Re-export ApiError from deps for convenience in routes
export { ApiError } from './deps.js';
