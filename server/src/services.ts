/** Business logic shared by routes. Port of backend/app/services.py. Timestamps are TEXT 'YYYY-MM-DDTHH:MM:SS.ffffffZ'. */
import type { AppContext } from './app.js';
import { appendAudit } from './db/auditStore.js';
import type { ObligationRow, PayeeRow, UserRow } from './db/schema.js';
import { nowTs, tsFromMs } from './domain/audit.js';
import * as crypto from './domain/crypto.js';
import { Decimal } from './domain/money.js';
import * as tokenize from './domain/tokenize.js';
import { apiError } from './deps.js';
import { newId } from './ids.js';
import * as security from './security.js';
import type { z } from 'zod';
import type { RegisterRequest } from './schemas.js';

export const userOut = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  locale: u.locale,
  totp_enabled: Boolean(u.totp_enabled),
  approver_id: u.approver_id,
  synthetic: true,
});

export async function registerUser(
  ctx: AppContext,
  body: z.infer<typeof RegisterRequest>
): Promise<UserRow> {
  const { db, config } = ctx;
  const email = body.email.trim().toLowerCase();
  if (!email.includes('@') || email.length > 254)
    throw apiError(422, 'validation_error', 'Invalid email');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    throw apiError(409, 'EMAIL_EXISTS', 'Email already registered');
  let approverId: string | null = null;
  if (body.approver_email) {
    const ap = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(body.approver_email.trim().toLowerCase()) as UserRow | undefined;
    if (!ap || ap.role !== 'family_approver')
      throw apiError(
        422,
        'validation_error',
        'approver_email must be a registered family_approver'
      );
    approverId = ap.id;
  }
  if (body.role === 'admin' && !config.DEMO_MODE)
    throw apiError(403, 'FORBIDDEN', 'Admin accounts cannot self-register');
  const hash = await security.hashPassword(body.password);
  const id = newId('usr');
  db.prepare(
    'INSERT INTO users (id,email,password_hash,role,locale,approver_id,created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, email, hash, body.role, body.locale, approverId, nowTs());
  appendAudit(db, id, 'user.registered', { role: body.role, locale: body.locale });
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
}

export const payeeOut = (p: PayeeRow) => ({
  id: p.id,
  owner_id: p.owner_id,
  name: p.name,
  account_masked: p.account_masked,
  account_token: p.account_token,
  bank: p.bank,
  verified: p.verified_at !== null,
  verified_at: p.verified_at,
  cooling_off_until: p.cooling_off_until,
  created_at: p.created_at,
});

export function findPayeeByAccount(
  ctx: AppContext,
  ownerId: string,
  account: string
): PayeeRow | undefined {
  return ctx.db
    .prepare('SELECT * FROM payees WHERE owner_id = ? AND account_hash = ?')
    .get(ownerId, tokenize.accountHash(account)) as PayeeRow | undefined;
}

export function findPayeesByName(ctx: AppContext, ownerId: string, name: string): PayeeRow[] {
  return ctx.db
    .prepare('SELECT * FROM payees WHERE owner_id = ? AND name_skeleton = ?')
    .all(ownerId, tokenize.nameSkeleton(name)) as PayeeRow[];
}

export interface CreatePayeeOpts {
  source?: string;
  verified?: boolean;
  coolingHours?: number | null;
  nowMs?: number;
}

/** Creates an UNVERIFIED payee (unless opts.verified). Returns [row, warnings]. */
export function createPayee(
  ctx: AppContext,
  owner: UserRow,
  name: string,
  account: string,
  bank: string,
  opts: CreatePayeeOpts = {}
): [PayeeRow, string[]] {
  const { db, config } = ctx;
  const source = opts.source ?? 'manual';
  const warnings: string[] = [];
  if (!tokenize.isValidAccount(account))
    throw apiError(
      422,
      'INVALID_ACCOUNT',
      'Account number must be 8-24 ASCII digits (no lookalike characters)'
    );
  const existing = findPayeeByAccount(ctx, owner.id, account);
  if (existing) return [existing, ['ALREADY_EXISTS']];
  let changedFrom: string | null = null;
  for (const other of findPayeesByName(ctx, owner.id, name)) {
    if (other.verified_at !== null) {
      changedFrom = other.id;
      warnings.push('PAYEE_CHANGED');
      break;
    }
  }
  if (tokenize.hasHomoglyphs(name)) warnings.push('HOMOGLYPH_NAME');
  const hours = opts.coolingHours ?? config.COOLING_OFF_HOURS;
  const nowMs = opts.nowMs ?? Date.now();
  const id = newId('pay');
  const ts = nowTs();
  db.prepare(
    `INSERT INTO payees (id,owner_id,name,name_skeleton,account_hash,account_enc,account_masked,account_token,bank,source,verified_at,cooling_off_until,changed_from_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    owner.id,
    name.trim(),
    tokenize.nameSkeleton(name),
    tokenize.accountHash(account),
    crypto.encrypt(tokenize.normalizeAccount(account), { aad: `payee:${id}` }),
    tokenize.maskAccount(account),
    tokenize.accountToken(account),
    bank.trim(),
    source,
    opts.verified ? ts : null,
    hours ? tsFromMs(nowMs + hours * 3_600_000) : null,
    changedFrom,
    ts
  );
  appendAudit(db, owner.id, 'payee.created', {
    payee_id: id,
    source,
    account_token: tokenize.accountToken(account),
    changed_from: changedFrom,
    warnings,
  });
  return [db.prepare('SELECT * FROM payees WHERE id = ?').get(id) as PayeeRow, warnings];
}

export const payeeAccountNumber = (p: PayeeRow): string =>
  crypto.decrypt(p.account_enc, { aad: `payee:${p.id}` });

export function verifyPayee(ctx: AppContext, approver: UserRow, p: PayeeRow): PayeeRow {
  const owner = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(p.owner_id) as
    UserRow | undefined;
  if (!owner) throw apiError(404, 'NOT_FOUND', 'Payee not found');
  if (
    approver.role !== 'admin' &&
    !(approver.role === 'family_approver' && owner.approver_id === approver.id)
  ) {
    throw apiError(
      403,
      'FORBIDDEN',
      "Only the owner's linked family approver (or admin) can verify"
    );
  }
  ctx.db.prepare('UPDATE payees SET verified_at = ? WHERE id = ?').run(nowTs(), p.id);
  appendAudit(ctx.db, approver.id, 'payee.verified', {
    payee_id: p.id,
    owner_id: p.owner_id,
    cooling_off_until: p.cooling_off_until,
  });
  return ctx.db.prepare('SELECT * FROM payees WHERE id = ?').get(p.id) as PayeeRow;
}

export function obligationOut(ctx: AppContext, o: ObligationRow) {
  const payee = o.payee_id
    ? (ctx.db.prepare('SELECT name FROM payees WHERE id = ?').get(o.payee_id) as
        { name: string } | undefined)
    : undefined;
  return {
    id: o.id,
    amount_cny: new Decimal(o.amount_cny).toFixed(2),
    due_date: o.due_date,
    payee_id: o.payee_id,
    payee_name: payee?.name ?? null,
    doc_hash: o.doc_hash,
    status: o.status,
  };
}

export async function fxQuoteOut(ctx: AppContext, amount: string, quoteCcy = 'BDT') {
  const [conv, r] = await ctx.fx.convert(new Decimal(amount), 'CNY', quoteCcy);
  return {
    pair: `${r.base}/${r.quote}`,
    base: r.base,
    quote: r.quote,
    rate: r.rate.toFixed(4),
    amount_cny: amount,
    amount_converted: conv.toFixed(2),
    source: r.source,
    is_live: r.is_live,
    as_of: r.as_of.toISOString(),
    cached: r.cached,
    disclaimer: r.disclaimer,
  };
}

export const parseJson = (text: string | null, def: unknown = null): unknown =>
  text ? JSON.parse(text) : def;

export function countPendingActions(ctx: AppContext, user: UserRow): number {
  const { db } = ctx;
  const st = "status IN ('awaiting_approval','cooling_off')";
  if (user.role === 'family_approver') {
    const ids = (
      db.prepare('SELECT id FROM users WHERE approver_id = ?').all(user.id) as { id: string }[]
    ).map((r) => r.id);
    if (!ids.length) return 0;
    return (
      db
        .prepare(
          `SELECT COUNT(*) c FROM actions WHERE ${st} AND owner_id IN (${ids.map(() => '?').join(',')})`
        )
        .get(...ids) as { c: number }
    ).c;
  }
  return (
    db.prepare(`SELECT COUNT(*) c FROM actions WHERE ${st} AND owner_id = ?`).get(user.id) as {
      c: number;
    }
  ).c;
}
