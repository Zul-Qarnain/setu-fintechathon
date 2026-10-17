// Decimal-string money helpers. Money is NEVER a JS float: values are parsed to BigInt "micro-units" (1e-6).
const SCALE = 6;
const ONE = BigInt(10) ** BigInt(SCALE);

export function toUnits(s: string): bigint {
  const m = /^(-)?(\d[\d,]*)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`Invalid decimal: ${s}`);
  const whole = BigInt(m[2].replace(/,/g, ""));
  const frac = BigInt(((m[3] ?? "") + "0".repeat(SCALE)).slice(0, SCALE));
  const v = whole * ONE + frac;
  return m[1] ? -v : v;
}

/** Format units to a plain decimal string with `dp` places (half-up rounding). */
export function fromUnits(u: bigint, dp = 2): string {
  const neg = u < BigInt(0);
  let a = neg ? -u : u;
  const drop = BigInt(10) ** BigInt(SCALE - dp);
  a = (a + drop / BigInt(2)) / drop;
  const s = a.toString().padStart(dp + 1, "0");
  const out = dp > 0 ? `${s.slice(0, -dp)}.${s.slice(-dp)}` : s;
  return neg && a !== BigInt(0) ? `-${out}` : out;
}

export const add = (a: string, b: string, dp = 2) => fromUnits(toUnits(a) + toUnits(b), dp);
export const sub = (a: string, b: string, dp = 2) => fromUnits(toUnits(a) - toUnits(b), dp);
export const mul = (a: string, rate: string, dp = 2) => fromUnits((toUnits(a) * toUnits(rate)) / ONE, dp);
export const cmp = (a: string, b: string): -1 | 0 | 1 => {
  const x = toUnits(a);
  const y = toUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const isNegative = (a: string) => toUnits(a) < BigInt(0);
export const clampZero = (a: string) => (isNegative(a) ? "0.00" : a);
export function isDecimal(s: string): boolean {
  return /^\d[\d,]*(\.\d+)?$/.test(s.trim());
}
