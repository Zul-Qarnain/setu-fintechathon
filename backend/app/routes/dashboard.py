from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas as s
from app import services
from app.agents import tools
from app.db import append_audit, get_session
from app.deps import current_user, rate_limit
from app.domain.fx import get_fx_service
from app.models import Document, Obligation, Payee, User

router = APIRouter(tags=["dashboard"], dependencies=[Depends(rate_limit)])


@router.get("/me", response_model=s.UserOut)
def me(user: User = Depends(current_user)) -> s.UserOut:
    return services.user_out(user)


@router.get("/obligations", response_model=list[s.ObligationOut])
def obligations(user: User = Depends(current_user), db: Session = Depends(get_session)) -> list[s.ObligationOut]:
    rows = db.execute(select(Obligation).where(Obligation.user_id == user.id).order_by(Obligation.due_date)).scalars()
    return [services.obligation_out(db, o) for o in rows]


@router.get("/dashboard", response_model=s.DashboardOut)
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_session)) -> s.DashboardOut:
    obs = [services.obligation_out(db, o) for o in db.execute(
        select(Obligation).where(Obligation.user_id == user.id).order_by(Obligation.due_date)).scalars()]
    open_obs = [o for o in obs if o.status == "open"]
    nxt = open_obs[0] if open_obs else None
    fx = get_fx_service()
    bdt = None
    if nxt:
        from app.domain.costs import compute_costs

        bdt = compute_costs(nxt.amount_cny, fx).bdt_needed
    from datetime import UTC, datetime

    st = tools.ToolState(db=db, user=user, fx=fx, today=datetime.now(UTC).date())
    b = tools.budget_summary(st, {})
    return s.DashboardOut(
        user=services.user_out(user), obligations=obs, next_due=nxt, bdt_needed_next=bdt,
        pending_actions=services.count_pending_actions(db, user),
        monthly_budget_cny=Decimal(b["monthly_budget_cny"]), spent_this_month_cny=Decimal(b["spent_this_month_cny"]),
        fx=services.fx_quote_out(Decimal("1000")),
    )  # fmt: skip


@router.delete("/me")
def erase_me(user: User = Depends(current_user), db: Session = Depends(get_session)) -> dict[str, Any]:
    """PIPL erasure: delete personal data; the audit chain keeps only redacted payload hashes."""
    for model, col in ((Payee, Payee.owner_id), (Document, Document.owner_id)):
        for row in db.execute(select(model).where(col == user.id)).scalars():
            db.delete(row)
    for o in db.execute(select(Obligation).where(Obligation.user_id == user.id)).scalars():
        db.delete(o)
    user.email = f"erased+{user.id}@erased.invalid"
    user.password_hash = "!"
    user.totp_secret_enc = None
    user.totp_enabled = False
    user.display_name = None
    user.erased = True
    append_audit(db, user.id, "user.erased", {"pipl": "erasure", "audit_retained": "hashes only"})
    return {"erased": True, "audit_retained": "redacted payload hashes only"}
