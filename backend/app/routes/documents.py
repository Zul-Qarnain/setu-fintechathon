from __future__ import annotations

from fastapi import APIRouter

from app import schemas as s
from app import stubs

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=s.DocumentOut, status_code=201)
def upload(body: s.DocumentCreate) -> s.DocumentOut:
    injected = "ignore previous" in body.text.lower() or "忽略" in body.text
    return stubs.document(blocked=injected)


@router.post("/{doc_id}/confirm", response_model=s.DocumentConfirmResponse)
def confirm(doc_id: str, body: s.DocumentConfirm) -> s.DocumentConfirmResponse:
    return s.DocumentConfirmResponse(
        document=stubs.document().model_copy(update={"status": "confirmed"}),
        obligation=stubs.obligation(), guardian=stubs.guardian_clean(), blocked=False, audit_seq=12)
