/** Seed SYNTHETIC personas from data/personas.json. Port of backend/app/seed.py */

import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { Db } from './db/connection.js';
import { appendAudit } from './db/auditStore.js';
import { hashPassword } from './security.js';
import { openAccount } from './sandboxBank/ledger.js';
import { normalizeAccount } from './domain/tokenize.js';
import { newId } from './ids.js';
import { encrypt as encryptData } from './domain/crypto.js';
import { GENESIS_HASH } from './domain/audit.js';

interface PersonaRaw {
  email: string;
  password: string;
  role: string;
  locale: string;
  display_name?: string;
  monthly_budget_cny?: string;
  sandbox_balance_cny?: string;
  approver_email?: string;
  totp_secret?: string;
  verified_payees?: Array<{ name: string; account_number: string; bank: string }>;
  obligations?: Array<{
    title: string;
    amount_cny: string;
    due_date: string;
    payee_name: string;
    reference?: string;
    seed: boolean;
  }>;
  synthetic?: boolean;
}

const DATA_DIR = process.env.SETU_DATA_DIR ?? resolve(import.meta.dirname, '../../data');

export async function loadPersonas(): Promise<PersonaRaw[]> {
  const raw = JSON.parse(await readFile(resolve(DATA_DIR, 'personas.json'), 'utf-8'));
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of ['users', 'personas', 'people'] as const) {
      if (key in raw && Array.isArray(raw[key])) {
        return raw[key] as PersonaRaw[];
      }
    }
    throw new Error('personas.json: expected a list or a dict with users');
  }
  return raw as PersonaRaw[];
}

async function createUser(db: Db, p: PersonaRaw, approverId: string | null): Promise<string> {
  const userId = newId('usr');
  db.prepare(
    'INSERT INTO users (id, email, password_hash, role, locale, approver_id, display_name, monthly_budget_cny, totp_secret_enc, totp_enabled) VALUES (@id,@email,@password_hash,@role,@locale,@approver_id,@display_name,@monthly_budget_cny,@totp_secret_enc,@totp_enabled)',
  ).run({
    id: userId,
    email: p.email.toLowerCase(),
    password_hash: await hashPassword(p.password),
    role: p.role,
    locale: p.locale,
    approver_id: approverId,
    display_name: p.display_name ?? null,
    monthly_budget_cny: (p.monthly_budget_cny ?? '0.00').toString(),
    totp_secret_enc: p.totp_secret ? encryptData(p.totp_secret, { aad: `totp:${userId}` }) : null,
    totp_enabled: p.totp_secret ? 1 : 0,
  });
  appendAudit(db, userId, 'user.seeded', { role: p.role, synthetic: true });
  return userId;
}

export async function seedAll(db: Db): Promise<{ users: number; obligations: number; auditHead: { head_hash: string; count: number } }> {
  const personas = await loadPersonas();
  const byEmail: Map<string, string> = new Map();

  // Sort: approvers + admin first, then students
  const sorted = personas.slice().sort((a, _b) => (a.role === 'student' ? 1 : -1));

  // Create non-students first
  for (const p of sorted) {
    if (p.role === 'student') continue;
    const approverId = p.approver_email ? byEmail.get(p.approver_email.toLowerCase()) ?? null : null;
    const userId = await createUser(db, p, approverId);
    byEmail.set(p.email.toLowerCase(), userId);
  }

  let nObligations = 0;
  let studentIdx = 0;

  // Create students
  for (const p of personas) {
    if (p.role !== 'student') continue;

    studentIdx += 1;
    const approverId = p.approver_email ? byEmail.get(p.approver_email.toLowerCase()) ?? null : null;
    const userId = await createUser(db, p, approverId);
    byEmail.set(p.email.toLowerCase(), userId);

    // Student's own sandbox account
    const accountNumber = `62220001${String(studentIdx).padStart(8, '0')}`;
    openAccount(db, accountNumber, p.display_name ?? p.email, p.sandbox_balance_cny ?? '0', userId);

    // Create verified payees
    let nPayees = 0;
    for (const vp of p.verified_payees ?? []) {
      createPayeeSync(db, userId, vp.name, vp.account_number, vp.bank, 'manual', true, 0);
      openAccount(db, normalizeAccount(vp.account_number), vp.name, '0', null);
      nPayees++;
    }

    // Create obligations
    for (const ob of p.obligations ?? []) {
      if (ob.seed === false) continue;

      const payeeId = findPayeeByOwnerAndName(db, userId, ob.payee_name);

      db.prepare(
        'INSERT INTO obligations (id, user_id, title, amount_cny, due_date, payee_id, reference, status) VALUES (@id,@user_id,@title,@amount_cny,@due_date,@payee_id,@reference,@status)',
      ).run({
        id: newId('obl'),
        user_id: userId,
        title: ob.title,
        amount_cny: ob.amount_cny,
        due_date: ob.due_date,
        payee_id: payeeId ?? null,
        reference: ob.reference ?? null,
        status: 'open',
      });

      nObligations++;
    }

    appendAudit(db, userId, 'persona.seeded', { payees: nPayees, synthetic: true });
  }

  const auditHeadResult = auditHead(db);
  return { users: byEmail.size, obligations: nObligations, auditHead: auditHeadResult };
}

