from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_session, verify_audit
from app.deps import current_user, rate_limit
from app.models import User
from app.routes.audit import entry_out, visible_audit

router = APIRouter(prefix="/evidence", tags=["evidence"], dependencies=[Depends(rate_limit)])


def build_export(db: Session, user: User) -> dict[str, Any]:
    res = verify_audit(db)
    rows = visible_audit(db, user, 100000)
    return {
        "synthetic": True, "generated_at": datetime.now(UTC).isoformat(), "scope": "all" if user.role == "admin" else "own",
        "audit": [entry_out(r).model_dump(mode="json") for r in rows],
        "verify": {"ok": res.ok, "checked": res.checked, "broken_at_seq": res.broken_at_seq, "reason": res.reason},
        "head_hash": rows[-1].hash if rows else None,
    }  # fmt: skip


@router.get("/export")
def export(user: User = Depends(current_user), db: Session = Depends(get_session)) -> dict[str, Any]:
    return build_export(db, user)
