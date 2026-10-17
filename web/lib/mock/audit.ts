import type { AuditEntry, AuditVerify } from "../types";
import { iso, type MockDb } from "./db";

export async function sha256Hex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
const ZERO = "0".repeat(64);
const entryHash = (prev: string, seq: number, ts: string, actor: string, event: string, ph: string) =>
  sha256Hex(`${prev}|${seq}|${ts}|${actor}|${event}|${ph}`);

export async function appendAudit(db: MockDb, actor: string, event: string, payload: Record<string, unknown>): Promise<number> {
  const prev = db.audit[db.audit.length - 1];
  const seq = (prev?.seq ?? 0) + 1;
  const ts = iso();
  const payload_hash = await sha256Hex(canonical(payload));
  const prev_hash = prev?.hash ?? ZERO;
  const hash = await entryHash(prev_hash, seq, ts, actor, event, payload_hash);
  const e: AuditEntry = { seq, ts, actor, event, payload_hash, prev_hash, hash, payload };
  db.audit.push(e);
  return seq;
}

export async function verifyChain(entries: AuditEntry[]): Promise<AuditVerify> {
  let prev = ZERO;
  for (const e of entries) {
    if (e.prev_hash !== prev) return { ok: false, checked: e.seq - 1, broken_at_seq: e.seq, reason: "prev_hash mismatch" };
    const ph = await sha256Hex(canonical(e.payload));
    if (ph !== e.payload_hash) return { ok: false, checked: e.seq - 1, broken_at_seq: e.seq, reason: "hash mismatch" };
    const h = await entryHash(e.prev_hash, e.seq, e.ts, e.actor, e.event, e.payload_hash);
    if (h !== e.hash) return { ok: false, checked: e.seq - 1, broken_at_seq: e.seq, reason: "hash mismatch" };
    prev = e.hash;
  }
  return { ok: true, checked: entries.length, broken_at_seq: null, reason: null };
}
