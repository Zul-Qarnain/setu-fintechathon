"""SQLAlchemy 2.0 models (spec schema + a few documented extras)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def utcnow() -> datetime:
    return datetime.now(UTC)


def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("usr"))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32))  # student | family_approver | admin
    locale: Mapped[str] = mapped_column(String(8), default="en")
    totp_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    totp_last_step: Mapped[int] = mapped_column(Integer, default=0)  # replay protection
    totp_failures: Mapped[int] = mapped_column(Integer, default=0)
    totp_locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approver_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    monthly_budget_cny: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    consent_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    erased: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Payee(Base):
    __tablename__ = "payees"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("pay"))
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    name_skeleton: Mapped[str] = mapped_column(String(200), index=True)
    account_hash: Mapped[str] = mapped_column(String(64), index=True)
    account_enc: Mapped[str] = mapped_column(Text)
    account_masked: Mapped[str] = mapped_column(String(32))
    account_token: Mapped[str] = mapped_column(String(32))
    bank: Mapped[str] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(16), default="manual")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cooling_off_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    changed_from_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("doc"))
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    doc_hash: Mapped[str] = mapped_column(String(80))
    text_enc: Mapped[str] = mapped_column(Text)
    parsed_json: Mapped[str] = mapped_column(Text)
    guardian_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="pending_confirmation")
    synthetic: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Obligation(Base):
    __tablename__ = "obligations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("obl"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount_cny: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    due_date: Mapped[date] = mapped_column(Date)
    payee_id: Mapped[str | None] = mapped_column(ForeignKey("payees.id"), nullable=True)
    doc_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")


class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("plan"))
    obligation_id: Mapped[str | None] = mapped_column(ForeignKey("obligations.id"), nullable=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    channel: Mapped[str] = mapped_column(String(120))
    bdt_needed: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    fees: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    plan_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ActionRow(Base):
    __tablename__ = "actions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("act"))
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    plan_id: Mapped[str | None] = mapped_column(ForeignKey("plans.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(32))
    tier: Mapped[str] = mapped_column(String(4))
    params_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24))
    approvals_json: Mapped[str] = mapped_column(Text, default="[]")
    decision_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(24), default="user_instruction")
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditRow(Base):
    __tablename__ = "audit"
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime)
    actor: Mapped[str] = mapped_column(String(64))
    event: Mapped[str] = mapped_column(String(64))
    payload_hash: Mapped[str] = mapped_column(String(64))
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class BankAccount(Base):
    """Sandbox bank account (SYNTHETIC)."""

    __tablename__ = "sbx_accounts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("sba"))
    owner_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    account_number: Mapped[str] = mapped_column(String(32), unique=True)
    holder: Mapped[str] = mapped_column(String(200))
    balance_cny: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    closed: Mapped[bool] = mapped_column(Boolean, default=False)


class BankTxn(Base):
    __tablename__ = "sbx_txns"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("sbx_txn"))
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    from_account: Mapped[str] = mapped_column(String(32))
    to_account_number: Mapped[str] = mapped_column(String(32))
    amount_cny: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str] = mapped_column(String(16))  # settled | failed | held
    failure_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
