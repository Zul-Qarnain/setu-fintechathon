from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app import stubs

router = APIRouter(prefix="/evidence", tags=["evidence"])


@router.get("/export")
def export() -> dict[str, Any]:
    return {"synthetic": True, "generated_at": stubs.NOW.isoformat(),
            "audit": [e.model_dump(mode="json") for e in stubs.audit_entries()],
            "verify": {"ok": True, "checked": 3, "broken_at_seq": None}}
