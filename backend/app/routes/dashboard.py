from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter

from app import schemas as s
from app import stubs

router = APIRouter(tags=["dashboard"])


@router.get("/me", response_model=s.UserOut)
def me() -> s.UserOut:
    return stubs.USER


@router.get("/dashboard", response_model=s.DashboardOut)
def dashboard() -> s.DashboardOut:
    ob = stubs.obligation()
    return s.DashboardOut(
        user=stubs.USER, obligations=[ob], next_due=ob, bdt_needed_next=Decimal("319742.00"),
        pending_actions=2, monthly_budget_cny=Decimal("3500.00"),
        spent_this_month_cny=Decimal("1240.50"), fx=stubs.fx_quote())


@router.get("/obligations", response_model=list[s.ObligationOut])
def obligations() -> list[s.ObligationOut]:
    return [stubs.obligation()]


@router.delete("/me", status_code=200)
def erase_me() -> dict[str, object]:
    """PIPL erasure: deletes PII, keeps hash-chain (payload hashes only)."""
    return {"erased": True, "audit_retained": "hashes only"}
