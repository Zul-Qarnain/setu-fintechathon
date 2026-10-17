/** Intake: treat uploaded documents / messages as untrusted DATA; parse notices (no OCR).
 * Supports typed text and text-layer PDFs (pypdf). Parsed fields must be confirmed by the user.
 */

import { Decimal } from '../domain/money.js';
import { normalizeAccount } from '../domain/tokenize.js';

export const MAX_TEXT = 20000;

const _AMOUNT_LABELS = "(?:amount due|amount|total due|应缴金额 | 应付金额 | 缴费金额 | 金额)";
const _DUE_LABELS = "(?:due date|deadline|缴费截止日期 | 截止日期 | 到期日期 | 到期日)";
const _PAYEE_LABELS = "(?:payee|beneficiary|pay to|收款单位 | 收款人 | 收款方)";
const _ACCT_LABELS = "(?:account(?: number| no\\.?)?|账号 | 账户 | 银行账号)";
const _REF_LABELS = "(?:reference|ref\\.?|缴费编号 | 编号 | 参考号)";
const _ITEM_LABELS = "(?:item|description|项目 | 缴费项目)";
const _SEP = "\\s*[:：]\\s*";

export interface ParsedFields {
  amount_cny: Decimal | null;
  due_date: Date | null;
  payee_name: string | null;
  account_number: string | null;
  account_raw: string | null;
  reference: string | null;
  item: string | null;
  issuer: string | null;
  language: 'en' | 'zh' | 'mixed' | 'unknown';
}

const _MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

export function extractText(filename: string, data: Buffer): string {
  if (filename.toLowerCase().endsWith('.pdf')) {
    throw new Error('Could not read PDF text layer');
  }
  return data.toString('utf8').slice(0, MAX_TEXT);
}

export function detectLanguage(text: string): 'en' | 'zh' | 'mixed' | 'unknown' {
  const zh = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  if (zh === 0 && en === 0) {
    return 'unknown';
  }
  if (zh > 0 && en > 0) {
    const minVal = Math.min(zh * 3, en);
    const maxVal = Math.max(zh * 3, en);
    if (minVal > 0.15 * maxVal) {
      if (zh > 8 && en > 40) {
        return 'mixed';
      }
      return zh * 3 > en ? 'zh' : 'en';
    }
  }
  return zh * 3 > en ? 'zh' : 'en';
}

export function parseAmount(s: string): Decimal | null {
  const m = s.match(/(\d[\d,，]*(?:\.\d{1,2})?)/);
  if (!m) {
    return null;
  }
  try {
    const cleaned = m[1].replace(',', '').replace('，', '');
    return new Decimal(cleaned);
  } catch {
    return null;
  }
}

export function parseDate(s: string): Date | null {
  s = s.normalize('NFKC');
  
  // Try ISO-like format: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  let m = s.match(/(\d{4})[-/.] (\d{1,2})[-/.] (\d{1,2})/);
  if (!m) {
    // Chinese format: YYYY 年 M 月 D 日
    m = s.match(/(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日？/);
  }
  if (m) {
    try {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      const day = parseInt(m[3], 10);
      return new Date(year, month, day);
    } catch {
      return null;
    }
  }
  
  // Try English format: "1 March 2027"
  m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const monthName = m[2].toLowerCase();
    if (monthName in _MONTHS) {
      try {
        const month = _MONTHS[monthName];
        const year = parseInt(m[3], 10);
        const day = parseInt(m[1], 10);
        return new Date(year, month - 1, day);
      } catch {
        return null;
      }
    }
  }
  
  return null;
}

function _field(text: string, labels: string): string | null {
  const pattern = `^[ \\t]*${labels}${_SEP}(.+?)\\s*$`;
  const m = text.match(new RegExp(pattern, 'im'));
  return m ? m[1].trim() : null;
}

export function parseNotice(text: string): ParsedFields {
  const amount_s = _field(text, _AMOUNT_LABELS);
  const due_s = _field(text, _DUE_LABELS);
  const acct_raw = _field(text, _ACCT_LABELS);
  
  const lines = text.split('\n').map(ln => ln.trim()).filter(ln => ln.length > 0);
  let issuer: string | null = null;
  
  for (const ln of lines) {
    const upper = ln.toUpperCase();
    if (upper.includes('SYNTHETIC') && ln.length < 90 && 
        (upper.includes('NOT A REAL') || ln.includes('合成'))) {
      continue;
    }
    if (ln.includes('合成样例')) {
      continue;
    }
    let parsedIssuer = ln.replace(/[\s\-–—]\s*Finance Office.*$/, '');
    parsedIssuer = parsedIssuer.replace(/\s*财务处.*$/, '');
    issuer = parsedIssuer;
    break;
  }
  
  const acct_norm = acct_raw !== null ? normalizeAccount(acct_raw) : null;
  
  return {
    amount_cny: amount_s !== null ? parseAmount(amount_s) : null,
    due_date: due_s !== null ? parseDate(due_s) : null,
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
  const safe = text.replace('</untrusted>', '[/untrusted]');
  return `<untrusted source="document">\n${safe}\n</untrusted>`;
}
