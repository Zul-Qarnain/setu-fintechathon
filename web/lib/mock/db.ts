import type { ActionOut, AuditEntry, DocumentOut, Obligation, Payee, Role } from "../types";

export interface MUser {
  id: string; email: string; password: string; role: Role; locale: string;
  totp_enabled: boolean; approver_id: string | null; name: string;
}
export interface MDoc extends DocumentOut { owner_id: string; obligation_id?: string }
export interface MockDb {
  users: MUser[];
  payees: Payee[];
  obligations: (Obligation & { owner_id: string; title: string })[];
  documents: MDoc[];
  actions: (ActionOut & { owner_id: string })[];
  audit: AuditEntry[];
  totpFails: Record<string, number>;
  n: number;
}

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
const mem = new Map<string, string>();
const memStore: KV = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
let injected: KV | null = null;
export function setStorage(s: KV | null) { injected = s; }
const store = (): KV => injected ?? (typeof window !== "undefined" && window.localStorage ? window.localStorage : memStore);

export const DB_KEY = "setu.mock.db";
export const FAST_KEY = "setu.mock.fastCooling";

export const DEMO_TOTP = "123456";
export const FX_RATE = "17.2000";

export const iso = (d: Date | number = Date.now()) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function coolingMs(): number {
  const v = Number(store().getItem(FAST_KEY));
  return v > 0 ? v * 1000 : 24 * 3600 * 1000;
}
export function setFastCooling(seconds: number | null) {
  store().setItem(FAST_KEY, seconds && seconds > 0 ? String(seconds) : "");
}
export function getFastCooling(): number | null {
  const v = Number(store().getItem(FAST_KEY));
  return v > 0 ? v : null;
}

export function seed(): MockDb {
  const created = iso(Date.now() - 30 * 86_400_000);
  const pw = "demo-password-123";
  const users: MUser[] = [
    { id: "usr_demo_aisha", email: "aisha@demo.setu.test", password: pw, role: "student", locale: "en", totp_enabled: true, approver_id: "usr_demo_father", name: "Aisha (BD, MSc, Shenzhen)" },
    { id: "usr_demo_father", email: "father.rahman@demo.setu.test", password: pw, role: "family_approver", locale: "en", totp_enabled: true, approver_id: null, name: "Aisha's father" },
    { id: "usr_demo_rafi", email: "rafi@demo.setu.test", password: pw, role: "student", locale: "en", totp_enabled: true, approver_id: "usr_demo_father", name: "Rafi (BD, PhD)" },
    { id: "usr_demo_admin", email: "admin@demo.setu.test", password: pw, role: "admin", locale: "en", totp_enabled: true, approver_id: null, name: "Admin" },
  ];
  const payee = (id: string, owner: string, name: string, acct: string, ok: boolean): Payee => ({
    id, owner_id: owner, name, account_masked: `****${acct.slice(-4)}`, account_token: `ACCT_${acct.slice(-4)}c2e0a1`,
    bank: "Sandbox Bank of China (SYNTHETIC)", verified: ok, verified_at: ok ? created : null, cooling_off_until: null, created_at: created,
  });
  const payees = [
    payee("pay_univ_01", "usr_demo_aisha", "Shenzhen Example University (SYNTHETIC)", "6222000000004821", true),
    payee("pay_dorm_01", "usr_demo_aisha", "Example Student Housing Office (SYNTHETIC)", "6222000000007733", true),
    payee("pay_univ_02", "usr_demo_rafi", "Shenzhen Example University (SYNTHETIC)", "6222000000004821", true),
  ];
  const hash = (c: string) => `sha256:${c.repeat(64).slice(0, 64)}`;
  const obligations = [
    { id: "obl_demo_tuition", owner_id: "usr_demo_aisha", title: "Spring 2027 tuition", amount_cny: "18500.00", due_date: addDays(135), payee_id: "pay_univ_01", payee_name: payees[0].name, doc_hash: hash("9f2c4e1a"), status: "open" },
    { id: "obl_demo_dorm", owner_id: "usr_demo_aisha", title: "Dormitory fee (Nov)", amount_cny: "1350.00", due_date: addDays(9), payee_id: "pay_dorm_01", payee_name: payees[1].name, doc_hash: hash("a71b3c9d"), status: "open" },
    { id: "obl_demo_visa", owner_id: "usr_demo_aisha", title: "Residence permit fee", amount_cny: "800.00", due_date: addDays(24), payee_id: "pay_univ_01", payee_name: payees[0].name, doc_hash: hash("c0de5eed"), status: "open" },
  ];
  return { users, payees, obligations, documents: [], actions: [], audit: [], totpFails: {}, n: 100 };
}

export function load(): MockDb {
  const raw = store().getItem(DB_KEY);
  if (raw) {
    try { return JSON.parse(raw) as MockDb; } catch { /* reseed */ }
  }
  return seed();
}
export function save(db: MockDb) { store().setItem(DB_KEY, JSON.stringify(db)); }
export function reset() { const db = seed(); save(db); return db; }
export function nextId(db: MockDb, prefix: string): string {
  db.n += 1;
  return `${prefix}_${db.n.toString(36).padStart(8, "0")}`;
}
