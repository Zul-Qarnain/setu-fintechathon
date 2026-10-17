/** Audit persistence: atomic append (contiguous seq) + verify + export. Port of append_audit/verify_audit in backend/app/db.py. */
import type { Db } from './connection.js';
import { GENESIS_HASH, canonicalJSON, computeHash, nowTs, payloadHash, verifyChain, type AuditRowLike, type VerifyResult } from '../domain/audit.js';
import { redactObj } from '../domain/tokenize.js';

export type AuditRow = AuditRowLike;

export function appendAudit(db: Db, actor: string, event: string, payload: Record<string, unknown> | null = null): AuditRow {
  const clean = redactObj(payload ?? {});
  return db.transaction((): AuditRow => {
    const last = db.prepare('SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string } | undefined;
    const seq = last ? last.seq + 1 : 1;
    const prev = last ? last.hash : GENESIS_HASH;
    const ts = nowTs();
    const ph = payloadHash(clean);
    const row: AuditRow = { seq, ts, actor, event, payload_hash: ph, prev_hash: prev, hash: computeHash(seq, ts, actor, event, ph, prev), payload_json: canonicalJSON(clean) };
    db.prepare('INSERT INTO audit (seq, ts, actor, event, payload_hash, prev_hash, hash, payload_json) VALUES (@seq,@ts,@actor,@event,@payload_hash,@prev_hash,@hash,@payload_json)').run(row);
    return row;
  }).immediate();
}

export function listAudit(db: Db): AuditRow[] {
  return db.prepare('SELECT seq, ts, actor, event, payload_hash, prev_hash, hash, payload_json FROM audit ORDER BY seq').all() as AuditRow[];
}

export function verifyAudit(db: Db): VerifyResult {
  return verifyChain(listAudit(db));
}

export function auditHead(db: Db): { head_hash: string; count: number } {
  const rows = db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get() as { hash: string } | undefined;
  const c = db.prepare('SELECT COUNT(*) c FROM audit').get() as { c: number };
  return { head_hash: rows?.hash ?? GENESIS_HASH, count: c.c };
}
