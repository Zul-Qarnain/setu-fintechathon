import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { GENESIS_HASH, canonicalJSON, computeHash, nowTs, payloadHash, verifyChain, type AuditRowLike } from '../../src/domain/audit.js';

// Vectors produced by the real Python implementation (backend/app/domain/audit.py).
const V = JSON.parse(readFileSync(new URL('../fixtures/audit_vectors.json', import.meta.url), 'utf8')) as {
  payloads: unknown[];
  canon: string[];
  phash: string[];
  rows: AuditRowLike[];
};

describe('canonicalJSON / payloadHash match Python', () => {
  V.payloads.forEach((p, i) => {
    it(`payload ${i}`, () => {
      expect(canonicalJSON(p)).toBe(V.canon[i]);
      expect(payloadHash(p)).toBe(V.phash[i]);
    });
  });
  it('rejects floats and undefined', () => {
    expect(() => canonicalJSON({ a: 1.5 })).toThrow();
    expect(() => canonicalJSON({ a: undefined })).toThrow();
  });
});

describe('hash chain', () => {
  it('computeHash matches Python for all rows', () => {
    for (const r of V.rows) expect(computeHash(r.seq, r.ts, r.actor, r.event, r.payload_hash, r.prev_hash)).toBe(r.hash);
    expect(V.rows[0]?.prev_hash).toBe(GENESIS_HASH);
  });
  it('verifies the Python-produced chain', () => {
    expect(verifyChain(V.rows)).toEqual({ ok: true, checked: 4, broken_at_seq: null, reason: null });
  });
  it('detects edited field, edited payload, deleted row, reordered content', () => {
    const clone = () => structuredClone(V.rows);
    let r = clone();
    (r[1] as AuditRowLike).actor = 'mallory';
    expect(verifyChain(r)).toMatchObject({ ok: false, broken_at_seq: 2, reason: 'hash mismatch' });
    r = clone();
    (r[1] as AuditRowLike).payload_json = '{"x":1}';
    expect(verifyChain(r)).toMatchObject({ ok: false, broken_at_seq: 2, reason: 'payload hash mismatch' });
    r = clone();
    r.splice(1, 1);
    expect(verifyChain(r)).toMatchObject({ ok: false, broken_at_seq: 3, reason: 'sequence gap: expected 2' });
    r = clone();
    const [a, b] = [r[1] as AuditRowLike, r[2] as AuditRowLike];
    [a.seq, b.seq] = [b.seq, a.seq];
    expect(verifyChain(r).ok).toBe(false);
  });
  it('nowTs has microsecond format', () => {
    expect(nowTs()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });
  it('property: any single mutation of any row is detected', () => {
    fc.assert(
      fc.property(fc.nat(3), fc.constantFrom('actor', 'event', 'ts', 'payload_hash', 'prev_hash', 'hash', 'payload_json'), fc.string({ minLength: 1 }), (i, field, junk) => {
        const rows = structuredClone(V.rows);
        const row = rows[i] as unknown as Record<string, string>;
        if (row[field] === junk) return;
        row[field] = junk;
        expect(verifyChain(rows).ok).toBe(false);
      }),
    );
  });
});
