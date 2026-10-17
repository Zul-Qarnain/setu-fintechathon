"""Action lifecycle: propose -> policy -> approvals (TOTP, family approver) -> execute."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas as s
from app.agents import executor
from app.config import get_settings
from app.db import append_audit
from app.deps import api_error, verify_user_totp
from app.domain import policy
from app.models import ActionRow, Payee, User, aware

ACTIVE = ("awaiting_approval", "cooling_off", "approved", "executed")


def payee_state(p: Payee | None) -> policy.PayeeState | None:
    if p is None:
        return None
    return policy.PayeeState(
        payee_id=p.id, owner_id=p.owner_id, verified=p.verified_at is not None,
        cooling_off_until=aware(p.cooling_off_until), changed=p.changed_from_id is not None,
    )  # fmt: skip


def _ctx(db: Session, action: ActionRow, params: dict[str, Any], approvals: set[str]) -> policy.Context:
    st = get_settings()
    recent = Decimal("0")
    if action.type == "payment" and params.get("payee_id"):
        since = (datetime.now(UTC) - timedelta(hours=24)).replace(tzinfo=None)
        q = select(ActionRow).where(ActionRow.owner_id == action.owner_id, ActionRow.type == "payment",
                                    ActionRow.status.in_(ACTIVE), ActionRow.created_at >= since,
                                    ActionRow.id != action.id)  # fmt: skip
        for other in db.execute(q).scalars():
            op = json.loads(other.params_json)
            if op.get("payee_id") == params["payee_id"]:
                recent += Decimal(op["amount_cny"])
    return policy.Context(
        now=datetime.now(UTC), guardian_blocked=bool(params.get("_guardian_blocked")),
        recent_same_payee_cny=recent, approvals=frozenset(approvals),
        t2_cap=Decimal(st.t2_cap_cny), cooling_off=timedelta(hours=st.cooling_off_hours),
    )  # fmt: skip


def policy_action(db: Session, action: ActionRow) -> policy.Action:
    params = json.loads(action.params_json)
    payee = db.get(Payee, params["payee_id"]) if params.get("payee_id") else None
    return policy.Action(
        type=policy.ActionType(action.type), owner_id=action.owner_id,
        amount_cny=Decimal(params["amount_cny"]) if params.get("amount_cny") else None,
        payee=payee_state(payee), source=action.source, bulk=bool(params.get("bulk")),
        document_amount_cny=Decimal(params["document_amount_cny"]) if params.get("document_amount_cny") else None,
    )  # fmt: skip


def approvals_set(action: ActionRow) -> set[str]:
    return {a["kind"] for a in json.loads(action.approvals_json) if a["kind"] != "reject"}


def evaluate(db: Session, action: ActionRow) -> policy.Decision:
    params = json.loads(action.params_json)
    return policy.decide(policy_action(db, action), _ctx(db, action, params, approvals_set(action)))


def _status_for(d: policy.Decision, atype: str) -> str:
    if d.outcome is policy.Outcome.BLOCK:
        return "blocked"
    if d.outcome is policy.Outcome.REQUIRE_COOLING_OFF:
        return "cooling_off"
    if d.outcome is policy.Outcome.REQUIRE_APPROVAL:
        return "awaiting_approval"
    return "draft" if atype == "draft_message" else "approved"


def propose(
    db: Session, owner: User, atype: str, params: dict[str, Any], source: str,
    plan_id: str | None = None,
) -> tuple[ActionRow, policy.Decision]:  # fmt: skip
    """Create an action row and let the POLICY ENGINE classify it. Never executes payments."""
    row = ActionRow(owner_id=owner.id, plan_id=plan_id, type=atype, tier="T4", params_json=json.dumps(params),
                    status="draft", source=source, idempotency_key="idem_" + uuid.uuid4().hex[:16])  # fmt: skip
    db.add(row)
    db.flush()
    d = evaluate(db, row)
    row.tier = d.tier.value
    row.status = _status_for(d, atype)
    row.decision_json = json.dumps(decision_dict(d))
    append_audit(db, owner.id, "action.proposed" if d.outcome is not policy.Outcome.BLOCK else "action.blocked", {
        "action_id": row.id, "type": atype, "tier": d.tier.value, "outcome": d.outcome.value,
        "reasons": d.reasons, "source": source, "amount_cny": params.get("amount_cny"),
        "payee_id": params.get("payee_id")})  # fmt: skip
    return row, d


def decision_dict(d: policy.Decision) -> dict[str, Any]:
    return {"outcome": d.outcome.value, "tier": d.tier.value, "reasons": d.reasons, "required": d.required,
            "cooling_off_until": d.cooling_off_until.isoformat() if d.cooling_off_until else None,
            "explanation": d.explanation}  # fmt: skip


def action_out(db: Session, row: ActionRow) -> s.ActionOut:
    if row.status in ("awaiting_approval", "cooling_off", "approved", "draft"):
        d = evaluate(db, row)
        dec = decision_dict(d)
    else:
        dec = json.loads(row.decision_json)
    params = {k: v for k, v in json.loads(row.params_json).items() if not k.startswith("_")}
    params["idempotency_key"] = row.idempotency_key
    return s.ActionOut(
        id=row.id, plan_id=row.plan_id, type=row.type, tier=row.tier, status=row.status,  # type: ignore[arg-type]
        params=params, decision=s.DecisionOut(**dec),
        approvals=[s.ApprovalRecord(**a) for a in json.loads(row.approvals_json)],
        created_at=aware(row.created_at),  # type: ignore[arg-type]
        result=json.loads(row.result_json) if row.result_json else None,
    )  # fmt: skip


def visible_actions(db: Session, user: User, status: str | None = None) -> list[ActionRow]:
    q = select(ActionRow).order_by(ActionRow.created_at.desc())
    if user.role == "student":
        q = q.where(ActionRow.owner_id == user.id)
    elif user.role == "family_approver":
        ids = [u.id for u in db.execute(select(User).where(User.approver_id == user.id)).scalars()]
        q = q.where(ActionRow.owner_id.in_(ids or ["-"]))
    if status:
        q = q.where(ActionRow.status == status)
    return list(db.execute(q).scalars())


def get_visible(db: Session, user: User, action_id: str) -> ActionRow:
    row = db.get(ActionRow, action_id)
    if row is not None:
        if user.role == "admin" or row.owner_id == user.id:
            return row
        owner = db.get(User, row.owner_id)
        if user.role == "family_approver" and owner is not None and owner.approver_id == user.id:
            return row
    raise api_error(404, "NOT_FOUND", "Action not found")  # IDOR-safe


def approve(db: Session, actor: User, action_id: str, totp_code: str) -> ActionRow:
    row = get_visible(db, actor, action_id)
    if actor.role == "admin":
        raise api_error(403, "FORBIDDEN", "Admins cannot approve actions")
    if row.status not in ("awaiting_approval", "cooling_off"):
        raise api_error(409, "INVALID_STATE", f"Action is {row.status}; cannot approve",
                        {"status": row.status})  # fmt: skip
    kind = "totp" if actor.id == row.owner_id else "family_approver"
    if kind in approvals_set(row):
        raise api_error(409, "ALREADY_APPROVED", "You already approved this action")
    d = evaluate(db, row)
    if d.outcome is policy.Outcome.BLOCK:
        row.status, row.tier = "blocked", d.tier.value
        append_audit(db, actor.id, "action.blocked", {"action_id": row.id, "reasons": d.reasons})
        db.commit()
        raise api_error(403, "POLICY_BLOCKED", d.explanation, {"reasons": d.reasons})
    if d.cooling_off_until is not None and datetime.now(UTC) < d.cooling_off_until:
        append_audit(db, actor.id, "approval.rejected_cooling_off", {"action_id": row.id,
                                                                     "until": d.cooling_off_until.isoformat()})  # fmt: skip
        db.commit()
        raise api_error(409, "COOLING_OFF_ACTIVE", "Cooling-off period is still running",
                        {"cooling_off_until": d.cooling_off_until.isoformat()})  # fmt: skip
    verify_user_totp(db, actor, totp_code)  # replay + lockout enforced here
    approvals = json.loads(row.approvals_json)
    approvals.append({"approver_id": actor.id, "role": actor.role, "at": datetime.now(UTC).isoformat(),
                      "kind": kind})  # fmt: skip
    row.approvals_json = json.dumps(approvals)
    append_audit(db, actor.id, "action.approved", {"action_id": row.id, "kind": kind})
    d2 = evaluate(db, row)
    row.decision_json = json.dumps(decision_dict(d2))
    if d2.outcome is policy.Outcome.ALLOW:
        result = executor.execute(db, row, d2)  # re-checked by the executor itself
        row.result_json = json.dumps(result)
    else:
        row.status = _status_for(d2, row.type)
    return row


def reject(db: Session, actor: User, action_id: str, reason: str) -> ActionRow:
    row = get_visible(db, actor, action_id)
    if actor.role == "admin":
        raise api_error(403, "FORBIDDEN", "Admins cannot reject actions")
    if row.status not in ("awaiting_approval", "cooling_off", "draft", "approved"):
        raise api_error(409, "INVALID_STATE", f"Action is {row.status}; cannot reject", {"status": row.status})
    approvals = json.loads(row.approvals_json)
    approvals.append({"approver_id": actor.id, "role": actor.role, "at": datetime.now(UTC).isoformat(),
                      "kind": "reject"})  # fmt: skip
    row.approvals_json = json.dumps(approvals)
    row.status = "rejected"
    append_audit(db, actor.id, "action.rejected", {"action_id": row.id, "reason": reason[:200]})
    return row
