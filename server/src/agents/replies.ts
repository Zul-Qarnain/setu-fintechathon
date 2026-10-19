/** Scripted reply composer (EN / 简体中文). Numbers are copied verbatim from tool outputs. */
import { Decimal } from '../domain/money.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type O = Record<string, any>;

export function money(s: string | null | undefined): string {
  if (s === null || s === undefined) return '?';
  const [int = '0', frac = '00'] = new Decimal(s).toFixed(2).split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  return `${neg ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

function tierLine(
  en: boolean,
  tier: string,
  outcome: string,
  reasons: string[],
  required: string[]
): string {
  const t = tier.slice(1);
  if (outcome === 'BLOCK')
    return en
      ? `Blocked (Tier ${t}): reasons ${reasons.join(', ')}. No money moved.`
      : `已拦截（T${t} 级）：原因 ${reasons.join(', ')}。未转出任何资金。`;
  if (outcome === 'REQUIRE_COOLING_OFF') {
    return en
      ? `Tier ${t}: new or changed payee — 24 hour cooling-off, then your TOTP and your family approver are required.`
      : `T${t} 级：新增或变更收款人——需 24 小时冷静期，之后需要您的动态口令和家人审批。`;
  }
  if (outcome === 'REQUIRE_APPROVAL') {
    const need = required
      .map((r) => r.replaceAll('family_approver', 'family approver').replaceAll('totp', 'TOTP'))
      .join(' + ');
    return en
      ? `Tier ${t}: needs ${need}. Nothing is sent until approved.`
      : `T${t} 级：需要 ${need.replaceAll('family approver', '家人审批').replaceAll('TOTP', '动态口令')}。批准前不会转出任何资金。`;
  }
  return en ? `Tier ${t}: allowed.` : `T${t} 级：已允许。`;
}

const LIVE = 'live-open.er-api.com';

export function compose(
  intent: string,
  outputs: Record<string, O>,
  actions: O[],
  locale: string,
  guardianCodes: string[]
): string {
  const en = locale !== 'zh-CN';
  const costs: O = outputs.compute_costs ?? {};
  const ob: O = outputs.get_obligation ?? {};
  const due: O = outputs.list_obligations_due ?? {};
  const parts: string[] = [];
  const act = actions[0];
  const rate = (): string =>
    en
      ? costs.fx_source !== LIVE
        ? 'SAMPLE rate, not live'
        : 'live rate'
      : costs.fx_source !== LIVE
        ? '样例汇率，非实时'
        : '实时汇率';
  const truthy = (v: unknown): boolean => Boolean(v);

  if (intent === 'unsafe_request') {
    parts.push(
      en
        ? "I can't do that. Paying a new or unverified account (even to 'save' fees) is not something I can authorise."
        : '我无法执行该请求。向新账户或未验证账户付款（即使声称能省手续费）不在我的授权范围内。'
    );
  } else if (intent === 'pay_obligation') {
    if (ob.found && costs.ok) {
      parts.push(
        en
          ? `Obligation: CNY ${money(ob.amount_cny)} due ${ob.due_date} to ${ob.payee_name || 'unknown payee'}. ` +
              `Estimated fees CNY ${money(costs.total_fees_cny)} (${costs.fee_pct}%); total BDT needed about ${money(costs.bdt_needed)} at rate ${costs.fx_rate} (${rate()}).`
          : `应缴：¥${money(ob.amount_cny)}，截止 ${ob.due_date}，收款方 ${ob.payee_name || '未知'}。` +
              `预计费用 ¥${money(costs.total_fees_cny)}（${costs.fee_pct}%）；约需 BDT ${money(costs.bdt_needed)}，汇率 ${costs.fx_rate}（${rate()}）。`
      );
    } else if (ob.needs_confirmation) {
      parts.push(
        en
          ? "Please confirm the parsed fields of this document first; I won't act on unconfirmed document text."
          : '请先确认该文件解析出的字段；未确认的文件内容我不会采取任何行动。'
      );
    } else if (!ob.found && !act) {
      parts.push(en ? "I couldn't find an open obligation to pay." : '未找到可支付的待缴款项。');
    }
  } else if (intent === 'how_much_needed') {
    if (costs.ok) {
      const n = due.count;
      const has = truthy(due) && Object.keys(due).length > 0 && n !== undefined && n !== null;
      const byS = truthy(due.by);
      const lead =
        has && byS
          ? `${n} obligation(s) due by ${due.by}, total CNY ${money(due.total_cny)}. `
          : has
            ? `${n} open obligation(s), total CNY ${money(due.total_cny)}. `
            : '';
      const leadZh =
        has && byS
          ? `截至 ${due.by} 共 ${n} 笔待缴，合计 ¥${money(due.total_cny)}。`
          : has
            ? `共 ${n} 笔待缴，合计 ¥${money(due.total_cny)}。`
            : '';
      parts.push(
        en
          ? `${lead}Including estimated fees (CNY ${money(costs.total_fees_cny)}), you need about BDT ${money(costs.bdt_needed)} at rate ${costs.fx_rate} (${rate()}).`
          : `${leadZh}含预计费用（¥${money(costs.total_fees_cny)}），约需 BDT ${money(costs.bdt_needed)}，汇率 ${costs.fx_rate}（${rate()}）。`
      );
    } else {
      parts.push(
        en
          ? 'Nothing is due in that period, so no BDT is needed.'
          : '该期间没有待缴款项，无需准备 BDT。'
      );
    }
  } else if (intent === 'quote_fx') {
    const q: O = outputs.fx_quote ?? {};
    parts.push(
      en
        ? `CNY ${money(q.amount_cny)} = BDT ${money(q.amount_converted)} at ${q.rate} (${q.disclaimer})`
        : `¥${money(q.amount_cny)} ≈ BDT ${money(q.amount_converted)}，汇率 ${q.rate}（${!q.is_live ? '样例汇率，非实时' : '实时汇率'}）`
    );
  } else if (intent === 'explain_fees') {
    if (costs.ok) {
      const lines = (costs.fees as O[])
        .map((f) => `${f.label} CNY ${money(f.amount_cny)}`)
        .join('; ');
      parts.push(
        en
          ? `For CNY ${money(costs.amount_cny)} via ${costs.channel}: ${lines}; total CNY ${money(costs.total_fees_cny)} (${costs.fee_pct}%).`
          : `¥${money(costs.amount_cny)} 经 ${costs.channel}：总费用 ¥${money(costs.total_fees_cny)}（${costs.fee_pct}%）。`
      );
    } else {
      const b: O | undefined = outputs.budget_summary;
      if (b && Object.keys(b).length) {
        parts.push(
          en
            ? `Monthly budget CNY ${money(b.monthly_budget_cny)}, spent CNY ${money(b.spent_this_month_cny)}, remaining CNY ${money(b.remaining_cny)}.`
            : `月预算 ¥${money(b.monthly_budget_cny)}，已花 ¥${money(b.spent_this_month_cny)}，剩余 ¥${money(b.remaining_cny)}。`
        );
      }
    }
  } else if (intent === 'payee_change') {
    const pv: O = outputs.propose_verify_payee ?? {};
    if (pv.proposed) {
      parts.push(
        en
          ? `A message claims the payee account changed (new account ${pv.account_masked}). I did NOT trust it: it is saved as an UNVERIFIED payee. ` +
              `Verifying it needs a ${pv.cooling_off_hours} hour cooling-off, your TOTP and your family approver; please confirm with the university through an official channel. I drafted a message (not sent).`
          : `有消息称收款账户已变更（新账号 ${pv.account_masked}）。我没有采信：已保存为【未验证】收款人。` +
              `验证需 ${pv.cooling_off_hours} 小时冷静期、您的动态口令和家人审批；请通过官方渠道向学校核实。已起草一条消息（未发送）。`
      );
    } else {
      parts.push(
        en
          ? "I couldn't find a valid account number in that message."
          : '未在该消息中找到有效账号。'
      );
    }
  } else {
    parts.push(
      en
        ? 'I can help with: how much BDT you need, FX quotes, fee breakdowns, and drafting payments for approval.'
        : '我可以帮您：计算所需 BDT、查询汇率、拆解费用，并起草待审批的付款。'
    );
  }

  if (act) {
    const d = act.decision as O;
    if (act.type === 'payment' && act.status !== 'blocked' && act.params?.amount_cny) {
      parts.push(
        (en
          ? `Drafted a payment of CNY ${money(act.params.amount_cny)}. `
          : `已起草付款 ¥${money(act.params.amount_cny)}。`) +
          tierLine(en, d.tier, d.outcome, d.reasons, d.required)
      );
    } else if (act.type !== 'draft_message') {
      parts.push(tierLine(en, d.tier, d.outcome, d.reasons, d.required));
    }
  }
  if (
    ['INJECTION_PHRASE', 'NO_CONFIRMATION_DEMAND', 'TOOL_COMMAND_IN_DOC'].some((c) =>
      guardianCodes.includes(c)
    )
  ) {
    parts.push(
      en
        ? 'Guardian: the content contained instructions aimed at the assistant; it was treated as data and blocked.'
        : '守卫提示：该内容含有针对助手的指令，已按数据处理并拦截。'
    );
  }
  return parts.join(' ');
}
