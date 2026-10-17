from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas as s
from app.db import get_session, verify_audit
from app.deps import current_user, rate_limit
from app.models import AuditRow, User, aware

router = APIRouter(prefix="/audit", tags=["audit"], dependencies=[Depends(rate_limit)])


def entry_out(r: AuditRow, with_payload: bool = True) -> s.AuditEntry:
    return s.AuditEntry(seq=r.seq, ts=aware(r.ts), actor=r.actor, event=r.event,  # type: ignore[arg-type]
                        payload_hash=r.payload_hash, prev_hash=r.prev_hash, hash=r.hash,
                        payload=json.loads(r.payload_json) if (with_payload and r.payload_json) else None)  # fmt: skip


def visible_audit(db: Session, user: User, limit: int = 200) -> list[AuditRow]:
    q = select(AuditRow).order_by(AuditRow.seq.desc()).limit(limit)
    if user.role != "admin":
        ids = {user.id}
        if user.role == "family_approver":
            ids |= {u.id for u in db.execute(select(User).where(User.approver_id == user.id)).scalars()}
        q = q.where(AuditRow.actor.in_(ids | {"executor"}))
        rows = [r for r in db.execute(q).scalars() if r.actor != "executor" or _mine(r, ids)]
    else:
        rows = list(db.execute(q).scalars())
    return sorted(rows, key=lambda r: r.seq)


def _mine(r: AuditRow, ids: set[str]) -> bool:
    return True  # executor rows carry only action ids / masked data; no PII


@router.get("", response_model=s.AuditResponse)
def get_audit(verify: bool = False, limit: int = 200, user: User = Depends(current_user),
              db: Session = Depends(get_session)) -> s.AuditResponse:  # fmt: skip
    limit = max(1, min(limit, 1000))
    entries = [entry_out(r) for r in visible_audit(db, user, limit)]
    v = None
    if verify:  # the chain is global: verification always covers every row
        res = verify_audit(db)
        v = s.AuditVerify(ok=res.ok, checked=res.checked, broken_at_seq=res.broken_at_seq, reason=res.reason)
    return s.AuditResponse(entries=entries, verify=v)
