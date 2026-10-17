from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import doc_service
from app import schemas as s
from app.agents import intake
from app.db import get_session
from app.deps import api_error, current_user, rate_limit
from app.models import User

router = APIRouter(prefix="/documents", tags=["documents"], dependencies=[Depends(rate_limit)])


@router.post("", response_model=s.DocumentOut, status_code=201)
async def upload(
    request: Request, user: User = Depends(current_user), db: Session = Depends(get_session)
) -> s.DocumentOut:
    """JSON {filename,text,synthetic} or multipart `file` (.txt / text-layer .pdf)."""
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        f = form.get("file")
        if f is None or not hasattr(f, "read"):
            raise api_error(422, "validation_error", "multipart field 'file' required")
        data = await f.read()  # type: ignore[union-attr]
        if len(data) > 2_000_000:
            raise api_error(413, "TOO_LARGE", "File too large")
        try:
            text = intake.extract_text(getattr(f, "filename", None) or "upload.txt", data)
        except ValueError as e:
            raise api_error(422, "UNSUPPORTED_DOCUMENT", str(e)) from None
        filename, synthetic = getattr(f, "filename", None) or "upload.txt", True
    else:
        try:
            body = s.DocumentCreate(**json.loads(await request.body() or b"{}"))
        except Exception as e:
            raise api_error(422, "validation_error", f"Invalid JSON body: {e}") from None
        text, filename, synthetic = body.text, body.filename, body.synthetic
    return doc_service.doc_out(doc_service.ingest(db, user, filename, text, synthetic))


@router.post("/{doc_id}/confirm", response_model=s.DocumentConfirmResponse)
def confirm(
    doc_id: str,
    body: s.DocumentConfirm,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> s.DocumentConfirmResponse:
    return doc_service.confirm(db, user, doc_id, body)
