/** SHA-256 hash-chained audit log: pure functions. Port of backend/app/domain/audit.py. */
import { createHash, timingSafeEqual } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

const cp = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0) as number);
function codePointCompare(a: string, b: string): number {
  const x = cp(a);
  const y = cp(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  }
  return x.length - y.length;
}

/** json.dumps(obj, sort_keys=True, separators=(',',':'), ensure_ascii=False). Floats/undefined are rejected. */
export function canonicalJSON(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(v))
        throw new Error('canonicalJSON: only safe integers allowed (money is a decimal string)');
      return String(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']';
      const o = v as Record<string, unknown>;
      return (
        '{' +
        Object.keys(o)
          .sort(codePointCompare)
          .map((k) => JSON.stringify(k) + ':' + canonicalJSON(o[k]))
          .join(',') +
        '}'
      );
    }
    default:
      throw new Error(`canonicalJSON: unsupported type ${typeof v}`);
  }
}

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const payloadHash = (payload: unknown): string => sha256hex(canonicalJSON(payload));

let lastUs = 0;
/** Microsecond-precision UTC stamp 'YYYY-MM-DDTHH:MM:SS.ffffffZ'; wall-clock based and strictly increasing within the process. */
export function nowTs(): string {
  let us = Math.floor((performance.timeOrigin + performance.now()) * 1000);
  if (us <= lastUs) us = lastUs + 1;
  lastUs = us;
  const ms = Math.floor(us / 1000);
  const frac = String(us % 1000_000).padStart(6, '0');
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, `.${frac}Z`);
}

/** Same stamp format for an arbitrary instant (ms precision, zero µs tail). */
export function tsFromMs(ms: number): string {
  return new Date(ms).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}

export function computeHash(
  seq: number,
  ts: string,
  actor: string,
  event: string,
  pHash: string,
  prevHash: string
): string {
  return sha256hex([String(seq), ts, actor, event, pHash, prevHash].join('|'));
}

export interface AuditRowLike {
  seq: number;
  ts: string;
  actor: string;
  event: string;
  payload_hash: string;
  prev_hash: string;
  hash: string;
  payload_json: string | null;
}
export interface VerifyResult {
  ok: boolean;
  checked: number;
  broken_at_seq: number | null;
  reason: string | null;
}

const eq = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function verifyChain(rows: AuditRowLike[]): VerifyResult {
  let prev = GENESIS_HASH;
  let expectedSeq: number | null = null;
  let checked = 0;
  const fail = (seq: number, reason: string): VerifyResult => ({
    ok: false,
    checked,
    broken_at_seq: seq,
    reason,
  });
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (expectedSeq !== null && row.seq !== expectedSeq)
      return fail(row.seq, `sequence gap: expected ${expectedSeq}`);
    expectedSeq = row.seq + 1;
    if (row.prev_hash !== prev) return fail(row.seq, 'prev_hash mismatch');
    if (row.payload_json !== null) {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        return fail(row.seq, 'payload not valid JSON');
      }
      if (!eq(payloadHash(payload), row.payload_hash))
        return fail(row.seq, 'payload hash mismatch');
    }
    if (
      !eq(
        computeHash(row.seq, row.ts, row.actor, row.event, row.payload_hash, row.prev_hash),
        row.hash
      )
    )
      return fail(row.seq, 'hash mismatch');
    prev = row.hash;
    checked++;
  }
  return { ok: true, checked, broken_at_seq: null, reason: null };
}
