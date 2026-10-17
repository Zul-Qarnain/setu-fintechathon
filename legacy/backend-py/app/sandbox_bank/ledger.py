"""Sandbox bank ledger (SYNTHETIC). Idempotent transfers with deterministic failure rules.

Deterministic failures (so demos/tests are reproducible):
  * destination account number ending in "0013"  -> ACCOUNT_CLOSED (failed)
  * amount over CNY 50,000.00                    -> LIMIT_EXCEEDED (failed)
  * amount whose cents are .99                   -> RISK_HOLD (state "held", funds not moved)
  * balance below amount                         -> INSUFFICIENT_FUNDS (failed)
The same idempotency key returns the stored result; reuse with different parameters raises
IdempotencyMismatch. Setu never holds funds; this ledger is a simulator only.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.tokenize import normalize_account
from app.models import BankAccount, BankTxn

PER_TXN_LIMIT = Decimal("50000.00")


class IdempotencyMismatch(Exception):
    pass


class UnknownAccount(Exception):
    pass


@dataclass(frozen=True)
class TransferResult:
    txn_id: str
    state: str  # settled | failed | held
    failure_code: str | None
    amount_cny: Decimal
    from_account: str
    to_account_number: str
    idempotent_replay: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "bank_txn_id": self.txn_id, "state": self.state, "failure_code": self.failure_code,
            "amount_cny": str(self.amount_cny), "sandbox": True,
            "idempotent_replay": self.idempotent_replay,
        }  # fmt: skip


def _req_hash(from_acct: str, to_number: str, amount: Decimal, reference: str | None) -> str:
    raw = f"{from_acct}|{to_number}|{amount:.2f}|{reference or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()


def open_account(
    session: Session, account_number: str, holder: str, balance: Decimal = Decimal("0"),
    owner_id: str | None = None,
) -> BankAccount:  # fmt: skip
    n = normalize_account(account_number)
    existing = session.execute(select(BankAccount).where(BankAccount.account_number == n)).scalar_one_or_none()
    if existing:
        return existing
    acct = BankAccount(account_number=n, holder=holder, balance_cny=balance, owner_id=owner_id)
    session.add(acct)
    session.flush()
    return acct


def get_account(session: Session, account_number: str) -> BankAccount | None:
    n = normalize_account(account_number)
    return session.execute(select(BankAccount).where(BankAccount.account_number == n)).scalar_one_or_none()


def transfer(
    session: Session,
    idempotency_key: str,
    from_account_number: str,
    to_account_number: str,
    amount_cny: Decimal,
    reference: str | None = None,
) -> TransferResult:
    src_n, dst_n = normalize_account(from_account_number), normalize_account(to_account_number)
    rh = _req_hash(src_n, dst_n, amount_cny, reference)
    prior = session.execute(select(BankTxn).where(BankTxn.idempotency_key == idempotency_key)).scalar_one_or_none()
    if prior is not None:
        if prior.request_hash != rh:
            raise IdempotencyMismatch("idempotency key reused with different parameters")
        return TransferResult(prior.id, prior.state, prior.failure_code, prior.amount_cny,
                              prior.from_account, prior.to_account_number, True)  # fmt: skip
    src = get_account(session, src_n)
    if src is None:
        raise UnknownAccount("source account not found")
    amount = amount_cny.quantize(Decimal("0.01"))
    state, code = "settled", None
    dst = get_account(session, dst_n)
    if amount <= 0:
        state, code = "failed", "INVALID_AMOUNT"
    elif dst_n.endswith("0013") or (dst is not None and dst.closed):
        state, code = "failed", "ACCOUNT_CLOSED"
    elif amount > PER_TXN_LIMIT:
        state, code = "failed", "LIMIT_EXCEEDED"
    elif amount % 1 == Decimal("0.99"):
        state, code = "held", "RISK_HOLD"
    elif src.balance_cny < amount:
        state, code = "failed", "INSUFFICIENT_FUNDS"
    if state == "settled":
        src.balance_cny = src.balance_cny - amount
        if dst is not None:
            dst.balance_cny = dst.balance_cny + amount
    txn = BankTxn(idempotency_key=idempotency_key, request_hash=rh, from_account=src_n,
                  to_account_number=dst_n, amount_cny=amount, reference=reference,
                  state=state, failure_code=code)  # fmt: skip
    session.add(txn)
    session.flush()
    return TransferResult(txn.id, state, code, amount, src_n, dst_n, False)


def list_transactions(session: Session, account_number: str) -> list[BankTxn]:
    n = normalize_account(account_number)
    q = select(BankTxn).where((BankTxn.from_account == n) | (BankTxn.to_account_number == n))
    return list(session.execute(q.order_by(BankTxn.created_at)).scalars())
