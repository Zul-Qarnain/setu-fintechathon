/** Scripted reply composer (EN / 简体中文). Numbers are copied verbatim from tool outputs. */

import { Decimal } from '../domain/money.js';

export function money(s: string | null): string {
  if (s === null) {
    return '?';
  }
  const d = new Decimal(s);
  // Manual formatting for decimal places
  const parts = d.toFixed(2).split('.');
  const intPart = parts[0].replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
  return `${intPart}.${parts[1]}`;
}

function _tierLine(en: boolean, tier: number, outcome: string, reasons: string[], required: string[], until: string | null): string {
  if (outcome === "BLOCK") {
    return en
      ? `Blocked (Tier ${tier}): reasons ${reasons.join(', ')}. No money moved.`
      : `已拦截（T${tier}级）：原因 ${reasons.join(', ')}。未转出任何资金。`;
  }
  if (outcome === "REQUIRE_COOLING_OFF") {
    return en
      ? `Tier ${tier}: new or changed payee — 24 hour cooling-off, then your TOTP and your family approver are required.`
      : `T${tier}级：新增或变更收款人——需 24 小时冷静期，之后需要您的动态口令和家人审批。`;
  }
  if (outcome === "REQUIRE_APPROVAL") {
    const need = required.map(r => r.replace('family_approver', 'family approver').replace('totp', 'TOTP')).join(' + ');
    return en
      ? `Tier ${tier}: needs ${need}. Nothing is sent until approved.`
      : `T${tier}级：需要 ${need.replace('family approver', '家人审批').replace('TOTP', '动态口令')}。批准前不会转出任何资金。`;
  }
  return en ? `Tier ${tier}: allowed.` : `T${tier}级：已允许。`;
}

interface Outputs {
  [key: string]: any;
}

interface Actions {
  [key: string]: any;
}

