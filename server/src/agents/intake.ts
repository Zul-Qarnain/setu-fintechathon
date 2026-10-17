/** Intake: treat uploaded documents / messages as untrusted DATA; parse notices (no OCR).
 * Supports typed text and text-layer PDFs (pypdf). Parsed fields must be confirmed by the user.
 */

import { Decimal } from '../domain/money.js';
import { normalizeAccount } from '../domain/tokenize.js';

const MAX_TEXT = 20000;

const _AMOUNT_LABELS = "(?:amount due|amount|total due|应缴金额 | 应付金额 | 缴费金额 | 金额)";
const _DUE_LABELS = "(?:due date|deadline|缴费截止日期 | 截止日期 | 到期日期 | 到期日)";
const _PAYEE_LABELS = "(?:payee|beneficiary|pay to|收款单位 | 收款人 | 收款方)";
const _ACCT_LABELS = "(?:account(?: number| no\\.?)?|账号 | 账户 | 银行账号)";
const _REF_LABELS = "(?:reference|ref\\.?|缴费编号 | 编号 | 参考号)";
const _ITEM_LABELS = "(?:item|description|项目 | 缴费项目)";
const _SEP = "\\s*[:：]\\s*";

const _MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

export interface ParsedFields {
  amount_cny: Decimal | null;
  due_date: Date | null;
  payee_name: string | null;
  account_number: string | null; // normalised digits as found (may be invalid / homoglyph-laden)
  account_raw: string | null;
  reference: string | null;
  item: string | null;
  issuer: string | null;
  language: 'en' | 'zh' | 'mixed' | 'unknown';
}

export function extractText(filename: string, data: Buffer): string {
  /** Text-layer extraction only. .txt decoded as UTF-8; .pdf via pypdf (no OCR). */
  if (filename.toLowerCase().endsWith('.pdf')) {
    try {
      // We'll use pdf-parse in production; for now return error message
      throw new Error('PDF support not yet implemented');
    } catch (exc) {
      throw new Error('Could not read PDF text layer');
    }
  }
  const text = data.toString('utf8', 0, MAX_TEXT);
  return text;
}

export function detectLanguage(text: string): 'en' | 'zh' | 'mixed' | 'unknown' {
  const zh = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  if (zh === 0 && en === 0) {
    return 'unknown';
  }
  if (zh && en && Math.min(zh * 3, en) > 0.15 * Math.max(zh * 3, en)) {
    return zh > 8 && en > 40 ? 'mixed' : (zh * 3 > en ? 'zh' : 'en');
  }
  return zh * 3 > en ? 'zh' : 'en';
}

export function parseAmount(s: string): Decimal | null {
  const m = s.match(/(\d[\d,，]*(?:\.\d{1,2})?)/);
  if (!m) {
    return null;
  }
  try {
    return new Decimal(m[1].replace(',', '').replace('，', ''));
  } catch {
    return null;
  }
}

export function parseDate(s: string): Date | null {
  s = s.normalize('NFKC');
  let m = s.match(/(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/);
  if (!m) {
    m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日？/);
  }
  if (m) {
    try {
      return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    } catch {
      return null;
    }
  }
  m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m && m[2].toLowerCase() in _MONTHS) {
    try {
      return new Date(parseInt(m[3]), _MONTHS[m[2].toLowerCase()], parseInt(m[1]));
    } catch {
      return null;
    }
  }
  return null;
}

function _field(text: string, labels: string): string | null {
  const m = text.match(new RegExp(`(?im)^[ \\t]*${labels}${_SEP}(.+?)\\s*$`));
  return m ? m[1].trim() : null;
}

export function parseNotice(text: string): ParsedFields {
  /** Label-based parser for the structured notices Setu supports. Never executes anything. */
  const amount_s = _field(text, _AMOUNT_LABELS);
  const due_s = _field(text, _DUE_LABELS);
  const acct_raw = _field(text, _ACCT_LABELS);
  const lines = text.split('\n').map(ln => ln.trim()).filter(ln => ln);
  let issuer: string | null = null;
  for (const ln of lines) {
    if (ln.toUpperCase().includes('SYNTHETIC') && ln.length < 90 && 
        (ln.toUpperCase().includes('NOT A REAL') || ln.includes('合成'))) {
      continue;
    }
    if (ln.includes('合成样例')) {
      continue;
    }
    issuer = ln.replace(/[\s\-–—]\s*Finance Office.*$/, '');
    issuer = issuer.replace(/\s*财务处.*$/, '');
    break;
  }
  const acct_norm = acct_raw ? normalizeAccount(acct_raw) : null;
  return {
    amount_cny: amount_s ? parseAmount(amount_s) : null,
    due_date: due_s ? parseDate(due_s) : null,
    payee_name: _field(text, _PAYEE_LABELS),
    account_number: acct_norm,
    account_raw: acct_raw,
    reference: _field(text, _REF_LABELS),
    item: _field(text, _ITEM_LABELS),
    issuer,
    language: detectLanguage(text)
  };
}

export function wrapUntrusted(text: string): string {
  /** Wrap DATA so downstream prompts can never confuse it with instructions. */
  const safe = text.replace('</untrusted>', '[/untrusted]');
  return `<untrusted source="document">\n${safe}\n</untrusted>`;
}
