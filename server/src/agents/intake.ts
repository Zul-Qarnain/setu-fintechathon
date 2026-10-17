/* eslint-disable no-control-regex */
/** Intake: treat uploaded documents / messages as untrusted DATA; parse notices (no OCR). Text only (.txt); PDF uploads are out of scope for the TS rewrite.
 * Port of backend/app/agents/intake.py — regexes kept verbatim (Unicode-aware equivalents of Python's \d/\w/\b). */
import { Decimal } from '../domain/money.js';
import * as tokenize from '../domain/tokenize.js';

export const MAX_TEXT = 20000;

const AMOUNT_LABELS = '(?:amount due|amount|total due|应缴金额|应付金额|缴费金额|金额)';
const DUE_LABELS = '(?:due date|deadline|缴费截止日期|截止日期|到期日期|到期日)';
const PAYEE_LABELS = '(?:payee|beneficiary|pay to|收款单位|收款人|收款方)';
const ACCT_LABELS = '(?:account(?: number| no\\.?)?|账号|账户|银行账号)';
const REF_LABELS = '(?:reference|ref\\.?|缴费编号|编号|参考号)';
const ITEM_LABELS = '(?:item|description|项目|缴费项目)';
const SEP = '\\s*[:：]\\s*';

const MONTHS: Record<string, number> = Object.fromEntries(
  [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ].map((m, i) => [m, i + 1])
);

export interface ParsedFields {
  amount_cny: Decimal | null;
  due_date: string | null; // ISO YYYY-MM-DD (Python: datetime.date)
  payee_name: string | null;
  account_number: string | null; // normalised as found (may be invalid / homoglyph-laden)
  account_raw: string | null;
  reference: string | null;
  item: string | null;
  issuer: string | null;
  language: string; // en | zh | mixed | unknown
}

/** .txt decoded as UTF-8; anything else with a .pdf name is refused (no text-layer extraction in the TS build). */
export function extractText(filename: string, data: Buffer): string {
  if (filename.toLowerCase().endsWith('.pdf'))
    throw new Error('PDF uploads are not supported (paste the notice text or upload a .txt file)');
  return data.toString('utf-8').slice(0, MAX_TEXT);
}

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

export function detectLanguage(text: string): string {
  const zh = count(text, /[\u4e00-\u9fff]/g);
  const en = count(text, /[A-Za-z]/g);
  if (zh === 0 && en === 0) return 'unknown';
  if (zh && en && Math.min(zh * 3, en) > 0.15 * Math.max(zh * 3, en))
    return zh > 8 && en > 40 ? 'mixed' : zh * 3 > en ? 'zh' : 'en';
  return zh * 3 > en ? 'zh' : 'en';
}

export function parseAmount(s: string): Decimal | null {
  const m = /(\d[\d,，]*(?:\.\d{1,2})?)/.exec(s.normalize('NFKC'));
  if (!m?.[1]) return null;
  try {
    return new Decimal(m[1].replaceAll(',', '').replaceAll('，', ''));
  } catch {
    return null;
  }
}

function isoDate(y: number, mo: number, d: number): string | null {
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(2000 + (y % 400), mo, 0)).getUTCDate(); // days in month, leap rule via y mod 400
  if (d > dim) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDate(raw: string): string | null {
  const s = raw.normalize('NFKC');
  let m =
    /(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/.exec(s) ??
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/.exec(s);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(s);
  const mon = m?.[2] ? MONTHS[m[2].toLowerCase()] : undefined;
  if (m && mon) return isoDate(Number(m[3]), mon, Number(m[1]));
  return null;
}

function field(text: string, labels: string): string | null {
  const m = new RegExp(`^[ \\t]*${labels}${SEP}(.+?)\\s*$`, 'im').exec(text);
  return m?.[1] !== undefined ? m[1].trim() : null;
}

export function parseNotice(text: string): ParsedFields {
  const amountS = field(text, AMOUNT_LABELS);
  const dueS = field(text, DUE_LABELS);
  const acctRaw = field(text, ACCT_LABELS);
  const lines = text
    .split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/)
    .map((l) => l.trim())
    .filter(Boolean);
  let issuer: string | null = null;
  for (const ln of lines) {
    const up = ln.toUpperCase();
    if (
      up.includes('SYNTHETIC') &&
      [...ln].length < 90 &&
      (up.includes('NOT A REAL') || ln.includes('合成'))
    )
      continue;
    if (ln.includes('合成样例')) continue;
    issuer = ln.replace(/\s*[-–—]\s*Finance Office.*$/, '').replace(/\s*财务处.*$/, '');
    break;
  }
  return {
    amount_cny: amountS ? parseAmount(amountS) : null,
    due_date: dueS ? parseDate(dueS) : null,
    payee_name: field(text, PAYEE_LABELS),
    account_number: acctRaw ? tokenize.normalizeAccount(acctRaw) : null,
    account_raw: acctRaw,
    reference: field(text, REF_LABELS),
    item: field(text, ITEM_LABELS),
    issuer,
    language: detectLanguage(text),
  };
}

/** Wrap DATA so downstream prompts can never confuse it with instructions. */
export function wrapUntrusted(text: string): string {
  return `<untrusted source="document">\n${text.replaceAll('</untrusted>', '[/untrusted]')}\n</untrusted>`;
}
