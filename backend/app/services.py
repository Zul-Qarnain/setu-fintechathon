"""Application services (business logic lives here, not in routes)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas as s
from app import security
from app.config import get_settings
from app.db import append_audit
from app.deps import api_error
from app.domain import crypto, tokenize
from app.domain.fx import FxService, get_fx_service
from app.models import ActionRow, Obligation, Payee, User, aware

# ---------- users ----------


def user_out(u: User) -> s.UserOut:
    return s.UserOut(id=u.id, email=u.email, role=u.role, locale=u.locale,  # type: ignore[arg-type]
                     totp_enabled=u.totp_enabled, approver_id=u.approver_id)  # fmt: skip


def register_user(db: Session, body: s.RegisterRequest) -> User:
    email = body.email.strip().lower()
    if "@" not in email or len(email) > 254:
        raise api_error(422, "validation_error", "Invalid email")
    if db.execute(select(User).where(User.email == email)).scalar_one_or_none():
        raise api_error(409, "EMAIL_EXISTS", "Email already registered")
    approver_id = None
    if body.approver_email:
        ap = db.execute(select(User).where(User.email == body.approver_email.strip().lower())).scalar_one_or_none()
        if ap is None or ap.role != "family_approver":
            raise api_error(422, "validation_error", "approver_email must be a registered family_approver")
        approver_id = ap.id
    if body.role == "admin" and not get_settings().demo_mode:
        raise api_error(403, "FORBIDDEN", "Admin accounts cannot self-register")
    user = User(email=email, password_hash=security.hash_password(body.password), role=body.role,
                locale=body.locale, approver_id=approver_id)  # fmt: skip
    db.add(user)
    db.flush()
    append_audit(db, user.id, "user.registered", {"role": user.role, "locale": user.locale})
    return user


# ---------- payees ----------


def payee_out(p: Payee) -> s.PayeeOut:
    verified = p.verified_at is not None
    return s.PayeeOut(
        id=p.id, owner_id=p.owner_id, name=p.name, account_masked=p.account_masked,
        account_token=p.account_token, bank=p.bank, verified=verified,
        verified_at=aware(p.verified_at), cooling_off_until=aware(p.cooling_off_until),
        created_at=aware(p.created_at),  # type: ignore[arg-type]
    )  # fmt: skip


def find_payee_by_account(db: Session, owner_id: str, account_number: str) -> Payee | None:
    h = tokenize.account_hash(account_number)
    return db.execute(select(Payee).where(Payee.owner_id == owner_id, Payee.account_hash == h)).scalars().first()


def find_payees_by_name(db: Session, owner_id: str, name: str) -> list[Payee]:
    sk = tokenize.name_skeleton(name)
    return list(db.execute(select(Payee).where(Payee.owner_id == owner_id, Payee.name_skeleton == sk)).scalars())


def create_payee(
    db: Session, owner: User, name: str, account_number: str, bank: str, source: str = "manual",
    verified: bool = False, cooling_hours: int | None = None,
) -> tuple[Payee, list[str]]:  # fmt: skip
    """Create a payee in the registry. Returns (payee, warnings). New payees start UNVERIFIED."""
    warnings: list[str] = []
    if not tokenize.is_valid_account(account_number):
        raise api_error(
            422,
            "INVALID_ACCOUNT",
            "Account number must be 8-24 ASCII digits (no lookalike characters)",
        )
    existing = find_payee_by_account(db, owner.id, account_number)
    if existing is not None:
        return existing, ["ALREADY_EXISTS"]
    changed_from: str | None = None
    for other in find_payees_by_name(db, owner.id, name):
        if other.verified_at is not None:
            changed_from = other.id
            warnings.append("PAYEE_CHANGED")
            break
    if tokenize.has_homoglyphs(name):
        warnings.append("HOMOGLYPH_NAME")
    hours = get_settings().cooling_off_hours if cooling_hours is None else cooling_hours
    now = datetime.now(UTC)
    p = Payee(
        owner_id=owner.id, name=name.strip(), name_skeleton=tokenize.name_skeleton(name),
        account_hash=tokenize.account_hash(account_number),
        account_enc="", account_masked=tokenize.mask_account(account_number),
        account_token=tokenize.account_token(account_number), bank=bank.strip(), source=source,
        changed_from_id=changed_from,
        cooling_off_until=(now + timedelta(hours=hours)).replace(tzinfo=None) if hours else None,
        verified_at=now.replace(tzinfo=None) if verified else None,
    )  # fmt: skip
    db.add(p)
    db.flush()
    p.account_enc = crypto.encrypt(tokenize.normalize_account(account_number), aad=f"payee:{p.id}")
    append_audit(db, owner.id, "payee.created", {
        "payee_id": p.id, "source": source, "account_token": p.account_token,
        "changed_from": changed_from, "warnings": warnings})  # fmt: skip
    return p, warnings


def payee_account_number(p: Payee) -> str:
    return crypto.decrypt(p.account_enc, aad=f"payee:{p.id}")


def verify_payee(db: Session, approver: User, p: Payee) -> Payee:
    owner = db.get(User, p.owner_id)
    if owner is None:
        raise api_error(404, "NOT_FOUND", "Payee not found")
    if approver.role != "admin" and not (approver.role == "family_approver" and owner.approver_id == approver.id):
        raise api_error(403, "FORBIDDEN", "Only the owner's linked family approver (or admin) can verify")
    p.verified_at = datetime.now(UTC).replace(tzinfo=None)
    append_audit(db, approver.id, "payee.verified", {"payee_id": p.id, "owner_id": p.owner_id,
                                                      "cooling_off_until": str(p.cooling_off_until)})  # fmt: skip
    return p


# ---------- obligations / dashboard ----------


def obligation_out(db: Session, o: Obligation) -> s.ObligationOut:
    payee = db.get(Payee, o.payee_id) if o.payee_id else None
    return s.ObligationOut(
        id=o.id, amount_cny=o.amount_cny, due_date=o.due_date, payee_id=o.payee_id,
        payee_name=payee.name if payee else None, doc_hash=o.doc_hash, status=o.status,  # type: ignore[arg-type]
    )  # fmt: skip


def fx_quote_out(amount: Decimal, quote_ccy: str = "BDT", fx: FxService | None = None) -> s.FxQuote:
    fx = fx or get_fx_service()
    conv, r = fx.convert(amount, "CNY", quote_ccy)
    return s.FxQuote(
        pair=f"{r.base}/{r.quote}", base=r.base, quote=r.quote, rate=r.rate, amount_cny=amount,
        amount_converted=conv, source=r.source,  # type: ignore[arg-type]
        is_live=r.is_live, as_of=r.as_of, cached=r.cached, disclaimer=r.disclaimer,
    )  # fmt: skip


def parse_json(text: str | None, default: Any = None) -> Any:
    return json.loads(text) if text else default


def count_pending_actions(db: Session, user: User) -> int:
    q = select(ActionRow).where(ActionRow.status.in_(["awaiting_approval", "cooling_off"]))
    if user.role == "family_approver":
        ids = [u.id for u in db.execute(select(User).where(User.approver_id == user.id)).scalars()]
        q = q.where(ActionRow.owner_id.in_(ids or ["-"]))
    else:
        q = q.where(ActionRow.owner_id == user.id)
    return len(list(db.execute(q).scalars()))
