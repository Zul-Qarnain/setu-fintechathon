"""Executor: performs side effects ONLY for Decision.ALLOW. The LLM never reaches this."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import services
from app.db import append_audit
from app.domain.policy import ActionType, Decision, Outcome
from app.models import ActionRow, BankAccount, Obligation, Payee, User
from app.sandbox_bank import ledger


class PolicyViolation(Exception):
    """Raised when the executor is asked to run something the policy engine did not ALLOW."""


def execute(db: Session, action: ActionRow, decision: Decision) -> dict[str, Any]:
    if decision.outcome is not Outcome.ALLOW:
        append_audit(db, "executor", "executor.refused", {"action_id": action.id,
                                                          "outcome": decision.outcome.value})  # fmt: skip
        raise PolicyViolation(f"executor refuses non-ALLOW decision: {decision.outcome.value}")
    if action.status in ("executed", "failed", "rejected", "blocked"):
        raise PolicyViolation(f"action already terminal: {action.status}")
    params: dict[str, Any] = __import__("json").loads(action.params_json)
    atype = ActionType(action.type)
    if atype is ActionType.PAYMENT:
        return _pay(db, action, params)
    if atype is ActionType.VERIFY_PAYEE:
        return _verify_payee(db, action, params)
    if atype is ActionType.DRAFT_MESSAGE:
        action.status = "executed"
        return {"drafted": True, "sent": False}
    action.status = "executed"
    return {"noop": True}


def _pay(db: Session, action: ActionRow, params: dict[str, Any]) -> dict[str, Any]:
    payee = db.get(Payee, params["payee_id"])
    owner = db.get(User, action.owner_id)
    if payee is None or owner is None or payee.owner_id != owner.id:
        raise PolicyViolation("payee/owner mismatch at execution time")
    src = db.execute(select(BankAccount).where(BankAccount.owner_id == owner.id)).scalars().first()
    if src is None:
        action.status = "failed"
        return {"state": "failed", "failure_code": "NO_SANDBOX_ACCOUNT", "sandbox": True}
    res = ledger.transfer(db, action.idempotency_key, src.account_number,
                          services.payee_account_number(payee), Decimal(params["amount_cny"]),
                          params.get("reference"))  # fmt: skip
    result = res.as_dict()
    if res.state == "settled":
        action.status = "executed"
        ob_id = params.get("obligation_id")
        ob = db.get(Obligation, ob_id) if ob_id else None
        if ob is not None:
            ob.status = "paid"
    else:
        action.status = "failed"
    append_audit(db, "executor", "payment.executed" if res.state == "settled" else "payment.failed",
                 {"action_id": action.id, "amount_cny": params["amount_cny"], "payee_id": payee.id,
                  "bank_txn_id": res.txn_id, "state": res.state, "failure_code": res.failure_code})  # fmt: skip
    return result


def _verify_payee(db: Session, action: ActionRow, params: dict[str, Any]) -> dict[str, Any]:
    payee = db.get(Payee, params["payee_id"])
    if payee is None:
        raise PolicyViolation("payee missing")
    payee.verified_at = datetime.now(UTC).replace(tzinfo=None)
    action.status = "executed"
    append_audit(db, "executor", "payee.verified", {"action_id": action.id, "payee_id": payee.id})
    return {"payee_id": payee.id, "verified": True}
