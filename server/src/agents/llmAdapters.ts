/** LLM adapter interface + the deterministic scripted planner (offline default). Port of llm_adapters.py.
 * Gemini/Groq network adapters are intentionally NOT ported (scope cut): any provider setting falls back to the scripted adapter. */
import { parseDate } from './intake.js';

export interface PlanContext {
  today: string; // ISO date
  document_id?: string | null;
  document_status?: string | null;
  locale?: string;
}
export interface LLMAdapter {
  name: string;
  mode: string; // scripted-offline
  plan(
    maskedMessage: string,
    ctx: PlanContext
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
}

const W = '[\\p{L}\\p{N}_]';
const BS = `(?<!${W})`; // Python \b start
const BE = `(?!${W})`; // Python \b end
const R = (src: string): RegExp => new RegExp(src, 'iu');

const UNSAFE = R(
  'save\\s+\\d+(?:\\.\\d+)?\\s*%|new\\s+account|skip\\s+(?:the\\s+)?(?:approval|verification|totp|2fa)|bypass|' +
    'without\\s+(?:approval|asking|verification)|export\\s+(?:all|everyone|every)|all\\s+users|ignore\\s+(?:previous|all)|' +
    'agent\\s+says|不用(?:审批|验证)|跳过(?:审批|验证)|绕过|导出(?:所有|全部)|省\\s*\\d+\\s*%|新账[号户]'
);
const PAYEE_CHANGE = R(
  'account\\s+(?:has\\s+)?(?:been\\s+)?(?:changed|updated)|(?:bank|account)\\s+details?\\s+(?:have\\s+|has\\s+)?(?:been\\s+)?changed|' +
    'changed\\s+(?:to|account)|new\\s+account\\s+(?:number|details)|账[号户](?:已)?(?:变更|更换|更改)|更换(?:了)?账[号户]|payee\\s+changed'
);
const PAY = R(
  `${BS}(?:pay|transfer|send|settle)${BE}|tuition|缴费|支付|付款|转账|交(?:学费|费)|学费`
);
const HOWMUCH = R(
  `how\\s+much|need(?:ed)?\\s+(?:in\\s+)?(?:bdt|taka)|bdt${BE}.*${BS}(?:by|before)${BE}|多少|需要.*(?:塔卡|BDT)`
);
const FX = R(`${BS}(?:rate|exchange|convert|quote)${BE}|汇率|兑换|换算`);
const FEES = R(`${BS}(?:fees?|cost|charges?|cheapest)${BE}|费用|手续费|成本`);
const BUDGET = R(`${BS}budget${BE}|预算`);
const AMOUNT = R(
  '(?:cny|rmb|¥|￥|人民币)\\s*([\\d,]+(?:\\.\\d{1,2})?)|([\\d,]+(?:\\.\\d{1,2})?)\\s*(?:cny|rmb|元|yuan)'
);
const BY = R(
  '(?:by|before|until|到|在)\\s*(\\d{1,2}\\s+[A-Za-z]+(?:\\s+\\d{4})?|\\d{4}[-/年]\\d{1,2}[-/月]\\d{1,2}日?|\\d{1,2}月\\d{1,2}日)'
);
const MONTHS = [
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
];

const validIso = (y: number, mo: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    ? dt.toISOString().slice(0, 10)
    : null;
};

/** 'by 1 March' -> next 1 March on/after today; accepts ISO, 'D Month YYYY', 'M月D日'. */
export function parseByDate(message: string, today: string): string | null {
  const m = BY.exec(message);
  if (!m) return null;
  const frag = m[1] ?? '';
  const full = parseDate(frag);
  if (full) return full;
  let mo: number, d: number;
  const m2 = /^(\d{1,2})\s+([A-Za-z]+)$/.exec(frag.trim());
  const idx = m2?.[2] ? MONTHS.indexOf(m2[2].toLowerCase()) : -1;
  if (m2 && idx >= 0) {
    mo = idx + 1;
    d = Number(m2[1]);
  } else {
    const m3 = /^(\d{1,2})月(\d{1,2})日/.exec(frag.trim());
    if (!m3) return null;
    mo = Number(m3[1]);
    d = Number(m3[2]);
  }
  const y0 = Number(today.slice(0, 4));
  for (const y of [y0, y0 + 1]) {
    const cand = validIso(y, mo, d);
    if (!cand) return null;
    if (cand >= today) return cand;
  }
  return null;
}

export function extractAmount(message: string): string | null {
  const m = AMOUNT.exec(message);
  if (!m) return null;
  return (m[1] ?? m[2] ?? '').replaceAll(',', '');
}

const firstToken = (msg: string): string | null => /ACCT_[0-9a-f]{10}/.exec(msg)?.[0] ?? null;
const plan = (
  intent: string,
  tool_calls: { tool: string; args: Record<string, unknown> }[]
): Record<string, unknown> => ({ intent, tool_calls });

export class ScriptedAdapter implements LLMAdapter {
  readonly name = 'scripted';
  readonly mode = 'scripted-offline';

