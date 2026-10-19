/** Seed SYNTHETIC personas from data/personas.json. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from './app.js';
import { appendAudit, auditHead } from './db/auditStore.js';
import type { PayeeRow } from './db/schema.js';
import { nowTs } from './domain/audit.js';
import { Decimal } from './domain/money.js';
import { normalizeAccount } from './domain/tokenize.js';
import { newId } from './ids.js';
import { openAccount } from './sandboxBank/ledger.js';
import * as security from './security.js';
import { createPayee } from './services.js';
import type { UserRow } from './db/schema.js';

export interface Persona {
  email: string;
  password: string;
  role: string;
  locale?: string;
  display_name?: string;
  monthly_budget_cny?: string;
  sandbox_balance_cny?: string;
  approver_email?: string;
  totp_secret?: string;
  verified_payees?: { name: string; account_number: string; bank?: string }[];
  obligations?: {
    title: string;
    amount_cny: string;
    due_date: string;
    payee_name: string;
    reference?: string;
    seed?: boolean;
  }[];
}

export function loadPersonas(dataDir: string): Persona[] {
  const raw = JSON.parse(readFileSync(join(dataDir, 'personas.json'), 'utf-8')) as unknown;
  if (Array.isArray(raw)) return raw as Persona[];
  const o = raw as Record<string, Persona[]>;
  for (const k of ['users', 'personas', 'people']) if (o[k]) return o[k];
  throw new Error("personas.json: expected a list or a dict with 'users'");
}

export async function seedAll(ctx: AppContext): Promise<{
  users: number;
  obligations: number;
  auditHead: { head_hash: string; count: number };
}> {
  const { db, config } = ctx;
  const people = loadPersonas(config.dataDir);
  const byEmail = new Map<string, UserRow>();
  const ordered = [...people].sort(
    (a, b) => (a.role !== 'student' ? 0 : 1) - (b.role !== 'student' ? 0 : 1)
  ); // stable: approvers + admin first
  for (const p of ordered) {
    const id = newId('usr');
    const email = p.email.toLowerCase();
    const approver = p.approver_email ? byEmail.get(p.approver_email.toLowerCase()) : undefined;
    if (p.approver_email && !approver) throw new Error(`unknown approver ${p.approver_email}`);
    db.prepare(
      'INSERT INTO users (id,email,password_hash,role,locale,approver_id,display_name,monthly_budget_cny,totp_secret_enc,totp_enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      id,
      email,
      await security.hashPassword(p.password),
      p.role,
      p.locale ?? 'en',
      approver?.id ?? null,
      p.display_name ?? null,
      new Decimal(p.monthly_budget_cny ?? '0').toFixed(2),
      p.totp_secret ? security.encryptSecret(p.totp_secret, id) : null,
      p.totp_secret ? 1 : 0,
      nowTs()
    );
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    byEmail.set(email, u);
    appendAudit(db, id, 'user.seeded', { role: u.role, synthetic: true });
  }
  let nObl = 0;
  let idx = 0;
  for (const p of people) {
    if (p.role !== 'student') continue;
    idx += 1;
    const u = byEmail.get(p.email.toLowerCase()) as UserRow;
    let n = 0;
    openAccount(
      db,
      `62220001${String(idx).padStart(8, '0')}`,
      p.display_name ?? u.email,
      new Decimal(p.sandbox_balance_cny ?? '0').toFixed(2),
      u.id
    );
    for (const vp of p.verified_payees ?? []) {
      createPayee(ctx, u, vp.name, vp.account_number, vp.bank ?? 'Sandbox Bank', {
        source: 'manual',
        verified: true,
        coolingHours: 0,
      });
      openAccount(db, normalizeAccount(vp.account_number), vp.name, '0');
      n += 1;
    }
    for (const ob of p.obligations ?? []) {
      if (ob.seed === false) continue; // demo uploads this notice live
      const pay = (
        db.prepare('SELECT * FROM payees WHERE owner_id = ?').all(u.id) as PayeeRow[]
      ).find((q) => q.name === ob.payee_name);
      db.prepare(
        'INSERT INTO obligations (id,user_id,title,amount_cny,due_date,payee_id,reference,status) VALUES (?,?,?,?,?,?,?,?)'
      ).run(
        newId('obl'),
        u.id,
        ob.title,
        new Decimal(ob.amount_cny).toFixed(2),
        ob.due_date,
        pay?.id ?? null,
        ob.reference ?? null,
        'open'
      );
      nObl += 1;
    }
    appendAudit(db, u.id, 'persona.seeded', { payees: n, synthetic: true });
  }
  return { users: byEmail.size, obligations: nObl, auditHead: auditHead(db) };
}

/** Seeds when the users table is empty; returns the audit head (or null when already populated / no data). */
export async function seedIfEmpty(ctx: AppContext): Promise<{
  users: number;
  obligations: number;
  auditHead: { head_hash: string; count: number };
} | null> {
  const c = ctx.db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number };
  if (c.c > 0) return null;
  try {
    return await seedAll(ctx);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; // no seed data available: start empty
    throw e;
  }
}
