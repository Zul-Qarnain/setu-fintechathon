from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.domain.policy import Action, ActionType, Context, Outcome, PayeeState, Tier, decide

NOW = datetime(2026, 10, 17, 12, tzinfo=UTC)
D = Decimal


def payee(verified=True, owner="u1", cool=None, changed=False):
    return PayeeState("p1", owner, verified, cool, changed)


def pay(amount, p=None, source="user_instruction", **kw):
    return Action(
        ActionType.PAYMENT,
        "u1",
        D(amount) if amount is not None else None,
        p if p is not None else payee(),
        source,
        **kw,
    )


def ctx(**kw):
    return Context(now=NOW, **kw)


def test_read_and_draft_always_allowed():
    assert decide(Action(ActionType.READ, "u1"), ctx()).tier is Tier.T0
    d = decide(Action(ActionType.DRAFT_MESSAGE, "u1"), ctx(guardian_blocked=True))
    assert d.outcome is Outcome.ALLOW and d.tier is Tier.T1


@pytest.mark.parametrize(
    ("amount", "tier", "reason"),
    [
        ("1", Tier.T2, "WITHIN_T2_CAP"),
        ("2000", Tier.T2, "WITHIN_T2_CAP"),
        ("2000.01", Tier.T3, "OVER_T2_CAP"),
        ("18500", Tier.T3, "OVER_T2_CAP"),
    ],
)
def test_tier_boundaries(amount, tier, reason):
    d = decide(pay(amount), ctx())
    assert d.tier is tier and reason in d.reasons and d.outcome is Outcome.REQUIRE_APPROVAL
    assert d.required == (["totp"] if tier is Tier.T2 else ["totp", "family_approver"])


def test_approvals_progressively_satisfy():
    d = decide(pay("18500"), ctx(approvals=frozenset({"totp"})))
    assert d.outcome is Outcome.REQUIRE_APPROVAL and d.required == ["family_approver"]
    assert decide(pay("18500"), ctx(approvals=frozenset({"totp", "family_approver"}))).allowed
    assert decide(pay("100"), ctx(approvals=frozenset({"totp"}))).allowed


def test_family_approver_alone_is_not_enough():
    assert not decide(pay("100"), ctx(approvals=frozenset({"family_approver"}))).allowed


@pytest.mark.parametrize("src", ["document_text", "message_text", "model_suggestion"])
def test_untrusted_sources_blocked(src):
    d = decide(pay("10", source=src), ctx(approvals=frozenset({"totp", "family_approver"})))
    assert d.outcome is Outcome.BLOCK and d.tier is Tier.T4


def test_unknown_source_is_untrusted():
    assert decide(pay("10", source="who_knows"), ctx()).outcome is Outcome.BLOCK


def test_guardian_block_overrides_everything():
    d = decide(pay("10"), ctx(guardian_blocked=True, approvals=frozenset({"totp", "family_approver"})))
    assert d.outcome is Outcome.BLOCK and "INJECTION_DETECTED" in d.reasons


def test_payee_problems_blocked():
    a = Action(ActionType.PAYMENT, "u1", D("10"), None)
    assert "PAYEE_UNREGISTERED" in decide(a, ctx()).reasons
    assert "PAYEE_UNVERIFIED" in decide(pay("10", payee(verified=False)), ctx()).reasons
    assert "CROSS_USER_PAYEE" in decide(pay("10", payee(owner="u2")), ctx()).reasons


@pytest.mark.parametrize("amt", [None, "0", "-5"])
def test_invalid_amounts_blocked(amt):
    assert "INVALID_AMOUNT" in decide(pay(amt), ctx()).reasons


def test_amount_mismatch_blocked():
    d = decide(pay("1000", document_amount_cny=D("100")), ctx())
    assert d.outcome is Outcome.BLOCK and "AMOUNT_MISMATCH" in d.reasons
    assert decide(pay("100", document_amount_cny=D("100")), ctx()).outcome is Outcome.REQUIRE_APPROVAL


def test_split_payments_aggregate():
    d = decide(pay("1500"), ctx(recent_same_payee_cny=D("1000")))
    assert d.tier is Tier.T3 and "SPLIT_PAYMENT_SUSPECTED" in d.reasons
    assert decide(pay("1500"), ctx(recent_same_payee_cny=D("500"))).tier is Tier.T2


def test_cooling_off_and_expiry():
    until = NOW + timedelta(hours=5)
    ap = frozenset({"totp", "family_approver"})
    d = decide(pay("100", payee(cool=until)), ctx(approvals=ap))
    assert (
        d.outcome is Outcome.REQUIRE_COOLING_OFF
        and d.tier is Tier.T3
        and "cooling_off" in d.required
        and d.cooling_off_until == until
    )
    later = Context(now=until + timedelta(seconds=1), approvals=ap)
    assert decide(pay("100", payee(cool=until)), later).allowed
    assert "PAYEE_CHANGED" in decide(pay("100", payee(cool=until, changed=True)), ctx()).reasons


def test_verify_payee_is_t3():
    a = Action(ActionType.VERIFY_PAYEE, "u1", None, payee(verified=False))
    d = decide(a, ctx())
    assert d.outcome is Outcome.REQUIRE_APPROVAL and d.tier is Tier.T3 and d.required == ["totp", "family_approver"]
    assert decide(a, ctx(approvals=frozenset({"totp", "family_approver"}))).allowed
    cool = Action(
        ActionType.VERIFY_PAYEE, "u1", None, payee(verified=False, cool=NOW + timedelta(hours=1), changed=True)
    )
    assert decide(cool, ctx()).outcome is Outcome.REQUIRE_COOLING_OFF
    assert decide(Action(ActionType.VERIFY_PAYEE, "u1", None, payee(owner="u2")), ctx()).outcome is Outcome.BLOCK


def test_export_data():
    assert decide(Action(ActionType.EXPORT_DATA, "u1", bulk=True), ctx()).outcome is Outcome.BLOCK
    assert decide(Action(ActionType.EXPORT_DATA, "u1"), ctx()).allowed


def test_unknown_action_type_default_deny():
    class Fake:
        type = "wire_everything"

    assert decide(Fake(), ctx()).outcome is Outcome.BLOCK  # type: ignore[arg-type]


@given(
    amount=st.decimals(min_value=D("0.01"), max_value=D("100000"), places=2),
    verified=st.booleans(),
    source=st.sampled_from(
        ["user_instruction", "confirmed_obligation", "document_text", "message_text", "model_suggestion"]
    ),
    approvals=st.sets(st.sampled_from(["totp", "family_approver"])),
    recent=st.decimals(min_value=D("0"), max_value=D("5000"), places=2),
    guardian=st.booleans(),
)
def test_allow_implies_all_invariants(amount, verified, source, approvals, recent, guardian):
    """Property: ALLOW only if trusted source, verified payee, guardian clear, totp present, and T3 => family approver."""
    d = decide(pay(str(amount), payee(verified=verified), source), Context(NOW, guardian, recent, frozenset(approvals)))
    if d.outcome is Outcome.ALLOW:
        assert (
            source in ("user_instruction", "confirmed_obligation") and verified and not guardian and "totp" in approvals
        )
        if d.tier is Tier.T3:
            assert "family_approver" in approvals
    if d.outcome is Outcome.BLOCK:
        assert d.tier is Tier.T4