  plan(msg: string, ctx: PlanContext): Record<string, unknown> {
    if (PAYEE_CHANGE.test(msg)) {
      return plan('payee_change', [
        { tool: 'propose_verify_payee', args: { account_number: firstToken(msg) } },
        { tool: 'draft_message', args: { to: 'university', purpose: 'confirm_account' } },
      ]);
    }
    if (UNSAFE.test(msg)) {
      return plan('unsafe_request', [
        {
          tool: 'propose_payment',
          args: { origin: 'model', payee_account: firstToken(msg), amount_cny: extractAmount(msg) },
        },
      ]);
    }
    if (FX.test(msg))
      return plan('quote_fx', [
        { tool: 'fx_quote', args: { amount_cny: extractAmount(msg) ?? '1000' } },
      ]);
    if (HOWMUCH.test(msg)) {
      const by = parseByDate(msg, ctx.today);
      const amt = extractAmount(msg);
      if (amt && !by)
        return plan('how_much_needed', [{ tool: 'compute_costs', args: { amount_cny: amt } }]);
      return plan('how_much_needed', [
        { tool: 'list_obligations_due', args: { by } },
        { tool: 'compute_costs', args: { amount_cny: '$list_obligations_due.total_cny' } },
      ]);
    }
    if (PAY.test(msg)) {
      if (ctx.document_id) {
        if (ctx.document_status === 'blocked')
          return plan('pay_obligation', [
            { tool: 'propose_payment', args: { document_id: ctx.document_id, origin: 'document' } },
          ]);
        return plan('pay_obligation', [
          { tool: 'get_obligation', args: { document_id: ctx.document_id } },
          { tool: 'compute_costs', args: { amount_cny: '$get_obligation.amount_cny' } },
          { tool: 'propose_payment', args: { obligation_id: '$get_obligation.obligation_id' } },
        ]);
      }
      const kw = /tuition|学费/iu.test(msg) ? 'tuition' : null;
      return plan('pay_obligation', [
        { tool: 'get_obligation', args: { keyword: kw } },
        { tool: 'compute_costs', args: { amount_cny: '$get_obligation.amount_cny' } },
        { tool: 'propose_payment', args: { obligation_id: '$get_obligation.obligation_id' } },
      ]);
    }
    if (FEES.test(msg))
      return plan('explain_fees', [
        { tool: 'compute_costs', args: { amount_cny: extractAmount(msg) ?? '1000' } },
      ]);
    if (BUDGET.test(msg)) return plan('explain_fees', [{ tool: 'budget_summary', args: {} }]);
    return plan('unknown', []);
  }
}

/** Offline-only: every provider setting resolves to the deterministic scripted adapter. */
export function getAdapter(_provider = 'scripted', _geminiKey = '', _groqKey = ''): LLMAdapter {
  return new ScriptedAdapter();
}
