"""Demo helpers. Only registered when DEMO_MODE=true. SYNTHETIC data only."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import security
from app.config import data_dir, get_settings
from app.db import get_session
from app.deps import api_error
from app.models import AuditRow, User

router = APIRouter(prefix="/demo", tags=["demo"])


def _guard() -> None:
    if not get_settings().demo_mode:
        raise api_error(404, "NOT_FOUND", "Not found")


@router.get("/personas")
def personas(_: None = Depends(_guard)) -> list[dict[str, Any]]:
    try:
        raw = json.loads((data_dir() / "personas.json").read_text(encoding="utf-8"))
    except OSError:
        return []
    users = raw["users"] if isinstance(raw, dict) else raw
    return [{"email": u["email"], "password": u["password"], "role": u["role"], "name": u.get("display_name"),
             "locale": u.get("locale", "en"), "synthetic": True} for u in users]  # fmt: skip


@router.get("/notices")
def notices(_: None = Depends(_guard)) -> list[dict[str, Any]]:
    d = data_dir() / "fee_notices"
    out = []
    try:
        manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    except OSError:
        return []
    items = manifest["notices"] if isinstance(manifest, dict) else manifest
    for m in items:
        p = d / m["file"]
        if p.exists():
            out.append({"id": m["file"], "label": f"{m['file']} ({m['label']}, SYNTHETIC)", "language": m["language"],
                        "category": m["category"], "expected_label": m["label"], "text": p.read_text(encoding="utf-8")})  # fmt: skip
    return out


@router.get("/totp/{email}")
def totp_peek(email: str, _: None = Depends(_guard), db: Session = Depends(get_session)) -> dict[str, str]:
    """DEMO ONLY: current TOTP code for a seeded persona (so judges need no authenticator app)."""
    u = db.execute(select(User).where(User.email == email.lower())).scalar_one_or_none()
    if u is None or not u.totp_secret_enc:
        raise api_error(404, "NOT_FOUND", "No TOTP for that user")
    return {"email": email, "code": security.totp_now(security.decrypt_secret(u.totp_secret_enc, u.id)),
            "valid_for_seconds": str(30 - int(__import__("time").time()) % 30)}  # fmt: skip


@router.post("/tamper-audit")
def tamper_audit(seq: int = 2, _: None = Depends(_guard), db: Session = Depends(get_session)) -> dict[str, Any]:
    """DEMO ONLY: edits a stored row (simulating a DB-level attacker) so verify reports broken_at_seq."""
    row = db.get(AuditRow, seq)
    if row is None:
        raise api_error(404, "NOT_FOUND", "No such audit row")
    row.event = row.event + ".TAMPERED"
    return {
        "tampered_seq": seq,
        "note": "row edited out-of-band; GET /audit?verify=true will report broken_at_seq",
    }


@router.post("/reset")
def reset(_: None = Depends(_guard)) -> dict[str, Any]:
    """DEMO ONLY: wipe and re-seed the demo database."""
    from app import db as dbm
    from app.models import Base
    from app.seed import seed_all

    Base.metadata.drop_all(dbm.get_engine())
    Base.metadata.create_all(dbm.get_engine())
    with dbm.session_factory()() as s:
        report = seed_all(s)
        s.commit()
    return {"reset": True, **report}
