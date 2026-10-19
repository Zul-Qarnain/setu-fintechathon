/** Reply validator: reject any reply containing numbers absent from tool outputs (anti-hallucination). */

// digits not glued to letters (so "T3"/"ACCT_7f3a" are ignored); allows 1,234.56 and 1.5
const NUM = /(?<![A-Za-z_\d.])\d[\d,]*(?:\.\d+)?/g;
const TIER = /\b(?:Tier\s*\d|T\d)\b|[T]\d\s*级/g;

function norm(tok: string): string {
  const t = tok.replaceAll(',', '');
  const dot = t.indexOf('.');
  if (dot >= 0) {
    const a = BigInt(t.slice(0, dot)).toString();
    const b = t.slice(dot + 1).replace(/0+$/, '');
    return b ? `${a}.${b}` : a;
  }
  return BigInt(t).toString();
}

/** Numeric tokens, canonicalised (commas/leading+trailing zeros). Tier labels (T3) are ignored. */
export function numbersIn(text: string): Set<string> {
  const cleaned = text.replace(TIER, ' ');
  return new Set([...cleaned.matchAll(NUM)].map((m) => norm(m[0])));
}

export function allowedNumbers(toolOutputs: unknown[], extraText = ''): Set<string> {
  const blob = JSON.stringify(toolOutputs); // Decimal.toJSON -> string
  return new Set([...numbersIn(blob), ...numbersIn(extraText)]);
}

export interface ValidationResult {
  ok: boolean;
  unsupported: string[];
}

export function validateReply(
  reply: string,
  toolOutputs: unknown[],
  userMessage = ''
): ValidationResult {
  const allowed = allowedNumbers(toolOutputs, userMessage);
  const bad = [...numbersIn(reply)].filter((n) => !allowed.has(n)).sort();
  return { ok: bad.length === 0, unsupported: bad };
}