export async function seedIfEmpty(db: Db): Promise<{ auditHead: { head_hash: string; count: number } } | null> {
  const stmt = db.prepare('SELECT COUNT(*) c FROM users');
  const result = stmt.get() as { c: number };
  if (result.c > 0) return null;

  try {
    const result = await seedAll(db);
    return { auditHead: result.auditHead };
  } catch {
    return null;
  }
}

function createPayeeSync(db: Db, ownerId: string, name: string, accountNumber: string, bank: string, source: string, verified: boolean, coolingHours: number): void {
  const now = new Date().toISOString();
  const coolingOffUntil = coolingHours > 0 ? new Date(Date.now() + coolingHours * 3600 * 1000).toISOString() : null;
  const verifiedAt = verified ? now : null;

  const payeeId = newId('pay');
  const normAcc = normalizeAccount(accountNumber);
  const skeleton = name.toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]/g, '');
  const masked = '*'.repeat(8) + accountNumber.replace(/\s/g, '').slice(-4);
  const token = randomBytes(16).toString('hex');

  db.prepare(
    'INSERT INTO payees (id, owner_id, name, name_skeleton, account_hash, account_enc, account_masked, account_token, bank, source, verified_at, cooling_off_until, changed_from_id) VALUES (@id,@owner_id,@name,@name_skeleton,@account_hash,@account_enc,@account_masked,@account_token,@bank,@source,@verified_at,@cooling_off_until,@changed_from_id)',
  ).run({
    id: payeeId,
    owner_id: ownerId,
    name: name.trim(),
    name_skeleton: skeleton,
    account_hash: createHash('sha256').update(accountNumber).digest('hex'),
    account_enc: '',
    account_masked: masked,
    account_token: token,
    bank: bank.trim(),
    source: source,
    verified_at: verifiedAt,
    cooling_off_until: coolingOffUntil,
    changed_from_id: null,
  });

  db.prepare('UPDATE payees SET account_enc = ? WHERE id = ?').run(encryptData(normAcc, { aad: `payee:${payeeId}` }), payeeId);
}

function findPayeeByOwnerAndName(db: Db, ownerId: string, name: string): string | null {
  const skeleton = name.toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]/g, '');
  const stmt = db.prepare('SELECT id FROM payees WHERE owner_id = ? AND name_skeleton = ?');
  const result = stmt.get(ownerId, skeleton) as { id: string } | undefined;
  return result?.id ?? null;
}

function auditHead(db: Db): { head_hash: string; count: number } {
  const rows = db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get() as { hash: string } | undefined;
  const c = db.prepare('SELECT COUNT(*) c FROM audit').get() as { c: number };
  return { head_hash: rows?.hash ?? GENESIS_HASH, count: c.c };
}
