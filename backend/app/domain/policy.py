"""Server-side policy engine. The ONLY authority that authorises actions (never the LLM).

decide(action, ctx) is pure and deterministic; it is re-evaluated at approval time and again
immediately before execution. The executor accepts only Outcome.ALLOW.

Tiers: T0 read; T1 draft; T2 <= cap to a VERIFIED payee (TOTP); T3 > cap or new/changed payee
(TOTP + family approver + 24h cooling-off for new payees); T4 blocked.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from enum import StrEnum


class Outcome(StrEnum):
    ALLOW = "ALLOW"
    REQUIRE_APPROVAL = "REQUIRE_APPROVAL"
    REQUIRE_COOLING_OFF = "REQUIRE_COOLING_OFF"
    BLOCK = "BLOCK"


class Tier(StrEnum):
    T0 = "T0"
    T1 = "T1"
    T2 = "T2"
    T3 = "T3"
    T4 = "T4"


class ActionType(StrEnum):
    READ = "read"
    DRAFT_MESSAGE = "draft_message"
    PAYMENT = "payment"
    VERIFY_PAYEE = "verify_payee"
    EXPORT_DATA = "export_data"


# Where the instruction/target of an action came from.
TRUSTED_SOURCES = frozenset({"user_instruction", "confirmed_obligation"})
UNTRUSTED_SOURCES = frozenset({"document_text", "message_text", "model_suggestion"})

T2_CAP = Decimal("2000")
COOLING_OFF = timedelta(hours=24)


@dataclass(frozen=True)
class PayeeState:
    payee_id: str
    owner_id: str
    verified: bool
    cooling_off_until: datetime | None = None  # set when verified-but-new / changed
    changed: bool = False


@dataclass(frozen=True)
class Action:
    type: ActionType
    owner_id: str
    amount_cny: Decimal | None = None
    payee: PayeeState | None = None
    source: str = "user_instruction"
    bulk: bool = False  # export_data: bulk PII export
    document_amount_cny: Decimal | None = None  # confirmed obligation amount, if any


@dataclass(frozen=True)
class Context:
    now: datetime
    guardian_blocked: bool = False
    recent_same_payee_cny: Decimal = Decimal("0")  # executed + pending in last 24h (split detection)
    approvals: frozenset[str] = frozenset()  # satisfied: "totp", "family_approver"
    t2_cap: Decimal = T2_CAP
    cooling_off: timedelta = COOLING_OFF


@dataclass(frozen=True)
class Decision:
    outcome: Outcome
    tier: Tier
    reasons: list[str] = field(default_factory=list)
    required: list[str] = field(default_factory=list)  # still-required items
    cooling_off_until: datetime | None = None
    explanation: str = ""

    @property
    def allowed(self) -> bool:
        return self.outcome is Outcome.ALLOW


def _block(reasons: list[str], why: str) -> Decision:
    return Decision(Outcome.BLOCK, Tier.T4, reasons, [], None, why)


def decide(action: Action, ctx: Context) -> Decision:
    if action.type is ActionType.READ:
        return Decision(Outcome.ALLOW, Tier.T0, ["READ_ONLY"], [], None, "Read-only: allowed.")
    if action.type is ActionType.DRAFT_MESSAGE:
        return Decision(Outcome.ALLOW, Tier.T1, ["DRAFT_ONLY"], [], None, "Draft only: nothing is sent.")
    if action.type is ActionType.EXPORT_DATA:
        if action.bulk:
            return _block(["BULK_PII_EXPORT"], "Bulk personal-data export is never allowed.")
        return Decision(Outcome.ALLOW, Tier.T0, ["OWN_DATA_EXPORT"], [], None, "Own-data export.")
    if action.type in (ActionType.PAYMENT, ActionType.VERIFY_PAYEE):
        return _decide_money(action, ctx)
    return _block(["UNKNOWN_ACTION_TYPE"], "Unknown action type: blocked (default deny).")


def _decide_money(action: Action, ctx: Context) -> Decision:
    if ctx.guardian_blocked:
        return _block(["INJECTION_DETECTED"], "Guardian flagged the source content: blocked.")
    if action.source not in TRUSTED_SOURCES:
        return _block(["DOC_ONLY_SOURCE"], "Action sourced only from document/message/model text: blocked.")
    payee = action.payee
    if payee is None:
        return _block(["PAYEE_UNREGISTERED"], "Payee is not in the registry: blocked.")
    if payee.owner_id != action.owner_id:
        return _block(["CROSS_USER_PAYEE"], "Payee belongs to another user: blocked.")

    if action.type is ActionType.VERIFY_PAYEE:
        return _decide_verify_payee(payee, ctx)

    amount = action.amount_cny
    if amount is None or amount <= 0:
        return _block(["INVALID_AMOUNT"], "Amount must be positive: blocked.")
    if action.document_amount_cny is not None and action.document_amount_cny != amount:
        return _block(["AMOUNT_MISMATCH"], "Amount differs from the confirmed obligation: blocked.")
    if not payee.verified:
        return _block(["PAYEE_UNVERIFIED"], "Payee is unverified: blocked until a family approver verifies it.")

    reasons: list[str] = ["PAYEE_VERIFIED"]
    required: list[str] = ["totp"]
    cooling_until: datetime | None = None
    tier = Tier.T2

    aggregate = amount + ctx.recent_same_payee_cny
    if amount > ctx.t2_cap:
        tier = Tier.T3
        reasons.append("OVER_T2_CAP")
    elif aggregate > ctx.t2_cap:
        tier = Tier.T3
        reasons.append("SPLIT_PAYMENT_SUSPECTED")
    else:
        reasons.append("WITHIN_T2_CAP")

    if payee.cooling_off_until is not None and ctx.now < payee.cooling_off_until:
        tier = Tier.T3
        cooling_until = payee.cooling_off_until
        reasons.append("PAYEE_CHANGED" if payee.changed else "NEW_PAYEE")

    if tier is Tier.T3:
        required.append("family_approver")
    if cooling_until is not None:
        required.append("cooling_off")

    outstanding = [r for r in required if r not in ctx.approvals and r != "cooling_off"]
    if cooling_until is not None:
        outstanding.append("cooling_off")  # clears only when time passes (handled above)
    if not outstanding:
        return Decision(Outcome.ALLOW, tier, reasons, [], cooling_until, f"{tier} satisfied: allowed.")
    if cooling_until is not None:
        return Decision(
            Outcome.REQUIRE_COOLING_OFF, Tier.T3, reasons, outstanding, cooling_until,
            "New or changed payee: 24h cooling-off, TOTP and family approver required.",
        )  # fmt: skip
    if tier is Tier.T3:
        return Decision(Outcome.REQUIRE_APPROVAL, tier, reasons, outstanding, None,
                        "TOTP and family approver required.")  # fmt: skip
    return Decision(Outcome.REQUIRE_APPROVAL, tier, reasons, outstanding, None,
                    "At or below the T2 cap to a verified payee: TOTP required.")  # fmt: skip


def _decide_verify_payee(payee: PayeeState, ctx: Context) -> Decision:
    """Verifying a payee is itself T3: TOTP + family approver (cooling-off applies to the payee)."""
    required = ["totp", "family_approver"]
    outstanding = [r for r in required if r not in ctx.approvals]
    reasons = ["PAYEE_CHANGED" if payee.changed else "NEW_PAYEE", "VERIFY_PAYEE"]
    until = payee.cooling_off_until
    if until is not None and ctx.now < until:
        outstanding.append("cooling_off")
        return Decision(Outcome.REQUIRE_COOLING_OFF, Tier.T3, reasons, outstanding, until,
                        "Payee change: 24h cooling-off, TOTP and family approver required.")  # fmt: skip
    if outstanding:
        return Decision(Outcome.REQUIRE_APPROVAL, Tier.T3, reasons, outstanding, None,
                        "TOTP and family approver required to verify a payee.")  # fmt: skip
    return Decision(Outcome.ALLOW, Tier.T3, reasons, [], None, "T3 satisfied: payee verification allowed.")
