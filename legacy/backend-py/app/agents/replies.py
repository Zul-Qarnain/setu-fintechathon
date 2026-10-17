"""Scripted reply composer (EN / 简体中文). Numbers are copied verbatim from tool outputs."""

from __future__ import annotations

from decimal import Decimal
from typing import Any


def money(s: str | None) -> str:
    if s is None:
        return "?"
    d = Decimal(s)
    return f"{d:,.2f}"


def _tier_line(en: bool, tier: str, outcome: str, reasons: list[str], required: list[str], until: str | None) -> str:
    if outcome == "BLOCK":
        return (
            f"Blocked (Tier {tier[1]}): reasons {', '.join(reasons)}. No money moved."
            if en
            else f"已拦截（T{tier[1]} 级）：原因 {', '.join(reasons)}。未转出任何资金。"
        )
    if outcome == "REQUIRE_COOLING_OFF":
        return (
            f"Tier {tier[1]}: new or changed payee — 24 hour cooling-off, then your TOTP and your family approver are required."
            if en
            else f"T{tier[1]} 级：新增或变更收款人——需 24 小时冷静期，之后需要您的动态口令和家人审批。"
        )
    if outcome == "REQUIRE_APPROVAL":
        need = " + ".join(r.replace("family_approver", "family approver").replace("totp", "TOTP") for r in required)
        return (
            f"Tier {tier[1]}: needs {need}. Nothing is sent until approved."
            if en
            else f"T{tier[1]} 级：需要 {need.replace('family approver', '家人审批').replace('TOTP', '动态口令')}。批准前不会转出任何资金。"
        )
    return f"Tier {tier[1]}: allowed." if en else f"T{tier[1]} 级：已允许。"


