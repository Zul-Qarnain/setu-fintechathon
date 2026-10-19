/** Guardian: rules + payee registry (no ML). Flags prompt injection, scams, spoofing. Pure functions; a `blocked` verdict forces Tier 4.
 * Rule regexes use Unicode-aware stand-ins
 * for `\w` and `\b` (JS built-ins are ASCII-only). */
import type { Decimal } from '../domain/money.js';
import * as tokenize from '../domain/tokenize.js';
import { parseAmount, type ParsedFields } from './intake.js';

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

const W = '[\\p{L}\\p{N}_]'; // Unicode-aware \w
const BS = `(?<!${W})`; // Unicode-aware \b (start-of-word side)
const BE = `(?!${W})`; // Unicode-aware \b (end-of-word side)

const RULES: [string, GuardianFlag['severity'], string, string][] = [
  [
    'INJECTION_PHRASE',
    'block',
    'ignore\\s+(?:all\\s+|any\\s+|the\\s+)?(?:previous|prior|above|earlier)\\s+(?:instructions?|rules?|prompts?)' +
      '|disregard\\s+(?:all\\s+|any\\s+|the\\s+)?(?:previous|prior|above|your)\\s+' +
      W +
      '*\\s*(?:instructions?|rules?)' +
      '|(?:note|message|instruction)s?\\s+to\\s+(?:the\\s+)?(?:ai|assistant|agent|model|llm|bot)' +
      '|system\\s*(?:prompt|override|message)\\s*[:：]' +
      '|you\\s+are\\s+now\\s+(?:in\\s+)?(?:a\\s+)?(?:developer|admin|dan|unrestricted)' +
      '|<\\s*/?\\s*(?:system|assistant|instructions?)\\s*>' +
      '|(?:忽略|无视|不要理会)(?:之前|以上|上述|先前|前面)?的?(?:所有|全部|任何)?(?:指令|指示|规则|提示|说明)' +
      '|系统(?:提示|指令|消息)\\s*[:：]' +
      '|(?:给|致)(?:AI|人工智能|助手|智能体)(?:的)?(?:备注|说明|指令)',
    'Document contains an instruction aimed at the assistant.',
  ],
  [
    'NO_CONFIRMATION_DEMAND',
    'block',
    "(?:do\\s+not|don't|never)\\s+(?:ask|tell|inform|notify|confirm\\s+with|alert)\\s+(?:the\\s+)?(?:user|student|parent|owner)" +
      '|without\\s+(?:asking|confirmation|approval|verification)' +
      "|(?:do\\s+not|don't|no\\s+need\\s+to|never)\\s+(?:ask\\s+for\\s+|wait\\s+for\\s+|require\\s+|seek\\s+)?(?:confirm" +
      W +
      '*|approv' +
      W +
      '*|verif' +
      W +
      '*|otp|totp)' +
      '|skip\\s+(?:the\\s+)?(?:approval|verification|totp|2fa|confirmation)' +
      '|(?:不要|无需|不必|别)(?:询问|告诉|通知|确认|征求)(?:用户|学生|家长|本人)?' +
      '|无需(?:审批|验证|确认|批准)|跳过(?:审批|验证|确认)',
    'Content tells the assistant to bypass user confirmation or approval.',
  ],
  [
    'TOOL_COMMAND_IN_DOC',
    'block',
    `${BS}(?:propose_payment|execute_payment|transfer_funds|send_money|export_all|dump_users)${BE}` +
      '|(?:立即|马上|现在)(?:向|给).{0,30}(?:转账|汇款|付款)',
    'Document text contains a payment/tool command.',
  ],
  [
    'PERSONAL_ACCOUNT_CHANNEL',
    'block',
    'personal\\s+(?:wechat|alipay|account|bank\\s+card)|(?:pay|transfer)\\s+(?:via|to|through)\\s+(?:my\\s+)?(?:wechat|alipay|whatsapp|telegram)' +
      '|gift\\s*cards?|crypto|bitcoin|usdt' +
      '|个人(?:微信|支付宝|账户|账号|银行卡)|私人账户|礼品卡|比特币|虚拟货币',
    'Payment requested to a personal account or untraceable channel.',
  ],
  [
    'URGENCY_SCAM',
    'warn',
    'within\\s+\\d+\\s+(?:hours?|minutes?)|visa\\s+(?:will\\s+be\\s+)?(?:cancel|revok|void)|deport|arrest|police|immediately\\s+or' +
      '|\\d+\\s*(?:小时|分钟)内|签证(?:将|会)?(?:被)?(?:取消|吊销|作废)|遣返|逮捕|公安|立即缴费否则|否则.{0,10}(?:取消|冻结)',
    'Urgency / threat wording typical of scams.',
  ],
  [
    'PAYEE_CHANGE_NOTICE',
    'warn',
    '(?:bank|account)\\s+(?:details?|number|account)?\\s*(?:has|have)?\\s*(?:been\\s+)?(?:changed|updated|moved)' +
      '|new\\s+(?:bank\\s+)?account|changed\\s+(?:our|the)\\s+(?:bank\\s+)?account|please\\s+(?:use|transfer\\s+to)\\s+(?:the\\s+)?new' +
      '|(?:账号|账户|收款(?:账号|账户))(?:已)?(?:变更|更换|更改|调整)|新(?:的)?(?:收款)?(?:账号|账户)|转(?:至|到)新',
    'Notice claims the payee account has changed.',
  ],
];
const COMPILED = RULES.map(([c, sev, rx, msg]) => ({ c, sev, rx: new RegExp(rx, 'iu'), msg }));
const SUMMARY_LINE =
  /^[ \t]*(?:summary|total payable|total|in words|grand total|合计|总计|大写|摘要)[^:：\n]*[:：]\s*(.+)$/gimu;

