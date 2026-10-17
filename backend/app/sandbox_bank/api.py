"""Read-only sandbox bank HTTP API (the simulator). Mounted at /sandbox."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import current_user
from app.models import BankAccount, BankTxn, User
from app.sandbox_bank import ledger

router = APIRouter(prefix="/sandbox", tags=["sandbox-bank"])


@router.get("/account")
def my_account(user: User = Depends(current_user), db: Session = Depends(get_session)) -> dict[str, Any]:
    acct = db.execute(select(BankAccount).where(BankAccount.owner_id == user.id)).scalars().first()
    if acct is None:
        return {"account": None, "synthetic": True}
    return {
        "account": {"account_masked": "****" + acct.account_number[-4:], "holder": acct.holder,
                    "balance_cny": str(acct.balance_cny)},
        "synthetic": True, "sandbox": True,
    }  # fmt: skip


@router.get("/transactions")
def my_transactions(user: User = Depends(current_user), db: Session = Depends(get_session)) -> dict[str, Any]:
    acct = db.execute(select(BankAccount).where(BankAccount.owner_id == user.id)).scalars().first()
    if acct is None:
        return {"transactions": [], "synthetic": True}
    txns: list[BankTxn] = ledger.list_transactions(db, acct.account_number)
    return {
        "transactions": [
            {"id": t.id, "state": t.state, "failure_code": t.failure_code,
             "amount_cny": str(t.amount_cny), "reference": t.reference,
             "to_masked": "****" + t.to_account_number[-4:], "created_at": t.created_at.isoformat()}
            for t in txns
        ],
        "synthetic": True,
    }  # fmt: skip
