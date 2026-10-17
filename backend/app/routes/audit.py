from __future__ import annotations

from fastapi import APIRouter

from app import schemas as s
from app import stubs

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=s.AuditResponse)
def get_audit(verify: bool = False, limit: int = 200) -> s.AuditResponse:
    entries = stubs.audit_entries()
    v = s.AuditVerify(ok=True, checked=len(entries)) if verify else None
    return s.AuditResponse(entries=entries, verify=v)
