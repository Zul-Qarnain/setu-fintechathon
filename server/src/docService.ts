/** Document upload/confirm flow. Documents are untrusted DATA; user confirmation required. Port of backend/app/doc_service.py. */
import { createHash } from 'node:crypto';
import type { AppContext } from './app.js';
import * as guardian from './agents/guardian.js';
import * as intake from './agents/intake.js';
import { appendAudit } from './db/auditStore.js';
import type { DocumentRow, ObligationRow, PayeeRow, UserRow } from './db/schema.js';
import { nowTs } from './domain/audit.js';
import * as crypto from './domain/crypto.js';
import { Decimal } from './domain/money.js';
import { apiError } from './deps.js';
import { newId } from './ids.js';
import { createPayee, findPayeeByAccount, obligationOut } from './services.js';

const isoDate = (d: unknown): string | null =>
  d === null || d === undefined
    ? null
    : d instanceof Date
      ? d.toISOString().slice(0, 10)
      : String(d);

export function docOut(d: DocumentRow) {
  return {
    id: d.id,
    filename: d.filename,
    doc_hash: d.doc_hash,
    status: d.status,
    parsed: JSON.parse(d.parsed_json) as unknown,
    guardian: JSON.parse(d.guardian_json) as unknown,
    untrusted: true,
    synthetic: Boolean(d.synthetic),
    created_at: d.created_at,
  };
}

export function registry(ctx: AppContext, ownerId: string): [string, string, boolean][] {
  return (ctx.db.prepare('SELECT * FROM payees WHERE owner_id = ?').all(ownerId) as PayeeRow[]).map(
    (p) => [p.name, p.account_hash, p.verified_at !== null]
  );
}

export function ingest(
  ctx: AppContext,
  user: UserRow,
  filename: string,
  textIn: string,
  synthetic = true
): DocumentRow {
  const { db } = ctx;
  const text = textIn.slice(0, intake.MAX_TEXT);
  const parsed = intake.parseNotice(text);
  let verdict = guardian.scanText(text, parsed);
  verdict = guardian.merge(
    verdict,
    guardian.registryFlags(parsed.payee_name, parsed.account_number, registry(ctx, user.id))
  );
  const docHash = 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
  const parsedJson = {
    amount_cny: parsed.amount_cny !== null ? parsed.amount_cny.toFixed(2) : null,
    due_date: isoDate(parsed.due_date),
    payee_name: parsed.payee_name,
    account_masked: parsed.account_number ? '****' + parsed.account_number.slice(-4) : null,
    reference: parsed.reference,
    language: parsed.language,
  };
  const id = newId('doc');
  const status = verdict.verdict === 'blocked' ? 'blocked' : 'pending_confirmation';
  const fname = filename.slice(0, 255);
  // account number (needed at confirm) is stored encrypted with the text; never plaintext at rest
  const enc = crypto.encrypt(JSON.stringify({ text, account_number: parsed.account_number }), {
    aad: `doc:${id}`,
  });
  db.prepare(
    'INSERT INTO documents (id,owner_id,filename,doc_hash,text_enc,parsed_json,guardian_json,status,synthetic,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    user.id,
    fname,
    docHash,
    enc,
    JSON.stringify(parsedJson),
    JSON.stringify(verdict),
    status,
    synthetic ? 1 : 0,
    nowTs()
  );
  appendAudit(db, user.id, 'document.uploaded', {
    document_id: id,
    doc_hash: docHash,
    filename: fname,
  });
  if (status === 'blocked')
    appendAudit(db, user.id, 'guardian.blocked', {
      document_id: id,
      doc_hash: docHash,
      flags: verdict.flags.map((f) => f.code),
      tier: 'T4',
    });
  else if (verdict.verdict === 'suspicious')
    appendAudit(db, user.id, 'guardian.suspicious', {
      document_id: id,
      flags: verdict.flags.map((f) => f.code),
    });
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow;
}

