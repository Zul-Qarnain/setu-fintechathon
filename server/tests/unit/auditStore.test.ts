import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/connection.js';
import { createSchema } from '../../src/db/schema.js';
import { appendAudit, auditHead, listAudit, verifyAudit } from '../../src/db/auditStore.js';

const fresh = () => {
  const db = openDb(':memory:');
  createSchema(db);
  return db;
};

describe('audit store', () => {
  it('appends contiguous hash-chained rows and verifies', () => {
    const db = fresh();
    for (let i = 0; i < 5; i++) appendAudit(db, 'usr_1', `evt.${i}`, { i });
    expect(listAudit(db).map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(verifyAudit(db)).toMatchObject({ ok: true, checked: 5 });
    expect(auditHead(db)).toMatchObject({ count: 5 });
  });
  it('redacts PII before hashing/storing', () => {
    const db = fresh();
    const r = appendAudit(db, 'usr_1', 'x', { to: '6222000000004821', mail: 'a@b.com' });
    expect(r.payload_json).not.toContain('6222000000004821');
    expect(r.payload_json).toContain('****4821');
    expect(r.payload_json).toContain('[EMAIL]');
  });
  it('detects tampering with payload, field and deletion', () => {
    const db = fresh();
    for (let i = 0; i < 4; i++) appendAudit(db, 'usr_1', `evt.${i}`, { i });
    db.prepare("UPDATE audit SET actor='mallory' WHERE seq=3").run();
    expect(verifyAudit(db)).toMatchObject({ ok: false, broken_at_seq: 3, reason: 'hash mismatch' });
    db.prepare("UPDATE audit SET actor='usr_1' WHERE seq=3").run();
    expect(verifyAudit(db).ok).toBe(true);
    db.prepare('DELETE FROM audit WHERE seq=2').run();
    expect(verifyAudit(db)).toMatchObject({ ok: false, broken_at_seq: 3 });
  });
  it('empty chain verifies; head is genesis', () => {
    const db = fresh();
    expect(verifyAudit(db)).toMatchObject({ ok: true, checked: 0 });
    expect(auditHead(db).head_hash).toBe('0'.repeat(64));
  });
});
