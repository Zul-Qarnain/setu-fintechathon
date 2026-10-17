/** Guardian: rules + payee registry (no ML). Flags prompt injection, scams, spoofing.
 * Pure functions; the policy engine (not the guardian) makes the final authorisation decision,
 * but a `blocked` verdict forces Tier 4.
 */

import { parseAmount } from './intake.js';
import { normalizeAccount, hasHomoglyphs as tokenizeHasHomoglyphs } from '../domain/tokenize.js';
import { Decimal } from '../domain/money.js';
import type { ParsedFields } from './intake.js';

export interface GuardianFlag {
  code: string;
  severity: 'info' | 'warn' | 'block';
  message: string;
}

export interface GuardianVerdict {
  verdict: 'clean' | 'suspicious' | 'blocked';
  score: number;
  flags: GuardianFlag[];
}

// Compile patterns once with case-insensitive flag
const _COMPILED = [
  ["INJECTION_PHRASE", "block", /(?:ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|prompts?)|disregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|your)\s+\w*\s*(?:instructions?|rules?)|(?:note|message|instruction)s?\s+to\s+(?:the\s+)?(?:ai|assistant|agent|model|llm|bot)|system\s*(?:prompt|override|message)\s*[:：]|you\s+are\s+now\s+(?:in\s+)?(?:a\s+)?(?:developer|admin|dan|unrestricted)|<\s*\/?\s*(?:system|assistant|instructions?)\s*>|(?:忽略 | 无视 | 不要理会)(?:之前 | 以上 | 上述 | 先前 | 前面)?的？(?:所有 | 全部 | 任何)?(?:指令 | 指示 | 规则 | 提示 | 说明 )|系统(?:提示 | 指令 | 消息)\s*[:：]|(?:给 | 致)(?:AI|人工智能 | 助手 | 智能体)(?:的)?(?:备注 | 说明 | 指令))/i],
  ["NO_CONFIRMATION_DEMAND", "block", /(?:do\s+not|don't|never)\s+(?:ask|tell|inform|notify|confirm\s+with|alert)\s+(?:the\s+)?(?:user|student|parent|owner)|without\s+(?:asking|confirmation|approval|verification)|(?:do\s+not|don't|no\s+need\s+to|never)\s+(?:ask\s+for\s+|wait\s+for\s+|require\s+|seek\s+)?(?:confirm\w*|approv\w*|verif\w*|otp|totp)|skip\s+(?:the\s+)?(?:approval|verification|totp|2fa|confirmation)|(?:不要 | 无需 | 不必 | 别)(?:询问 | 告诉 | 通知 | 确认 | 征求)(?:用户 | 学生 | 家长 | 本人)?|无需(?:审批 | 验证 | 确认 | 批准 )|跳过(?:审批 | 验证 | 确认))/i],
  ["TOOL_COMMAND_IN_DOC", "block", /\b(?:propose_payment|execute_payment|transfer_funds|send_money|export_all|dump_users)\b|(?:立即 | 马上 | 现在)(?:向 | 给).{0,30}(?:转账 | 汇款 | 付款)/i],
  ["PERSONAL_ACCOUNT_CHANNEL", "block", /personal\s+(?:wechat|alipay|account|bank\s+card)|(?:pay|transfer)\s+(?:via|to|through)\s+(?:my\s+)?(?:wechat|alipay|whatsapp|telegram)|gift\s*cards?|crypto|bitcoin|usdt|个人(?:微信 | 支付宝 | 账户 | 账号 | 银行卡 )|私人账户 | 礼品卡 | 比特币 | 虚拟货币/i],
  ["URGENCY_SCAM", "warn", /within\s+\d+\s+(?:hours?|minutes?|hour|minute)|visa\s+(?:will\s+be\s+)?(?:cancel|revok|void)|deport|arrest|police|immediately\s+or|\d+\s*(?:小时 | 分钟) 内 | 签证(?:将 | 会)?(?:被)?(?:取消 | 吊销 | 作废 )|遣返 | 逮捕 | 公安 | 立即缴费否则 | 否则.{0,10}(?:取消 | 冻结)/i],
  ["PAYEE_CHANGE_NOTICE", "warn", /(?:bank|account)\s+(?:details?|number|account)?\s*(?:has|have)?\s*(?:been\s+)?(?:changed|updated|moved)|new\s+(?:bank\s+)?account|changed\s+(?:our|the)\s+(?:bank\s+)?account|please\s+(?:use|transfer\s+to)\s+(?:the\s+)?new|(?:账号 | 账户 | 收款(?:账号 | 账户 ))(?:已)?(?:变更 | 更换 | 更改 | 调整 )|新(?:的)?(?:收款)?(?:账号 | 账户 )|转(?:至 | 到新)/i],
];

function _verdict(flags: GuardianFlag[]): GuardianVerdict {
  let score = 0.0;
  for (const f of flags) {
    switch (f.severity) {
      case "block": score += 0.6; break;
      case "warn": score += 0.25; break;
      case "info": score += 0.05; break;
    }
  }
  score = Math.min(score, 0.99);
  score = parseFloat(score.toFixed(2));
  if (flags.some(f => f.severity === "block")) {
    return { verdict: "blocked", score: Math.max(score, 0.9), flags };
  } else if (flags.some(f => f.severity === "warn")) {
    return { verdict: "suspicious", score, flags };
  } else {
    return { verdict: "clean", score, flags };
  }
}