const flag = (code: string, severity: GuardianFlag['severity'], message: string): GuardianFlag => ({
  code,
  severity,
  message,
});

export function scanText(text: string, parsed: ParsedFields | null = null): GuardianVerdict {
  const flags: GuardianFlag[] = [];
  const seen = new Set<string>();
  const norm = text.normalize('NFKC');
  const squeezed = norm.replace(/\s{2,}/g, ' ');
  for (const { c, sev, rx, msg } of COMPILED) {
    // collapse whitespace runs for the multi-\s rule: bounds its backtracking (ReDoS) without changing matches
    if (!seen.has(c) && rx.test(c === 'PAYEE_CHANGE_NOTICE' ? squeezed : norm)) {
      seen.add(c);
      flags.push(flag(c, sev, msg));
    }
  }
  if (tokenize.hasHomoglyphs(text))
    flags.push(
      flag('HOMOGLYPH', 'block', 'Lookalike (non-ASCII) characters in names or account numbers.')
    );
  if (parsed) {
    if (
      parsed.account_raw &&
      !tokenize.isValidAccount(parsed.account_raw) &&
      !flags.some((f) => f.code === 'HOMOGLYPH')
    ) {
      flags.push(flag('ACCOUNT_INVALID', 'warn', 'Account number is malformed.'));
    }
    if (parsed.amount_cny !== null) {
      for (const m of text.matchAll(SUMMARY_LINE)) {
        const other: Decimal | null = parseAmount(m[1] ?? '');
        if (other !== null && !other.eq(parsed.amount_cny)) {
          flags.push(
            flag('AMOUNT_MISMATCH', 'block', "Summary amount differs from the 'Amount due' line.")
          );
          break;
        }
      }
    }
    const missing = (
      [
        ['amount', parsed.amount_cny],
        ['due_date', parsed.due_date],
        ['payee', parsed.payee_name],
        ['account', parsed.account_raw],
      ] as [string, unknown][]
    )
      .filter(([, v]) => v === null)
      .map(([n]) => n);
    if (missing.length)
      flags.push(flag('FIELDS_MISSING', 'warn', `Could not parse: ${missing.join(', ')}.`));
  }
  return verdictOf(flags);
}

const WEIGHT = { block: 0.6, warn: 0.25, info: 0.05 } as const;

export function verdictOf(flags: GuardianFlag[]): GuardianVerdict {
  let score = 0;
  for (const f of flags) score += WEIGHT[f.severity];
  score = Math.round(Math.min(score, 0.99) * 100) / 100;
  if (flags.some((f) => f.severity === 'block'))
    return { verdict: 'blocked', score: Math.max(score, 0.9), flags };
  return {
    verdict: flags.some((f) => f.severity === 'warn') ? 'suspicious' : 'clean',
    score,
    flags,
  };
}

/** registry rows: [name, account_hash, verified]. Returns flags (never blocks by itself). */
export function registryFlags(
  payeeName: string | null,
  accountNumber: string | null,
  registry: [string, string, boolean][]
): GuardianFlag[] {
  if (!payeeName || !accountNumber) return [];
  const h = tokenize.accountHash(accountNumber);
  const sk = tokenize.nameSkeleton(payeeName);
  for (const [, acctHash, verified] of registry) {
    if (acctHash === h)
      return verified
        ? []
        : [flag('PAYEE_UNVERIFIED', 'warn', 'Account matches a payee that is not yet verified.')];
  }
  for (const [name, , verified] of registry) {
    if (tokenize.nameSkeleton(name) === sk && verified && plain(name) !== plain(payeeName)) {
      return [
        flag(
          'LOOKALIKE_PAYEE',
          'block',
          'Payee name differs from a verified payee only by lookalike characters.'
        ),
      ];
    }
    if (tokenize.nameSkeleton(name) === sk && verified)
      return [
        flag(
          'PAYEE_CHANGED',
          'warn',
          'Same payee name but a different account than the verified one.'
        ),
      ];
  }
  for (const [name, , verified] of registry) {
    if (verified && tokenize.nameSkeleton(name) !== sk && near(sk, tokenize.nameSkeleton(name))) {
      return [
        flag(
          'LOOKALIKE_PAYEE',
          'block',
          'Payee name closely resembles a verified payee but differs.'
        ),
      ];
    }
  }
  return [flag('PAYEE_NOT_IN_REGISTRY', 'warn', 'Account is not in your payee registry.')];
}

function plain(name: string): string {
  const s = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(.*?\)|（.*?）/gu, '');
  return s.replace(/[^\p{L}\p{N}_\u4e00-\u9fff]/gu, '');
}

/** Levenshtein distance <= 2 over code points. */
function near(a: string, b: string): boolean {
  const x = [...a],
    y = [...b];
  if (!x.length || !y.length || Math.abs(x.length - y.length) > 2) return false;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  x.forEach((ca, i0) => {
    const cur = [i0 + 1];
    y.forEach((cb, j0) => {
      cur.push(
        Math.min((prev[j0 + 1] ?? 0) + 1, (cur[j0] ?? 0) + 1, (prev[j0] ?? 0) + (ca !== cb ? 1 : 0))
      );
    });
    prev = cur;
  });
  return (prev[prev.length - 1] ?? 99) <= 2;
}

export function merge(verdict: GuardianVerdict, extra: GuardianFlag[]): GuardianVerdict {
  const codes = new Set(verdict.flags.map((f) => f.code));
  return verdictOf([...verdict.flags, ...extra.filter((f) => !codes.has(f.code))]);
}

export const checkMessage = (text: string): GuardianVerdict => scanText(text, null);
