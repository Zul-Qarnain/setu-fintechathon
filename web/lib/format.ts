// Intl-based formatting. Money arrives as decimal STRINGS; Intl accepts strings (exact) so no parseFloat.
type Intlish = Intl.NumberFormat;
const cnyFmt: Intlish = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" });
const bdtFmt: Intlish = new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT" });

const fmt = (f: Intlish, v: string) => f.format(v as unknown as number);

/** CNY always uses the zh-CN convention (¥18,500.00) in every UI language. */
export const formatCny = (v: string | null | undefined) => (v == null || v === "" ? "—" : fmt(cnyFmt, v.replace(/,/g, "")));
/** BDT via en-BD (৳ with Bengali-style grouping for en-BD). */
export const formatBdt = (v: string | null | undefined) => (v == null || v === "" ? "—" : fmt(bdtFmt, v.replace(/,/g, "")));

const toLocaleTag = (locale: string) => (locale === "zh-CN" ? "zh-CN" : "en-GB");

export function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(toLocaleTag(locale), { year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(toLocaleTag(locale), {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(d);
}

export function daysUntil(isoDate: string, now: number = Date.now()): number {
  const due = new Date(`${isoDate.slice(0, 10)}T00:00:00`).getTime();
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((due - start) / 86_400_000);
}

export interface Remaining {
  done: boolean;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}
export function timeRemaining(iso: string, now: number = Date.now()): Remaining {
  const ms = new Date(iso).getTime() - now;
  if (!(ms > 0)) return { done: true, hours: 0, minutes: 0, seconds: 0, totalMs: 0 };
  const s = Math.floor(ms / 1000);
  return { done: false, hours: Math.floor(s / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60, totalMs: ms };
}
export const pad2 = (n: number) => String(n).padStart(2, "0");
export const shortHash = (h: string, n = 10) => (h.length > n * 2 + 1 ? `${h.slice(0, n)}…${h.slice(-6)}` : h);
