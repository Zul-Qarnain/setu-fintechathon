"""STUB data (skeleton phase). Realistic, SYNTHETIC. Replaced by real services step by step."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from app import schemas as s

NOW = datetime(2026, 10, 17, 5, 0, 0, tzinfo=UTC)

USER = s.UserOut(
    id="usr_demo_aisha",
    email="aisha@demo.setu.test",
    role="student",
    locale="en",
    totp_enabled=True,
    approver_id="usr_demo_father",
)
APPROVER = s.UserOut(
    id="usr_demo_father",
    email="father.rahman@demo.setu.test",
    role="family_approver",
    locale="en",
    totp_enabled=True,
    approver_id=None,
)


def guardian_clean() -> s.GuardianVerdict:
    return s.GuardianVerdict(verdict="clean", score=0.02, flags=[])


def guardian_blocked() -> s.GuardianVerdict:
    return s.GuardianVerdict(
        verdict="blocked",
        score=0.97,
        flags=[
            s.GuardianFlag(
                code="INJECTION_PHRASE",
                severity="block",
                message="Document contains an instruction aimed at the assistant.",
            ),
            s.GuardianFlag(
                code="PAYEE_NOT_IN_REGISTRY",
                severity="warn",
                message="Account in document does not match any verified payee.",
            ),
        ],
    )


def document(blocked: bool = False) -> s.DocumentOut:
    return s.DocumentOut(
        id="doc_01HZX3K9",
        filename="spring_tuition_notice.txt",
        doc_hash="sha256:9f2c4e1ab7d03c55e8a1b6f0d2c47a93b1e5f68d0a4c2b7e9d13f58a6c0e7b24",
        status="blocked" if blocked else "pending_confirmation",
        parsed=s.ParsedNotice(
            amount_cny=Decimal("18500.00"),
            due_date=date(2027, 3, 1),
            payee_name="Shenzhen Example University (SYNTHETIC)",
            account_masked="****4821",
            reference="2027-SPRING-TUITION-0042",
            language="en",
        ),
        guardian=guardian_blocked() if blocked else guardian_clean(),
        created_at=NOW,
    )


def obligation(status: str = "open") -> s.ObligationOut:
    return s.ObligationOut(
        id="obl_01HZX3KB",
        amount_cny=Decimal("18500.00"),
        due_date=date(2027, 3, 1),
        payee_id="pay_univ_01",
        payee_name="Shenzhen Example University (SYNTHETIC)",
        doc_hash=document().doc_hash,
        status=status,  # type: ignore[arg-type]
    )


def payee(verified: bool = True, pid: str = "pay_univ_01") -> s.PayeeOut:
    return s.PayeeOut(
        id=pid,
        owner_id=USER.id,
        name="Shenzhen Example University (SYNTHETIC)",
        account_masked="****4821",
        account_token="ACCT_7f3a91c2e0",
        bank="Sandbox Bank of China",
        verified=verified,
        verified_at=NOW - timedelta(days=30) if verified else None,
        cooling_off_until=None if verified else NOW + timedelta(hours=24),
        created_at=NOW - timedelta(days=31),
    )


def fx_quote(amount: Decimal = Decimal("1000")) -> s.FxQuote:
    rate = Decimal("17.2000")
    return s.FxQuote(
        pair="CNY/BDT",
        base="CNY",
        quote="BDT",
        rate=rate,
        amount_cny=amount,
        amount_converted=(amount * rate).quantize(Decimal("0.01")),
        source="fixture-sample",
        is_live=False,
        as_of=NOW,
        cached=False,
        disclaimer="SAMPLE rate from offline fixture. Not a live market rate.",
    )


def plan() -> s.PlanOut:
    amt = Decimal("18500.00")
    fee = Decimal("96.50")
    rate = Decimal("17.2000")
    return s.PlanOut(
        channel="Sandbox licensed-partner transfer",
        amount_cny=amt,
        fx_rate=rate,
        fx_source="fixture-sample",
        fees=[
            s.FeeLine(label="Partner transfer fee", amount_cny=Decimal("60.00")),
            s.FeeLine(label="FX margin (est.)", amount_cny=Decimal("36.50")),
        ],
        total_fees_cny=fee,
        fee_pct=Decimal("0.52"),
        bdt_needed=((amt + fee) * rate).quantize(Decimal("0.01")),
        due_date=date(2027, 3, 1),
        notes=["Rates are SAMPLE fixtures, not live.", "Setu never holds funds."],
    )


def decision(kind: str = "T3") -> s.DecisionOut:
    if kind == "T4":
        return s.DecisionOut(
            outcome="BLOCK",
            tier="T4",
            reasons=["DOC_ONLY_SOURCE", "PAYEE_UNVERIFIED"],
            required=[],
            explanation="Action sourced only from document text to an unverified payee: blocked.",
        )
    if kind == "T2":
        return s.DecisionOut(
            outcome="ALLOW",
            tier="T2",
            reasons=["WITHIN_T2_CAP", "PAYEE_VERIFIED"],
            required=["totp"],
            explanation="At or below CNY 2,000 to a verified payee; TOTP required.",
        )
    if kind == "COOL":
        return s.DecisionOut(
            outcome="REQUIRE_COOLING_OFF",
            tier="T3",
            reasons=["NEW_PAYEE"],
            required=["totp", "family_approver", "cooling_off"],
            cooling_off_until=NOW + timedelta(hours=24),
            explanation="New or changed payee: 24h cooling-off, TOTP and family approver required.",
        )
    return s.DecisionOut(
        outcome="REQUIRE_APPROVAL",
        tier="T3",
        reasons=["OVER_T2_CAP", "PAYEE_VERIFIED"],
        required=["totp", "family_approver"],
        explanation="Above CNY 2,000: TOTP and family approver required.",
    )


def action(kind: str = "T3", status: str = "awaiting_approval") -> s.ActionOut:
    return s.ActionOut(
        id="act_01HZX3KD",
        plan_id="plan_01HZX3KC",
        type="payment",
        tier=decision(kind).tier,
        status=status,  # type: ignore[arg-type]
        params={
            "amount_cny": "18500.00",
            "payee_id": "pay_univ_01",
            "payee_name": "Shenzhen Example University (SYNTHETIC)",
            "reference": "2027-SPRING-TUITION-0042",
            "idempotency_key": "idem_9c1e",
        },
        decision=decision(kind),
        created_at=NOW,
    )


def trace(tier: str = "T3", blocked: bool = False) -> s.Trace:
    steps = [
        s.TraceStep(
            step="intake",
            status="ok",
            duration_ms=3,
            detail={
                "intent": "pay_obligation",
                "document_id": "doc_01HZX3K9",
                "untrusted_wrapped": True,
            },
        ),
        s.TraceStep(
            step="planner",
            status="ok",
            duration_ms=5,
            detail={"tool_calls": ["get_obligation", "fx_quote", "compute_costs", "propose_payment"]},
        ),
        s.TraceStep(step="tools", status="ok", duration_ms=9, detail={"count": 4}),
        s.TraceStep(
            step="guardian",
            status="blocked" if blocked else "ok",
            duration_ms=2,
            detail={"verdict": "blocked" if blocked else "clean"},
        ),
        s.TraceStep(
            step="policy",
            status="blocked" if blocked else "ok",
            duration_ms=1,
            detail={"tier": tier},
        ),
        s.TraceStep(
            step="executor",
            status="skipped",
            duration_ms=0,
            detail={"reason": "blocked" if blocked else "awaiting approval"},
        ),
        s.TraceStep(step="validator", status="ok", duration_ms=1, detail={"unsupported_numbers": []}),
    ]
    return s.Trace(
        trace_id="trc_01HZX3KE",
        llm_mode="scripted-offline",
        steps=steps,
        tool_calls=[
            s.ToolCallTrace(
                tool="get_obligation",
                args={"obligation_id": "obl_01HZX3KB"},
                output={"amount_cny": "18500.00", "due_date": "2027-03-01"},
            ),
            s.ToolCallTrace(
                tool="fx_quote",
                args={"base": "CNY", "quote": "BDT"},
                output={"rate": "17.2000", "source": "fixture-sample"},
            ),
            s.ToolCallTrace(
                tool="compute_costs",
                args={"amount_cny": "18500.00"},
                output={"total_fees_cny": "96.50", "bdt_needed": "319,742.00"},
            ),
        ],
        tier=tier,
        decision=decision(tier if tier != "T4" else "T4").outcome,  # type: ignore[arg-type]
        reply_validated=True,
        audit_seqs=[41, 42, 43],
    )


def audit_entries() -> list[s.AuditEntry]:
    out = []
    prev = "0" * 64
    for i, ev in enumerate(["user.registered", "document.uploaded", "guardian.blocked"], start=1):
        h = f"{i:x}".rjust(64, "a")
        out.append(
            s.AuditEntry(
                seq=i,
                ts=NOW + timedelta(seconds=i),
                actor=USER.id,
                event=ev,
                payload_hash=h,
                prev_hash=prev,
                hash=f"{i:x}".rjust(64, "b"),
                payload={"note": "stub"},
            )
        )
        prev = out[-1].hash
    return out
