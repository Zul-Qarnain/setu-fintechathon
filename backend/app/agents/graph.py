"""Explicit state machine (no LangGraph): intake -> planner -> tools -> guardian -> policy ->
executor | await_approval -> validator. Every step is traced and audited."""

from __future__ import annotations

import json
import time
import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app import actions_service
from app import schemas as s
from app.agents import guardian, llm_adapters, planner, replies, tools, validator
from app.agents.executor import execute as exec_action
from app.config import get_settings
from app.db import append_audit
from app.domain import tokenize
from app.domain.fx import FxService, get_fx_service
from app.domain.policy import Outcome
from app.models import Document, User

SAFE_FALLBACK = {
    "en": "I could not produce a verified answer. Please use the dashboard figures or rephrase your request.",
    "zh-CN": "我无法给出经过校验的回答。请参考仪表盘中的数据，或换种方式提问。",
}


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def _today() -> date:
    fixed = get_settings().fixed_today
    return date.fromisoformat(fixed) if fixed else datetime.now(UTC).date()


def run_chat(
    db: Session, user: User, req: s.ChatRequest, adapter: llm_adapters.LLMAdapter | None = None,
    fx: FxService | None = None,
) -> s.ChatResponse:  # fmt: skip
    st = get_settings()
    adapter = adapter or llm_adapters.get_adapter(st.llm_provider, st.gemini_api_key, st.groq_api_key)
    fx = fx or get_fx_service()
    steps: list[s.TraceStep] = []
    tool_trace: list[s.ToolCallTrace] = []
    audit_seqs: list[int] = []
    locale = req.locale

    def audit(event: str, payload: dict[str, Any]) -> None:
        audit_seqs.append(append_audit(db, user.id, event, payload).seq)

    # ---------------- intake ----------------
    t0 = time.perf_counter()
    masked, token_map_masked = tokenize.tokenize_text(req.message)
    raw_tokens: dict[str, str] = {}
    for tok in token_map_masked:  # re-derive raw numbers server-side (never sent to the LLM)
        pass
    import re

    for m in re.finditer(r"(?<![\w])(?:\d[ \-]?){12,19}(?![\w])", req.message):
        raw_tokens[tokenize.account_token(m.group(0))] = tokenize.normalize_account(m.group(0))
    msg_verdict = guardian.check_message(req.message)
    doc: Document | None = None
    if req.document_id:
        doc = db.get(Document, req.document_id)
        if doc is None or doc.owner_id != user.id:
            steps.append(s.TraceStep(step="intake", status="rejected", duration_ms=_ms(t0), detail={"error": "document not found"}))
            raise_not_found()
    ctx = llm_adapters.PlanContext(today=_today(), document_id=doc.id if doc else None,
                                   document_status=doc.status if doc else None, locale=locale)
    audit("chat.received", {"message_len": len(req.message), "document_id": req.document_id,
                            "message_guardian": msg_verdict.verdict})  # no raw text in audit
    steps.append(s.TraceStep(step="intake", status="ok", duration_ms=_ms(t0), detail={
        "tokenised_accounts": len(raw_tokens), "document_id": req.document_id,
        "document_status": doc.status if doc else None, "untrusted_wrapped": bool(doc),
        "message_guardian": msg_verdict.verdict}))  # fmt: skip

    # ---------------- planner ----------------
    t0 = time.perf_counter()
    plan_rejected: str | None = None
    try:
        out = planner.validate_plan(adapter.plan(masked, ctx))
    except planner.PlanRejected as e:
        plan_rejected = e.reason
        out = planner.validate_plan(llm_adapters.ScriptedAdapter().plan(masked, ctx))
    if msg_verdict.verdict == "blocked" and out.intent != "unsafe_request":
        out = planner.PlannerOutput(intent="unsafe_request", tool_calls=[planner.ToolCall(
            tool="propose_payment", args={"origin": "message", "payee_account": None})])
    steps.append(s.TraceStep(step="planner", status="rejected" if plan_rejected else "ok", duration_ms=_ms(t0), detail={
        "intent": out.intent, "tool_calls": [t.tool for t in out.tool_calls], "adapter": adapter.name,
        "rejected_reason": plan_rejected}))  # fmt: skip

    # ---------------- tools ----------------
    t0 = time.perf_counter()
    state = tools.ToolState(db=db, user=user, fx=fx, today=ctx.today, token_map=raw_tokens)
    for tc in out.tool_calls:
        args = dict(tc.args)
        missing = [k for k, v in args.items() if isinstance(v, str) and v.startswith("$") and tools._resolve(v, state) is None]
        if missing:
            tool_trace.append(s.ToolCallTrace(tool=tc.tool, args=args, output={"skipped": "dependency missing", "args": missing}, ok=False))
            continue
        try:
            result = tools.TOOLS[tc.tool](state, args)
            ok = True
        except Exception as e:  # tool errors never crash the turn
            result, ok = {"error": type(e).__name__}, False
        state.outputs[tc.tool] = result
        tool_trace.append(s.ToolCallTrace(tool=tc.tool, args=args, output=result, ok=ok))
    steps.append(s.TraceStep(step="tools", status="ok", duration_ms=_ms(t0), detail={"count": len(tool_trace)}))

    # ---------------- guardian ----------------
    t0 = time.perf_counter()
    verdict = msg_verdict
    doc_blocked = False
    if doc is not None:
        dv = s.GuardianVerdict(**json.loads(doc.guardian_json))
        doc_blocked = dv.verdict == "blocked"
        verdict = guardian.merge(verdict, dv.flags)
    gblocked = verdict.verdict == "blocked" or doc_blocked
    codes = [f.code for f in verdict.flags]
    steps.append(s.TraceStep(step="guardian", status="blocked" if gblocked else "ok", duration_ms=_ms(t0),
                             detail={"verdict": verdict.verdict, "score": verdict.score, "flags": codes}))  # fmt: skip

    # ---------------- policy (server-side authority) ----------------
    t0 = time.perf_counter()
    action_rows = []
    plan_id: str | None = None
    if state.last_plan and any(p.atype == "payment" for p in state.proposals):
        plan_id = _persist_plan(db, user, state)
    for prop in state.proposals:
        params = dict(prop.params)
        if gblocked and prop.atype == "payment":
            params["_guardian_blocked"] = True
        row, _d = actions_service.propose(db, user, prop.atype, params, prop.source,
                                          plan_id if prop.atype == "payment" else None)  # fmt: skip
        action_rows.append(row)
    top = _top_decision(action_rows)
    steps.append(s.TraceStep(step="policy", status="blocked" if top and top["outcome"] == "BLOCK" else "ok",
                             duration_ms=_ms(t0), detail={"tier": top["tier"] if top else "T0", "outcome": top["outcome"] if top else "ALLOW",
                                                          "reasons": top["reasons"] if top else ["READ_ONLY"]}))  # fmt: skip

    # ---------------- executor | await_approval ----------------
    t0 = time.perf_counter()
    exec_detail: dict[str, Any] = {}
    exec_status: str = "skipped"
    for row in action_rows:
        d = actions_service.evaluate(db, row)
        if d.outcome is Outcome.ALLOW and row.type == "draft_message":
            row.result_json = json.dumps(exec_action(db, row, d))
            exec_status = "ok"
            exec_detail[row.id] = "drafted (not sent)"
        elif d.outcome is Outcome.BLOCK:
            exec_detail[row.id] = "blocked by policy"
        else:
            exec_detail[row.id] = "awaiting approval"
    if not action_rows:
        exec_detail = {"note": "read-only turn"}
    steps.append(s.TraceStep(step="executor", status=exec_status, duration_ms=_ms(t0), detail=exec_detail))  # type: ignore[arg-type]

    actions_out = [actions_service.action_out(db, r) for r in action_rows]
    for r in action_rows:
        audit_row = append_audit(db, user.id, "chat.action", {"action_id": r.id, "tier": r.tier, "status": r.status})
        audit_seqs.append(audit_row.seq)

    # ---------------- reply + validator ----------------
    t0 = time.perf_counter()
    reply = replies.compose(out.intent, state.outputs, [a.model_dump(mode="json") for a in actions_out], locale, codes)
    vr = validator.validate_reply(reply, [t.output for t in tool_trace] + [a.model_dump(mode="json") for a in actions_out],
                                  req.message)
    if not vr.ok:
        audit("reply.rejected", {"unsupported_numbers": vr.unsupported})
        reply = SAFE_FALLBACK["zh-CN" if locale == "zh-CN" else "en"]
    steps.append(s.TraceStep(step="validator", status="ok" if vr.ok else "rejected", duration_ms=_ms(t0),
                             detail={"unsupported_numbers": vr.unsupported}))  # fmt: skip
    audit("chat.reply", {"intent": out.intent, "tier": top["tier"] if top else "T0", "validated": vr.ok})

    plan_out = _plan_out(state, ctx.today) if state.last_plan else None
    trace = s.Trace(
        trace_id="trc_" + uuid.uuid4().hex[:12], llm_mode=adapter.mode,  # type: ignore[arg-type]
        steps=steps, tool_calls=tool_trace, tier=(top["tier"] if top else "T0"),  # type: ignore[arg-type]
        decision=(top["outcome"] if top else "ALLOW"), reply_validated=vr.ok, audit_seqs=audit_seqs,  # type: ignore[arg-type]
    )
    return s.ChatResponse(reply=reply, intent=out.intent, plan=plan_out, proposed_actions=actions_out, trace=trace)


