from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas as s
from app import services
from app.db import get_session
from app.deps import api_error, current_user, rate_limit, require_roles
from app.models import Payee, User

router = APIRouter(prefix="/payees", tags=["payees"], dependencies=[Depends(rate_limit)])


@router.get("", response_model=list[s.PayeeOut])
def list_payees(user: User = Depends(current_user), db: Session = Depends(get_session)) -> list[s.PayeeOut]:
    if user.role == "student":
        owners = [user.id]
    elif user.role == "family_approver":
        owners = [u.id for u in db.execute(select(User).where(User.approver_id == user.id)).scalars()]
    else:
        owners = [u.id for u in db.execute(select(User)).scalars()]
    rows = db.execute(select(Payee).where(Payee.owner_id.in_(owners or ["-"])).order_by(Payee.created_at)).scalars()
    return [services.payee_out(p) for p in rows]


@router.post("", response_model=s.PayeeOut, status_code=201)
def create_payee(body: s.PayeeCreate, user: User = Depends(require_roles("student")),
                 db: Session = Depends(get_session)) -> s.PayeeOut:  # fmt: skip
    p, _w = services.create_payee(db, user, body.name, body.account_number, body.bank, body.source)
    return services.payee_out(p)


@router.post("/{payee_id}/verify", response_model=s.PayeeOut)
def verify(payee_id: str, user: User = Depends(require_roles("family_approver", "admin")),
           db: Session = Depends(get_session)) -> s.PayeeOut:  # fmt: skip
    p = db.get(Payee, payee_id)
    owner = db.get(User, p.owner_id) if p else None
    if p is None or owner is None:
        raise api_error(404, "NOT_FOUND", "Payee not found")
    if user.role == "family_approver" and owner.approver_id != user.id:
        raise api_error(404, "NOT_FOUND", "Payee not found")  # IDOR-safe
    return services.payee_out(services.verify_payee(db, user, p))
