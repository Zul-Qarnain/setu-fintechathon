"""Deterministic tools. They are the ONLY source of numbers. propose_* never execute anything."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import doc_service, services
from app.config import get_settings
from app.domain import budget, costs, tokenize
from app.domain.fx import FxService
from app.models import Document, Obligation, Payee, User, aware


@dataclass
class Proposal:
    atype: str
    params: dict[str, Any]
    source: str
    plan: dict[str, Any] | None = None


@dataclass
class ToolState:
    db: Session
    user: User
    fx: FxService
    today: date
    token_map: dict[str, str] = field(default_factory=dict)  # ACCT_ token -> raw account
    outputs: dict[str, dict[str, Any]] = field(default_factory=dict)
    proposals: list[Proposal] = field(default_factory=list)
    last_plan: dict[str, Any] | None = None
    guardian_blocked_docs: set[str] = field(default_factory=set)


def _resolve(value: Any, state: ToolState) -> Any:
    """Resolve '$tool.field' references to earlier tool outputs."""
    if isinstance(value, str) and value.startswith("$"):
        tool, _, fld = value[1:].partition(".")
        out = state.outputs.get(tool, {})
        v = out.get(fld)
        return None if v is None else str(v)
    return value


def _dec(v: Any) -> Decimal | None:
    try:
        d = Decimal(str(v).replace(",", ""))
    except (InvalidOperation, TypeError):
        return None
    return d if d.is_finite() else None


def _obligation_dict(db: Session, o: Obligation) -> dict[str, Any]:
    p = db.get(Payee, o.payee_id) if o.payee_id else None
    return {
        "found": True, "obligation_id": o.id, "title": o.title, "amount_cny": str(o.amount_cny),
        "due_date": o.due_date.isoformat(), "payee_id": o.payee_id, "payee_name": p.name if p else None,
        "payee_verified": bool(p and p.verified_at), "status": o.status, "doc_hash": o.doc_hash,
    }  # fmt: skip


def get_obligation(state: ToolState, a: dict[str, Any]) -> dict[str, Any]:
    db, user = state.db, state.user
    q = select(Obligation).where(Obligation.user_id == user.id)
    oid, did, kw = _resolve(a.get("obligation_id"), state), a.get("document_id"), a.get("keyword")
    if oid:
        o = db.get(Obligation, oid)
        return _obligation_dict(db, o) if o and o.user_id == user.id else {"found": False}
    if did:
        d = db.get(Document, did)
        if d is None or d.owner_id != user.id:
            return {"found": False}
        o2 = db.execute(q.where(Obligation.doc_hash == d.doc_hash, Obligation.status != "cancelled")).scalars().first()
        if o2:
            return _obligation_dict(db, o2)
        return {
            "found": False,
            "document_status": d.status,
            "needs_confirmation": d.status == "pending_confirmation",
        }
    rows = list(db.execute(q.where(Obligation.status == "open").order_by(Obligation.due_date)).scalars())
    if kw:
        k = str(kw).lower()
        hit = [o for o in rows if k in (o.title or "").lower() or k in (o.reference or "").lower()]
        rows = hit or rows
    return _obligation_dict(db, rows[0]) if rows else {"found": False}


def list_obligations_due(state: ToolState, a: dict[str, Any]) -> dict[str, Any]:
    by_s = a.get("by")
    by = date.fromisoformat(by_s) if by_s else date.max
    rows = list(
        state.db.execute(
            select(Obligation)
            .where(Obligation.user_id == state.user.id, Obligation.status == "open")
            .order_by(Obligation.due_date)
        ).scalars()
    )
    sel = [o for o in rows if o.due_date <= by]
    total = budget.total_due_by([budget.Obl(o.amount_cny, o.due_date) for o in rows], by)
    return {
        "by": by_s, "count": len(sel), "total_cny": str(total.quantize(Decimal("0.01"))),
        "items": [{"obligation_id": o.id, "title": o.title, "amount_cny": str(o.amount_cny),
                   "due_date": o.due_date.isoformat()} for o in sel],
    }  # fmt: skip


def fx_quote(state: ToolState, a: dict[str, Any]) -> dict[str, Any]:
    amt = _dec(_resolve(a.get("amount_cny"), state)) or Decimal("1000")
    q = services.fx_quote_out(amt, str(a.get("quote") or "BDT"), state.fx)
    return {"pair": q.pair, "rate": str(q.rate), "amount_cny": str(q.amount_cny),
            "amount_converted": str(q.amount_converted), "source": q.source, "is_live": q.is_live,
            "as_of": q.as_of.isoformat(), "disclaimer": q.disclaimer}  # fmt: skip


def compute_costs(state: ToolState, a: dict[str, Any]) -> dict[str, Any]:
    amt = _dec(_resolve(a.get("amount_cny"), state))
    if amt is None or amt <= 0:
        return {"ok": False, "reason": "no positive amount to cost"}
    c = costs.compute_costs(amt, state.fx, a.get("channel") or costs.DEFAULT_CHANNEL)
    out = {
        "ok": True, "channel": c.channel, "amount_cny": str(c.amount_cny), "fx_rate": str(c.fx_rate),
        "fx_source": c.fx_source, "fees": [{"label": f.label, "amount_cny": str(f.amount_cny)} for f in c.fees],
        "total_fees_cny": str(c.total_fees_cny), "fee_pct": str(c.fee_pct), "total_cny": str(c.total_cny),
        "bdt_needed": str(c.bdt_needed), "notes": c.notes,
    }  # fmt: skip
    state.last_plan = out
    return out


def budget_summary(state: ToolState, a: dict[str, Any]) -> dict[str, Any]:
    from app.models import ActionRow

    spent = Decimal("0")
    month = state.today.strftime("%Y-%m")
    for r in state.db.execute(
        select(ActionRow).where(
            ActionRow.owner_id == state.user.id,
            ActionRow.type == "payment",
            ActionRow.status == "executed",
        )
    ).scalars():
        if aware(r.created_at) and aware(r.created_at).strftime("%Y-%m") == month:  # type: ignore[union-attr]
            spent += Decimal(json.loads(r.params_json)["amount_cny"])
    b = budget.summarize(state.user.monthly_budget_cny, spent)
    return {"monthly_budget_cny": str(b.monthly_budget_cny), "spent_this_month_cny": str(b.spent_this_month_cny),
            "remaining_cny": str(b.remaining_cny), "over_budget": b.over_budget}  # fmt: skip


def _registry_payee_by_token(state: ToolState, hint: str | None) -> Payee | None:
    if not hint:
        return None
    raw = state.token_map.get(hint, hint)
    if not tokenize.is_valid_account(raw):
        return None
    return services.find_payee_by_account(state.db, state.user.id, raw)


def propose_payment(state: ToolState, a: dict[str, Any]) -> dict[str, Any]:
    """Resolve amount/payee SERVER-SIDE (never from model text), then queue a proposal."""
    db, user = state.db, state.user
    origin = a.get("origin", "user")
    oid = _resolve(a.get("obligation_id"), state)
    did = a.get("document_id")
    st = get_settings()
    cap = {"t2_cap_cny": f"{Decimal(st.t2_cap_cny):.2f}", "cooling_off_hours": st.cooling_off_hours}
    if oid:
        o = db.get(Obligation, oid)
        if o is None or o.user_id != user.id:
            return {"proposed": False, "reason": "obligation not found"}
        costs_out = (
            state.last_plan if state.last_plan and state.last_plan.get("amount_cny") == str(o.amount_cny) else None
        )
        state.proposals.append(Proposal("payment", {
            "obligation_id": o.id, "amount_cny": str(o.amount_cny), "payee_id": o.payee_id,
            "payee_name": (db.get(Payee, o.payee_id).name if o.payee_id else None),  # type: ignore[union-attr]
            "reference": o.reference, "document_amount_cny": str(o.amount_cny)},
            "confirmed_obligation", costs_out))  # fmt: skip
        return {
            "proposed": True,
            "amount_cny": str(o.amount_cny),
            "source": "confirmed_obligation",
            **cap,
        }
    if did:
        d = db.get(Document, did)
        if d is None or d.owner_id != user.id:
            return {"proposed": False, "reason": "document not found"}
        parsed = json.loads(d.parsed_json)
        plain = doc_service.doc_plain(d)
        doc_acct = plain.get("account_number")
        payee = _registry_payee_by_token(state, doc_acct)
        state.proposals.append(Proposal("payment", {
            "amount_cny": parsed.get("amount_cny"), "payee_id": payee.id if payee else None,
            "payee_name": parsed.get("payee_name"), "document_id": d.id,
            "payee_account_token": tokenize.account_token(doc_acct) if doc_acct else None},
            "document_text"))  # fmt: skip
        if d.status == "blocked":
            state.guardian_blocked_docs.add(d.id)
        return {
            "proposed": True,
            "amount_cny": parsed.get("amount_cny"),
            "source": "document_text",
            **cap,
        }
    # free-form (model/user text): payee must resolve in registry or it is blocked by policy
    payee = _registry_payee_by_token(state, a.get("payee_account"))
    amt = _dec(a.get("amount_cny"))
    src = "user_instruction" if origin == "user" else {"message": "message_text"}.get(origin, "model_suggestion")
    state.proposals.append(Proposal("payment", {
        "amount_cny": str(amt) if amt else None, "payee_id": payee.id if payee else None,
        "payee_name": payee.name if payee else None,
        "payee_account_token": a.get("payee_account")}, src))  # fmt: skip
    return {"proposed": True, "amount_cny": str(amt) if amt else None, "source": src, **cap}


def propose_verify_payee(state: ToolState, a: dict[str, Any]) -> dict[str, Any]:
    raw = state.token_map.get(a.get("account_number") or "", a.get("account_number"))
    st = get_settings()
    if not raw or not tokenize.is_valid_account(raw):
        return {"proposed": False, "reason": "no valid account number found in the message"}
    name = a.get("name")
    if not name:
        # name unknown from an SMS: reuse the single verified payee name if the user has exactly one
        # recent obligation payee; else a generic placeholder (needs human completion)
        o = (
            state.db.execute(
                select(Obligation)
                .where(Obligation.user_id == state.user.id, Obligation.status == "open")
                .order_by(Obligation.due_date)
            )
            .scalars()
            .first()
        )
        p0 = state.db.get(Payee, o.payee_id) if o and o.payee_id else None
        name = p0.name if p0 else "Unknown payee (from message)"
    payee, warnings = services.create_payee(state.db, state.user, name, raw, "(unverified, from message)", source="sms")
    state.proposals.append(Proposal("verify_payee", {"payee_id": payee.id, "payee_name": payee.name,
                                                      "account_masked": payee.account_masked,
                                                      "warnings": warnings}, "user_instruction"))  # fmt: skip
    return {"proposed": True, "payee_id": payee.id, "account_masked": payee.account_masked,
            "account_token": payee.account_token, "warnings": warnings,
            "cooling_off_hours": st.cooling_off_hours}  # fmt: skip


def draft_message(state: ToolState, a: dict[str, Any]) -> dict[str, Any]:
    purpose = a.get("purpose", "confirm_account")
    body = {
        "confirm_account": "Dear Finance Office, I received a message saying your bank account for fee payments has changed. "
        "Before paying, please confirm the correct account through your official channel. Thank you. (DRAFT - not sent)",
        "request_extension": "Dear Finance Office, I would like to ask about a short extension for my fee payment. (DRAFT - not sent)",
    }[purpose]
    state.proposals.append(Proposal("draft_message", {"to": a.get("to", "university"), "purpose": purpose,
                                                       "body": body}, "user_instruction"))  # fmt: skip
    return {"drafted": True, "sent": False, "body": body}


TOOLS = {
    "get_obligation": get_obligation, "list_obligations_due": list_obligations_due, "fx_quote": fx_quote,
    "compute_costs": compute_costs, "budget_summary": budget_summary, "propose_payment": propose_payment,
    "propose_verify_payee": propose_verify_payee, "draft_message": draft_message,
}  # fmt: skip