export function compose(
  intent: string,
  outputs: Outputs,
  actions: Actions[],
  locale: string,
  guardian_codes: string[]
): string {
  const en = locale !== "zh-CN";
  const costs = outputs['compute_costs'] || {};
  const ob = outputs['get_obligation'] || {};
  const due = outputs['list_obligations_due'] || {};
  const parts: string[] = [];
  const act = actions.length > 0 ? actions[0] : null;

  if (intent === "unsafe_request") {
    parts.push(
      en
        ? "I can't do that. Paying a new or unverified account (even to 'save' fees) is not something I can authorise."
        : "我无法执行该请求。向新账户或未验证账户付款（即使声称能省手续费）不在我的授权范围内。"
    );
  } else if (intent === "pay_obligation") {
    if (ob.found && costs.ok) {
      parts.push(
        en
          ? `Obligation: CNY ${money(ob.amount_cny.toString())} due ${ob.due_date} to ${ob.payee_name || 'unknown payee'}. Estimated fees CNY ${money(costs.total_fees_cny.toString())} (${costs.fee_pct}%); total BDT needed about ${money(costs.bdt_needed.toString())} at rate ${costs.fx_rate} (${costs.fx_source !== 'live-open.er-api.com' ? 'SAMPLE rate, not live' : 'live rate'}).`
          : `应缴：¥${money(ob.amount_cny.toString())}，截止 ${ob.due_date}，收款方 ${ob.payee_name || '未知'}。预计费用 ¥${money(costs.total_fees_cny.toString())}（${costs.fee_pct}%）；约需 BDT ${money(costs.bdt_needed.toString())}，汇率 ${costs.fx_rate}（${costs.fx_source !== 'live-open.er-api.com' ? '样例汇率，非实时' : '实时汇率'}）。`
      );
    } else if (ob.needs_confirmation) {
      parts.push(
        en
          ? "Please confirm the parsed fields of this document first; I won't act on unconfirmed document text."
          : "请先确认该文件解析出的字段；未确认的文件内容我不会采取任何行动。"
      );
    } else if (!ob.found && !act) {
      parts.push(en ? "I couldn't find an open obligation to pay." : "未找到可支付的待缴款项。");
    }
  } else if (intent === "how_much_needed") {
    if (costs.ok) {
      const n = due.count;
      const lead = due.by && n !== undefined
        ? (en ? `${n} obligation(s) due by ${due.by}, total CNY ${money(due.total_cny.toString())}.` : `截至 ${due.by} 共 ${n} 笔待缴，合计 ¥${money(due.total_cny.toString())}。`)
        : (n !== undefined
          ? (en ? `${n} open obligation(s), total CNY ${money(due.total_cny.toString())}. ` : `共 ${n} 笔待缴，合计 ¥${money(due.total_cny.toString())}。`)
          : '');
      parts.push(
        en
          ? `${lead}Including estimated fees (CNY ${money(costs.total_fees_cny.toString())}), you need about BDT ${money(costs.bdt_needed.toString())} at rate ${costs.fx_rate} (${costs.fx_source !== 'live-open.er-api.com' ? 'SAMPLE rate, not live' : 'live rate'}).`
          : `${lead}含预计费用（¥${money(costs.total_fees_cny.toString())}），约需 BDT ${money(costs.bdt_needed.toString())}，汇率 ${costs.fx_rate}（${costs.fx_source !== 'live-open.er-api.com' ? '样例汇率，非实时' : '实时汇率'}）。`
      );
    } else {
      parts.push(en ? "Nothing is due in that period, so no BDT is needed." : "该期间没有待缴款项，无需准备 BDT。");
    }
  } else if (intent === "quote_fx") {
    const q = outputs['fx_quote'] || {};
    parts.push(
      en
        ? `CNY ${money(q.amount_cny.toString())} = BDT ${money(q.amount_converted.toString())} at ${q.rate} (${q.disclaimer})`
        : `¥${money(q.amount_cny.toString())} ≈ BDT ${money(q.amount_converted.toString())}，汇率 ${q.rate}(${!q.is_live ? '样例汇率，非实时' : '实时汇率'})`
    );
  } else if (intent === "explain_fees") {
    if (costs.ok) {
      const lines = costs.fees.map((f: any) => `${f.label} CNY ${money(f.amount_cny.toString())}`).join('; ');
      parts.push(
        en
          ? `For CNY ${money(costs.amount_cny.toString())} via ${costs.channel}: ${lines}; total CNY ${money(costs.total_fees_cny.toString())} (${costs.fee_pct}%).`
          : `¥${money(costs.amount_cny.toString())} 经 ${costs.channel}：总费用 ¥${money(costs.total_fees_cny.toString())}（${costs.fee_pct}%）。`
      );
    } else {
      const b = outputs['budget_summary'];
      if (b) {
        parts.push(
          en
            ? `Monthly budget CNY ${money(b.monthly_budget_cny.toString())}, spent CNY ${money(b.spent_this_month_cny.toString())}, remaining CNY ${money(b.remaining_cny.toString())}.`
            : `月预算 ¥${money(b.monthly_budget_cny.toString())}，已花 ¥${money(b.spent_this_month_cny.toString())}，剩余 ¥${money(b.remaining_cny.toString())}。`
        );
      }
    }
  } else if (intent === "payee_change") {
    const pv = outputs['propose_verify_payee'] || {};
    if (pv.proposed) {
      parts.push(
        en
          ? `A message claims the payee account changed (new account ${pv.account_masked}). I did NOT trust it: it is saved as an UNVERIFIED payee. Verifying it needs a ${pv.cooling_off_hours} hour cooling-off, your TOTP and your family approver; please confirm with the university through an official channel. I drafted a message (not sent).`
          : `有消息称收款账户已变更（新账号 ${pv.account_masked}）。我没有采信：已保存为【未验证】收款人。验证需 ${pv.cooling_off_hours} 小时冷静期、您的动态口令和家人审批；请通过官方渠道向学校核实。已起草一条消息（未发送）。`
      );
    } else {
      parts.push(en ? "I couldn't find a valid account number in that message." : "未在该消息中找到有效账号。");
    }
  } else {
    parts.push(
      en
        ? "I can help with: how much BDT you need, FX quotes, fee breakdowns, and drafting payments for approval."
        : "我可以帮您：计算所需 BDT、查询汇率、拆解费用，并起草待审批的付款。"
    );
  }

  if (act) {
    const d = act.decision;
    if (act.type === "payment" && act.status !== "blocked" && act.params.amount_cny) {
      parts.push(
        (en ? `Drafted a payment of CNY ${money(act.params.amount_cny.toString())}. ` : `已起草付款 ¥${money(act.params.amount_cny.toString())}。`) +
        _tierLine(en, d.tier, d.outcome, d.reasons, d.required, d.cooling_off_until)
      );
    } else if (act.type === "draft_message") {
      // Do nothing
    } else {
      parts.push(
        _tierLine(en, d.tier, d.outcome, d.reasons, d.required, d.cooling_off_until)
      );
    }
  }
  if (guardian_codes && ["INJECTION_PHRASE", "NO_CONFIRMATION_DEMAND", "TOOL_COMMAND_IN_DOC"].some(c => guardian_codes.includes(c))) {
    parts.push(
      en
        ? "Guardian: the content contained instructions aimed at the assistant; it was treated as data and blocked."
        : "守卫提示：该内容含有针对助手的指令，已按数据处理并拦截。"
    );
  }
  return parts.join(" ");
}