def raise_not_found() -> None:
    from app.deps import api_error

    raise api_error(404, "NOT_FOUND", "Document not found")


_RANK = {"BLOCK": 3, "REQUIRE_COOLING_OFF": 2, "REQUIRE_APPROVAL": 1, "ALLOW": 0}


def _top_decision(rows: list[Any]) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    for r in rows:
        d = json.loads(r.decision_json)
        if best is None or _RANK[d["outcome"]] > _RANK[best["outcome"]]:
            best = d
    return best


def _persist_plan(db: Session, user: User, state: tools.ToolState) -> str:
    from decimal import Decimal

    from app.models import Plan

    p = state.last_plan or {}
    obl = state.outputs.get("get_obligation", {})
    plan = Plan(owner_id=user.id, obligation_id=obl.get("obligation_id"), channel=p["channel"],
                bdt_needed=Decimal(p["bdt_needed"]), fees=Decimal(p["total_fees_cny"]),
                fx_rate=Decimal(p["fx_rate"]), plan_json=json.dumps(p))  # fmt: skip
    db.add(plan)
    db.flush()
    return plan.id


def _plan_out(state: tools.ToolState, today: date) -> s.PlanOut:
    from decimal import Decimal

    p = state.last_plan or {}
    due_s = (state.outputs.get("get_obligation") or {}).get("due_date")
    return s.PlanOut(
        channel=p["channel"], amount_cny=Decimal(p["amount_cny"]), fx_rate=Decimal(p["fx_rate"]),
        fx_source=p["fx_source"], fees=[s.FeeLine(label=f["label"], amount_cny=Decimal(f["amount_cny"])) for f in p["fees"]],
        total_fees_cny=Decimal(p["total_fees_cny"]), fee_pct=Decimal(p["fee_pct"]), bdt_needed=Decimal(p["bdt_needed"]),
        due_date=date.fromisoformat(due_s) if due_s else None, notes=p.get("notes", []),
    )  # fmt: skip
