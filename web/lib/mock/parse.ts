import type { GuardianFlag, GuardianResult, ParsedFields, Payee } from "../types";

const normAmount = (s: string): string => {
  const n = s.replace(/,/g, "");
  return n.includes(".") ? (n + "00").replace(/^(\d+\.\d{2}).*$/, "$1") : `${n}.00`;
};

export function parseNotice(text: string): ParsedFields {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const language = cjk > 12 ? "zh" : "en";
  let amount: string | null = null;
  const am =
    /(?:amount due|应缴金额|应付金额|金额)\s*[:：]?\s*(?:人民币|CNY|RMB|¥|￥)?\s*([\d,]+(?:\.\d+)?)/i.exec(text) ??
    /(?:CNY|RMB|¥|￥)\s*([\d,]+(?:\.\d+)?)/i.exec(text) ??
    /([\d,]+(?:\.\d+)?)\s*元/.exec(text);
  if (am) amount = normAmount(am[1]);
  let due: string | null = null;
  const d1 = /(?:due(?: date)?|截止日期|缴费截止日期)\s*[:：]?\s*(\d{4})-(\d{2})-(\d{2})/i.exec(text) ?? /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const d2 = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
  if (d1) due = `${d1[1]}-${d1[2]}-${d1[3]}`;
  else if (d2) due = `${d2[1]}-${d2[2].padStart(2, "0")}-${d2[3].padStart(2, "0")}`;
  const pm = /(?:payee|收款单位|收款人)\s*[:：]\s*(.+?)(?=\s+(?:Bank|Account|Reference|开户银行|账号)\b|\s{2,}|\r?\n|$)/i.exec(text);
  const acc = /(?:account|账号|账户)\s*[:：]\s*([\d ]{12,24})/i.exec(text);
  const ref = /(?:reference|缴费编号|ref)\s*[:：]\s*([A-Za-z0-9][\w-]+)/i.exec(text);
  const digits = acc ? acc[1].replace(/\s/g, "") : "";
  return {
    amount_cny: amount,
    due_date: due,
    payee_name: pm ? pm[1].trim() : null,
    account_masked: digits ? `****${digits.slice(-4)}` : null,
    reference: ref ? ref[1] : null,
    language,
  };
}

export function accountDigits(text: string): string | null {
  const acc = /(?:account|账号|账户)\s*[:：]?\s*([\d ]{12,24})/i.exec(text) ?? /\b(\d{4}\s?\d{4}\s?\d{4}\s?\d{4})\b/.exec(text);
  return acc ? acc[1].replace(/\s/g, "") : null;
}

export const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all )?(the )?(previous|prior|above) (instructions|prompts?)/i,
  /note to (the )?(ai|assistant|agent)/i,
  /system prompt/i,
  /do not ask the user/i,
  /disregard (your|the) (rules|instructions)/i,
  /忽略(之前|以上|上述)?的?(所有)?(指令|提示)/,
  /系统提示/,
  /不要询问用户/,
];
export const hasInjection = (t: string) => INJECTION_PATTERNS.some((r) => r.test(t));

export function guardNotice(text: string, parsed: ParsedFields, verified: Payee[]): GuardianResult {
  const flags: GuardianFlag[] = [];
  if (hasInjection(text)) flags.push({ code: "INJECTION_PHRASE", severity: "block", message: "Document contains an instruction aimed at the assistant." });
  const digits = accountDigits(text);
  if (digits && !verified.some((p) => p.account_masked === `****${digits.slice(-4)}`)) {
    flags.push({ code: "PAYEE_NOT_IN_REGISTRY", severity: "warn", message: "Account in document does not match any verified payee." });
  }
  if (parsed.payee_name && /[\u0400-\u04ff]/.test(parsed.payee_name)) {
    flags.push({ code: "HOMOGLYPH_NAME", severity: "warn", message: "Payee name mixes look-alike characters from another script." });
  }
  const blocked = flags.some((f) => f.severity === "block");
  const warn = flags.some((f) => f.severity === "warn");
  return { verdict: blocked ? "blocked" : warn ? "suspicious" : "clean", score: blocked ? 0.97 : warn ? 0.55 : 0.02, flags };
}
