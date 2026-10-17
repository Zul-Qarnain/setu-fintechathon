"""Pydantic v2 API schemas. Money is Decimal serialised as a *string* in JSON."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["student", "family_approver", "admin"]
Tier = Literal["T0", "T1", "T2", "T3", "T4"]
Outcome = Literal["ALLOW", "REQUIRE_APPROVAL", "REQUIRE_COOLING_OFF", "BLOCK"]
ActionStatus = Literal[
    "draft",
    "awaiting_approval",
    "cooling_off",
    "approved",
    "executed",
    "rejected",
    "blocked",
    "failed",
]
Intent = Literal[
    "pay_obligation",
    "quote_fx",
    "how_much_needed",
    "payee_change",
    "explain_fees",
    "unsafe_request",
    "unknown",
]


class Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- errors ----------
class ErrorBody(Base):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(Base):
    error: ErrorBody
    request_id: str


# ---------- auth ----------
class RegisterRequest(Base):
    email: str
    password: str = Field(min_length=10)
    role: Role = "student"
    locale: Literal["en", "zh-CN"] = "en"
    approver_email: str | None = None  # students may link a family approver at signup


class UserOut(Base):
    id: str
    email: str
    role: Role
    locale: str
    totp_enabled: bool
    approver_id: str | None = None
    synthetic: bool = True


class LoginRequest(Base):
    email: str
    password: str


class TokenResponse(Base):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut


class TotpSetupResponse(Base):
    secret: str
    otpauth_uri: str


class TotpVerifyRequest(Base):
    code: str = Field(min_length=6, max_length=6)


class TotpVerifyResponse(Base):
    verified: bool
    totp_enabled: bool


# ---------- documents ----------
class ParsedNotice(Base):
    amount_cny: Decimal | None
    due_date: date | None
    payee_name: str | None
    account_masked: str | None
    reference: str | None
    language: Literal["en", "zh", "mixed", "unknown"]


class GuardianFlag(Base):
    code: str
    severity: Literal["info", "warn", "block"]
    message: str


class GuardianVerdict(Base):
    verdict: Literal["clean", "suspicious", "blocked"]
    score: float
    flags: list[GuardianFlag]


class DocumentCreate(Base):
    filename: str = "notice.txt"
    text: str = Field(max_length=20000)
    synthetic: bool = True


class DocumentOut(Base):
    id: str
    filename: str
    doc_hash: str
    status: Literal["pending_confirmation", "confirmed", "blocked"]
    parsed: ParsedNotice
    guardian: GuardianVerdict
    untrusted: bool = True
    synthetic: bool = True
    created_at: datetime


class DocumentConfirm(Base):
    amount_cny: Decimal
    due_date: date
    payee_name: str
    account_number: str | None = None
    reference: str | None = None


class ObligationOut(Base):
    id: str
    amount_cny: Decimal
    due_date: date
    payee_id: str | None
    payee_name: str | None
    doc_hash: str | None
    status: Literal["open", "planned", "paid", "blocked", "cancelled"]


class DocumentConfirmResponse(Base):
    document: DocumentOut
    obligation: ObligationOut | None
    guardian: GuardianVerdict
    blocked: bool
    audit_seq: int | None = None


# ---------- payees ----------
class PayeeCreate(Base):
    name: str = Field(min_length=1, max_length=200)
    account_number: str = Field(min_length=4, max_length=64)
    bank: str = Field(min_length=1, max_length=200)
    source: Literal["manual", "document", "sms"] = "manual"


class PayeeOut(Base):
    id: str
    owner_id: str
    name: str
    account_masked: str
    account_token: str  # HMAC token, e.g. ACCT_7f3a91c2e0
    bank: str
    verified: bool
    verified_at: datetime | None
    cooling_off_until: datetime | None = None
    created_at: datetime


# ---------- fx ----------
class FxQuote(Base):
    pair: str
    base: str
    quote: str
    rate: Decimal
    amount_cny: Decimal
    amount_converted: Decimal
    source: Literal["fixture-sample", "live-open.er-api.com"]
    is_live: bool
    as_of: datetime
    cached: bool
    disclaimer: str


# ---------- plan / actions / chat ----------
class FeeLine(Base):
    label: str
    amount_cny: Decimal


class PlanOut(Base):
    channel: str
    amount_cny: Decimal
    fx_rate: Decimal
    fx_source: str
    fees: list[FeeLine]
    total_fees_cny: Decimal
    fee_pct: Decimal
    bdt_needed: Decimal
    due_date: date | None
    notes: list[str] = Field(default_factory=list)


class DecisionOut(Base):
    outcome: Outcome
    tier: Tier
    reasons: list[str]  # machine codes, e.g. NEW_PAYEE, OVER_T2_CAP, DOC_ONLY_SOURCE
    required: list[str]  # subset of: totp, family_approver, cooling_off
    cooling_off_until: datetime | None = None
    explanation: str


class ApprovalRecord(Base):
    approver_id: str
    role: Role
    at: datetime
    kind: Literal["totp", "family_approver", "reject"]


class ActionOut(Base):
    id: str
    plan_id: str | None
    type: Literal["payment", "draft_message", "verify_payee", "export_data", "read"]
    tier: Tier
    status: ActionStatus
    params: dict[str, Any]
    decision: DecisionOut
    approvals: list[ApprovalRecord] = Field(default_factory=list)
    created_at: datetime
    result: dict[str, Any] | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    document_id: str | None = None
    locale: Literal["en", "zh-CN"] = "en"


class TraceStep(Base):
    step: Literal["intake", "planner", "tools", "guardian", "policy", "executor", "validator"]
    status: Literal["ok", "blocked", "skipped", "rejected"]
    duration_ms: int
    detail: dict[str, Any] = Field(default_factory=dict)


class ToolCallTrace(Base):
    tool: str
    args: dict[str, Any]
    output: dict[str, Any]
    ok: bool = True


class Trace(Base):
    trace_id: str
    llm_mode: Literal["scripted-offline", "gemini", "groq"]
    steps: list[TraceStep]
    tool_calls: list[ToolCallTrace]
    tier: Tier
    decision: Outcome
    reply_validated: bool
    audit_seqs: list[int] = Field(default_factory=list)


class ChatResponse(Base):
    reply: str
    intent: Intent
    plan: PlanOut | None
    proposed_actions: list[ActionOut]
    trace: Trace


class ApproveRequest(BaseModel):
    totp_code: str = Field(min_length=6, max_length=6)


class RejectRequest(BaseModel):
    reason: str = ""


# ---------- audit / evidence ----------
class AuditEntry(Base):
    seq: int
    ts: datetime
    actor: str
    event: str
    payload_hash: str
    prev_hash: str
    hash: str
    payload: dict[str, Any] | None = None


class AuditVerify(Base):
    ok: bool
    checked: int
    broken_at_seq: int | None = None
    reason: str | None = None


class AuditResponse(Base):
    entries: list[AuditEntry]
    verify: AuditVerify | None = None


class DashboardOut(Base):
    user: UserOut
    obligations: list[ObligationOut]
    next_due: ObligationOut | None
    bdt_needed_next: Decimal | None
    pending_actions: int
    monthly_budget_cny: Decimal
    spent_this_month_cny: Decimal
    fx: FxQuote
    synthetic: bool = True