def compose(
    intent: str,
    outputs: dict[str, dict[str, Any]],
    actions: list[dict[str, Any]],
    locale: str,
    guardian_codes: list[str],
) -> str:  # noqa: C901
    en = locale != "zh-CN"
    costs = outputs.get("compute_costs") or {}
    ob = outputs.get("get_obligation") or {}
    due = outputs.get("list_obligations_due") or {}
    parts: list[str] = []
    act = actions[0] if actions else None

    if intent == "unsafe_request":
        parts.append(
            "I can't do that. Paying a new or unverified account (even to 'save' fees) is not something I can authorise."
            if en
            else "我无法执行该请求。向新账户或未验证账户付款（即使声称能省手续费）不在我的授权范围内。"
        )
    elif intent == "pay_obligation":
        if ob.get("found") and costs.get("ok"):
            parts.append(
                f"Obligation: CNY {money(ob['amount_cny'])} due {ob['due_date']} to {ob.get('payee_name') or 'unknown payee'}. "
                f"Estimated fees CNY {money(costs['total_fees_cny'])} ({costs['fee_pct']}%); total BDT needed about {money(costs['bdt_needed'])} "
                f"at rate {costs['fx_rate']} ({'SAMPLE rate, not live' if costs['fx_source'] != 'live-open.er-api.com' else 'live rate'})."
                if en
                else f"应缴：¥{money(ob['amount_cny'])}，截止 {ob['due_date']}，收款方 {ob.get('payee_name') or '未知'}。"
                f"预计费用 ¥{money(costs['total_fees_cny'])}（{costs['fee_pct']}%）；约需 BDT {money(costs['bdt_needed'])}，"
                f"汇率 {costs['fx_rate']}（{'样例汇率，非实时' if costs['fx_source'] != 'live-open.er-api.com' else '实时汇率'}）。"
            )
        elif ob.get("needs_confirmation"):
            parts.append(
                "Please confirm the parsed fields of this document first; I won't act on unconfirmed document text."
                if en
                else "请先确认该文件解析出的字段；未确认的文件内容我不会采取任何行动。"
            )
        elif not ob.get("found") and not act:
            parts.append("I couldn't find an open obligation to pay." if en else "未找到可支付的待缴款项。")
    elif intent == "how_much_needed":
        if costs.get("ok"):
            n = due.get("count")
            lead = (
                f"{n} obligation(s) due by {due['by']}, total CNY {money(due['total_cny'])}. "
                if due and due.get("by") and n is not None
                else (f"{n} open obligation(s), total CNY {money(due['total_cny'])}. " if due and n is not None else "")
            )
            lead_zh = (
                f"截至 {due['by']} 共 {n} 笔待缴，合计 ¥{money(due['total_cny'])}。"
                if due and due.get("by") and n is not None
                else (f"共 {n} 笔待缴，合计 ¥{money(due['total_cny'])}。" if due and n is not None else "")
            )
            parts.append(
                f"{lead}Including estimated fees (CNY {money(costs['total_fees_cny'])}), you need about BDT {money(costs['bdt_needed'])} "
                f"at rate {costs['fx_rate']} ({'SAMPLE rate, not live' if costs['fx_source'] != 'live-open.er-api.com' else 'live rate'})."
                if en
                else f"{lead_zh}含预计费用（¥{money(costs['total_fees_cny'])}），约需 BDT {money(costs['bdt_needed'])}，汇率 {costs['fx_rate']}"
                f"（{'样例汇率，非实时' if costs['fx_source'] != 'live-open.er-api.com' else '实时汇率'}）。"
            )
        else:
            parts.append(
                "Nothing is due in that period, so no BDT is needed." if en else "该期间没有待缴款项，无需准备 BDT。"
            )
    elif intent == "quote_fx":
        q = outputs.get("fx_quote") or {}
        parts.append(
            f"CNY {money(q['amount_cny'])} = BDT {money(q['amount_converted'])} at {q['rate']} ({q['disclaimer']})"
            if en
            else f"¥{money(q['amount_cny'])} ≈ BDT {money(q['amount_converted'])}，汇率 {q['rate']}（{'样例汇率，非实时' if not q['is_live'] else '实时汇率'}）"
        )
    elif intent == "explain_fees":
        if costs.get("ok"):
            lines = "; ".join(f"{f['label']} CNY {money(f['amount_cny'])}" for f in costs["fees"])
            parts.append(
                f"For CNY {money(costs['amount_cny'])} via {costs['channel']}: {lines}; total CNY {money(costs['total_fees_cny'])} ({costs['fee_pct']}%)."
                if en
                else f"¥{money(costs['amount_cny'])} 经 {costs['channel']}：总费用 ¥{money(costs['total_fees_cny'])}（{costs['fee_pct']}%）。"
            )
        else:
            b = outputs.get("budget_summary")
            if b:
                parts.append(
                    f"Monthly budget CNY {money(b['monthly_budget_cny'])}, spent CNY {money(b['spent_this_month_cny'])}, remaining CNY {money(b['remaining_cny'])}."
                    if en
                    else f"月预算 ¥{money(b['monthly_budget_cny'])}，已花 ¥{money(b['spent_this_month_cny'])}，剩余 ¥{money(b['remaining_cny'])}。"
                )
    elif intent == "payee_change":
        pv = outputs.get("propose_verify_payee") or {}
        if pv.get("proposed"):
            parts.append(
                f"A message claims the payee account changed (new account {pv['account_masked']}). I did NOT trust it: it is saved as an UNVERIFIED payee. "
                f"Verifying it needs a {pv['cooling_off_hours']} hour cooling-off, your TOTP and your family approver; please confirm with the university through an official channel. I drafted a message (not sent)."
                if en
                else f"有消息称收款账户已变更（新账号 {pv['account_masked']}）。我没有采信：已保存为【未验证】收款人。"
                f"验证需 {pv['cooling_off_hours']} 小时冷静期、您的动态口令和家人审批；请通过官方渠道向学校核实。已起草一条消息（未发送）。"
            )
        else:
            parts.append(
                "I couldn't find a valid account number in that message." if en else "未在该消息中找到有效账号。"
            )
    else:
        parts.append(
            "I can help with: how much BDT you need, FX quotes, fee breakdowns, and drafting payments for approval."
            if en
            else "我可以帮您：计算所需 BDT、查询汇率、拆解费用，并起草待审批的付款。"
        )

    if act:
        d = act["decision"]
        if act["type"] == "payment" and act["status"] != "blocked" and act["params"].get("amount_cny"):
            parts.append(
                (
                    f"Drafted a payment of CNY {money(act['params']['amount_cny'])}. "
                    if en
                    else f"已起草付款 ¥{money(act['params']['amount_cny'])}。"
                )
                + _tier_line(
                    en,
                    d["tier"],
                    d["outcome"],
                    d["reasons"],
                    d["required"],
                    d.get("cooling_off_until"),
                )
            )
        elif act["type"] == "draft_message":
            pass
        else:
            parts.append(
                _tier_line(
                    en,
                    d["tier"],
                    d["outcome"],
                    d["reasons"],
                    d["required"],
                    d.get("cooling_off_until"),
                )
            )
    if guardian_codes and any(
        c in guardian_codes for c in ("INJECTION_PHRASE", "NO_CONFIRMATION_DEMAND", "TOOL_COMMAND_IN_DOC")
    ):
        parts.append(
            "Guardian: the content contained instructions aimed at the assistant; it was treated as data and blocked."
            if en
            else "守卫提示：该内容含有针对助手的指令，已按数据处理并拦截。"
        )
    return " ".join(parts)
