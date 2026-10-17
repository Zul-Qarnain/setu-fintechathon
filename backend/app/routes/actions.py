from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import actions_service as svc
from app import schemas as s
from app.db import get_session
from app.deps import current_user, rate_limit
from app.models import User

router = APIRouter(prefix="/actions", tags=["actions"], dependencies=[Depends(rate_limit)])


@router.get("", response_model=list[s.ActionOut])
def list_actions(status: str | None = None, user: User = Depends(current_user),
                 db: Session = Depends(get_session)) -> list[s.ActionOut]:  # fmt: skip
    return [svc.action_out(db, r) for r in svc.visible_actions(db, user, status)]


@router.get("/{action_id}", response_model=s.ActionOut)
def get_action(action_id: str, user: User = Depends(current_user), db: Session = Depends(get_session)) -> s.ActionOut:
    return svc.action_out(db, svc.get_visible(db, user, action_id))


@router.post("/{action_id}/approve", response_model=s.ActionOut)
def approve(action_id: str, body: s.ApproveRequest, user: User = Depends(current_user),
            db: Session = Depends(get_session)) -> s.ActionOut:  # fmt: skip
    return svc.action_out(db, svc.approve(db, user, action_id, body.totp_code))


@router.post("/{action_id}/reject", response_model=s.ActionOut)
def reject(action_id: str, body: s.RejectRequest, user: User = Depends(current_user),
           db: Session = Depends(get_session)) -> s.ActionOut:  # fmt: skip
    return svc.action_out(db, svc.reject(db, user, action_id, body.reason))