export function scanText(text: string, parsed: ParsedFields | null = null): GuardianVerdict {
  const flags: GuardianFlag[] = [];
  const seen = new Set<string>();
  const norm = text.normalize('NFKC');
  
  for (const rule of _COMPILED) {
    const [code, sev, rx] = rule;
    if (!seen.has(code) && rx.test(norm)) {
      seen.add(code);
      const messages: Record<string, string> = {
        "INJECTION_PHRASE": "Document contains an instruction aimed at the assistant.",
        "NO_CONFIRMATION_DEMAND": "Content tells the assistant to bypass user confirmation or approval.",
        "TOOL_COMMAND_IN_DOC": "Document text contains a payment/tool command.",
        "PERSONAL_ACCOUNT_CHANNEL": "Payment requested to a personal account or untraceable channel.",
        "URGENCY_SCAM": "Urgency / threat wording typical of scams.",
        "PAYEE_CHANGE_NOTICE": "Notice claims the payee account has changed.",
      };
      flags.push({ code, severity: sev as GuardianFlag['severity'], message: messages[code] || "" });
    }
  }
  
  if (tokenizeHasHomoglyphs(text)) {
    flags.push({ code: "HOMOGLYPH", severity: "block", message: "Lookalike (non-ASCII) characters in names or account numbers." });
  }
  
  if (parsed !== null) {
    if (parsed.account_raw && !isValidAccount(parsed.account_raw)) {
      if (!flags.some(f => f.code === "HOMOGLYPH")) {
        flags.push({ code: "ACCOUNT_INVALID", severity: "warn", message: "Account number is malformed." });
      }
    }
    
    if (parsed.amount_cny !== null) {
      // Check summary line - simplified
      const summaryPattern = /^(?:summary|total payable|total|in words|grand total|合计 | 总计 | 大写 | 摘要)[^:：\n]*[:]:(.+)$/mi;
      const matches = [...norm.matchAll(summaryPattern)];
      for (const m of matches) {
        const other = parseAmount(m[1]);
        if (other !== null && !other.equals(parsed.amount_cny)) {
          flags.push({ code: "AMOUNT_MISMATCH", severity: "block", message: "Summary amount differs from the 'Amount due' line." });
          break;
        }
      }
    }
    
    const missing: string[] = [];
    if (parsed.amount_cny === null) missing.push("amount");
    if (parsed.due_date === null) missing.push("due_date");
    if (parsed.payee_name === null) missing.push("payee");
    if (parsed.account_raw === null) missing.push("account");
    if (missing.length > 0) {
      flags.push({ code: "FIELDS_MISSING", severity: "warn", message: `Could not parse: ${missing.join(', ')}.` });
    }
  }
  
  return _verdict(flags);
}

export function registryFlags(
  payee_name: string | null,
  account_number: string | null,
  registry: Array<[string, string, boolean]>
): GuardianFlag[] {
  if (!payee_name || !account_number) {
    return [];
  }
  
  const h = nameToHash(account_number);
  const sk = nameSkeleton(payee_name);
  
  for (const [_name, acct_hash, verified] of registry) {
    if (acct_hash === h) {
      if (verified) {
        return [];
      }
      return [{ code: "PAYEE_UNVERIFIED", severity: "warn", message: "Account matches a payee that is not yet verified." }];
    }
  }
  
  for (const [name, _h, verified] of registry) {
    if (nameSkeleton(name) === sk && verified && _plain(name) !== _plain(payee_name)) {
      return [{ code: "LOOKALIKE_PAYEE", severity: "block", message: "Payee name differs from a verified payee only by lookalike characters." }];
    }
    if (nameSkeleton(name) === sk && verified) {
      return [{ code: "PAYEE_CHANGED", severity: "warn", message: "Same payee name but a different account than the verified one." }];
    }
  }
  
  for (const [name, _h, verified] of registry) {
    if (verified && nameSkeleton(name) !== sk && _near(sk, nameSkeleton(name))) {
      return [{ code: "LOOKALIKE_PAYEE", severity: "block", message: "Payee name closely resembles a verified payee but differs." }];
    }
  }
  
  return [{ code: "PAYEE_NOT_IN_REGISTRY", severity: "warn", message: "Account is not in your payee registry." }];
}

function _plain(name: string): string {
  let s = name.normalize('NFKC').toLowerCase();
  s = s.replace(/\(.*?\)|（.*?）/gs, '');
  return s.replace(/[^\w\u4e00-\u9fff]/g, '');
}

function _near(a: string, b: string): boolean {
  if (!a || !b || Math.abs(a.length - b.length) > 2) {
    return false;
  }
  // Levenshtein distance <= 2
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
    }
    if (cur[cur.length - 1] <= 2) return true;
    prev = cur;
  }
  return prev[prev.length - 1] <= 2;
}

export function merge(verdict: GuardianVerdict, extra: GuardianFlag[]): GuardianVerdict {
  const codes = new Set(verdict.flags.map(f => f.code));
  return _verdict([...verdict.flags, ...extra.filter(f => !codes.has(f.code))]);
}

export function checkMessage(text: string): GuardianVerdict {
  return scanText(text, null);
}

function isValidAccount(raw: string): boolean {
  const n = normalizeAccount(raw);
  return /^[0-9]+$/.test(n) && n.length >= 8 && n.length <= 24 && !tokenizeHasHomoglyphs(raw);
}

function nameToHash(raw: string): string {
  const normalized = normalizeAccount(raw);
  return normalized.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0).toString(16);
}

function nameSkeleton(name: string): string {
  let s = name.replace(/[\(\)\uFF08\uFF09]/g, '').toLowerCase().replace(/\(.*?\)|（.*?）/gs, '');
  return s.replace(/[^\w\u4e00-\u9fff]/g, '');
}
