/** HMAC tokenisation, normalisation and PII redaction. Port of backend/app/domain/tokenize.py. */
import { getHmacKey } from './keys.js';
import { hmacSha256Hex } from './crypto.js';

// Characters that look like ASCII letters/digits but are not (Cyrillic/Greek/fullwidth etc.).
const CONFUSABLES: Record<string, string> = Object.fromEntries(
  (
    'а:a е:e о:o р:p с:c у:y х:x і:i ј:j ѕ:s һ:h ԁ:d ɡ:g ո:n А:A В:B Е:E К:K М:M Н:H О:O Р:P С:C Т:T Х:X І:I Ѕ:S ' +
    'α:a ο:o ν:v ρ:p Ο:O Α:A Β:B Ε:E Ι:I Κ:K Μ:M Ν:N Τ:T Χ:X Υ:Y Ζ:Z'
  )
    .split(' ')
    .map(
      (p) => [p.slice(0, p.lastIndexOf(':')), p.slice(p.lastIndexOf(':') + 1)] as [string, string]
    )
);
const LOOKALIKE: Record<string, string> = { '1': 'l', '0': 'o', '5': 's', '3': 'e', '@': 'a' };

// Python's \w is Unicode-aware: use \p{L}\p{N}_ with the u flag.
const ACCT_RE = /(?<![\p{L}\p{N}_])(?:\d[ -]?){12,19}(?![\p{L}\p{N}_])/gu;
const EMAIL_RE = /[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu;
const PHONE_RE = /(?<!\d)(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)/g;

const key = (): Buffer => Buffer.from(getHmacKey(), 'utf8');

/** NFKC-fold (fullwidth digits -> ASCII), strip separators. */
export const normalizeAccount = (raw: string): string =>
  raw.normalize('NFKC').replace(/[\s\-_.]/g, '');

export function hasHomoglyphs(raw: string): boolean {
  for (const ch of raw) {
    if (ch in CONFUSABLES) return true;
    const c = ch.codePointAt(0) as number;
    if (
      (c >= 0xff10 && c <= 0xff19) ||
      (c >= 0xff21 && c <= 0xff3a) ||
      (c >= 0xff41 && c <= 0xff5a)
    )
      return true;
  }
  return false;
}

export function isValidAccount(raw: string): boolean {
  const n = normalizeAccount(raw);
  return /^[0-9]+$/.test(n) && n.length >= 8 && n.length <= 24 && !hasHomoglyphs(raw);
}

export const accountHash = (raw: string): string =>
  hmacSha256Hex(key(), 'acct:' + normalizeAccount(raw));
export const accountToken = (raw: string): string => 'ACCT_' + accountHash(raw).slice(0, 10);

export function maskAccount(raw: string): string {
  const n = normalizeAccount(raw);
  return n.length >= 4 ? '****' + n.slice(-4) : '****';
}

/** Confusable-folded, case-folded, punctuation-free form for lookalike comparison. */
export function nameSkeleton(name: string): string {
  let s = Array.from(name, (ch) => CONFUSABLES[ch] ?? ch).join('');
  s = s.normalize('NFKC').toLowerCase().replace(/[ßẞ]/g, 'ss'); // ~ str.casefold()
  s = s.replace(/\(.*?\)|（.*?）/gs, '');
  s = Array.from(s, (ch) => LOOKALIKE[ch] ?? ch).join('');
  return s.replace(/[^a-z\u4e00-\u9fff]/g, '');
}

export const nameToken = (name: string): string =>
  'NAME_' + hmacSha256Hex(key(), 'name:' + nameSkeleton(name)).slice(0, 10);

/** Replace account-number-like sequences with tokens. Returns [text, token->masked map]. */
export function tokenizeText(text: string): [string, Record<string, string>] {
  const mapping: Record<string, string> = {};
  const out = text.replace(ACCT_RE, (m) => {
    const tok = accountToken(m);
    mapping[tok] = maskAccount(m);
    return tok;
  });
  return [out, mapping];
}

export function redactPii(text: string): string {
  return text
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(PHONE_RE, '[PHONE]')
    .replace(ACCT_RE, (m) => maskAccount(m));
}

export function redactObj(obj: unknown): unknown {
  if (typeof obj === 'string') return redactPii(obj);
  if (Array.isArray(obj)) return obj.map(redactObj);
  if (obj !== null && typeof obj === 'object')
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, redactObj(v)])
    );
  return obj;
}