export function getOwnedDocument(ctx: AppContext, user: UserRow, id: string): DocumentRow {
  const d = ctx.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
    DocumentRow | undefined;
  if (!d || d.owner_id !== user.id) throw apiError(404, 'NOT_FOUND', 'Document not found'); // IDOR-safe: same error for both
  return d;
}

export const docPlain = (d: DocumentRow): { text: string; account_number: string | null } =>
  JSON.parse(crypto.decrypt(d.text_enc, { aad: `doc:${d.id}` })) as {
    text: string;
    account_number: string | null;
  };

export function confirmDocument(
  ctx: AppContext,
  user: UserRow,
  id: string,
  body: {
    amount_cny: string;
    due_date: string;
    payee_name: string;
    account_number?: string | null;
    reference?: string | null;
  }
) {
  const { db } = ctx;
  const d = getOwnedDocument(ctx, user, id);
  const verdict = JSON.parse(d.guardian_json) as { flags: { code: string }[] };
  if (d.status === 'blocked') {
    appendAudit(db, user.id, 'document.confirm_blocked', {
      document_id: d.id,
      tier: 'T4',
      flags: verdict.flags.map((f) => f.code),
    });
    const seq = (db.prepare('SELECT MAX(seq) m FROM audit').get() as { m: number | null }).m;
    return {
      document: docOut(d),
      obligation: null,
      guardian: verdict,
      blocked: true,
      audit_seq: seq,
    };
  }
  if (d.status === 'confirmed')
    throw apiError(409, 'ALREADY_CONFIRMED', 'Document already confirmed');
  const parsed = JSON.parse(d.parsed_json) as Record<string, string | null>;
  const plain = docPlain(d);
  let amount: Decimal;
  try {
    amount = new Decimal(body.amount_cny);
    if (!amount.isFinite()) throw new Error('nan');
  } catch {
    throw apiError(422, 'validation_error', 'Request validation failed', {
      errors: [{ loc: ['body', 'amount_cny'], msg: 'Input should be a valid decimal' }],
    });
  }
  const parsedAmount = parsed.amount_cny ? new Decimal(parsed.amount_cny) : null;
  if (parsedAmount !== null && !amount.eq(parsedAmount)) {
    appendAudit(db, user.id, 'document.amount_mismatch', {
      document_id: d.id,
      parsed: parsedAmount.toFixed(),
      confirmed: amount.toFixed(),
    });
    throw apiError(
      409,
      'AMOUNT_MISMATCH',
      'Confirmed amount differs from the amount in the document',
      { parsed_amount_cny: parsedAmount.toFixed(2) }
    );
  }
  if (amount.lte(0)) throw apiError(422, 'validation_error', 'Amount must be positive');
  const acct = body.account_number || plain.account_number;
  let payee: PayeeRow | undefined;
  if (acct) {
    payee =
      findPayeeByAccount(ctx, user.id, acct) ??
      createPayee(ctx, user, body.payee_name, acct, '(from document, unverified)', {
        source: 'document',
      })[0];
  }
  const oblId = newId('obl');
  db.prepare(
    'INSERT INTO obligations (id,user_id,title,amount_cny,due_date,payee_id,doc_hash,reference,status) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(
    oblId,
    user.id,
    parsed.reference || body.payee_name,
    amount.toFixed(2),
    body.due_date,
    payee?.id ?? null,
    d.doc_hash,
    body.reference || parsed.reference || null,
    'open'
  );
  db.prepare("UPDATE documents SET status = 'confirmed' WHERE id = ?").run(d.id);
  const ob = db.prepare('SELECT * FROM obligations WHERE id = ?').get(oblId) as ObligationRow;
  const row = appendAudit(db, user.id, 'document.confirmed', {
    document_id: d.id,
    obligation_id: ob.id,
    amount_cny: ob.amount_cny,
    payee_id: ob.payee_id,
    payee_verified: Boolean(payee && payee.verified_at),
  });
  return {
    document: docOut(db.prepare('SELECT * FROM documents WHERE id = ?').get(d.id) as DocumentRow),
    obligation: obligationOut(ctx, ob),
    guardian: verdict,
    blocked: false,
    audit_seq: row.seq,
  };
}
