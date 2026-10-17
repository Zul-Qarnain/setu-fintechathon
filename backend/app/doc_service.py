"""Document upload/confirm flow. Documents are untrusted DATA; user confirmation required."""

from __future__ import annotations

import hashlib
import json

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas as s
from app import services
from app.agents import guardian, intake
from app.db import append_audit
from app.deps import api_error
from app.domain import crypto
from app.models import Document, Obligation, Payee, User, aware


def doc_out(d: Document) -> s.DocumentOut:
    parsed = json.loads(d.parsed_json)
    return s.DocumentOut(
        id=d.id, filename=d.filename, doc_hash=d.doc_hash, status=d.status,  # type: ignore[arg-type]
        parsed=s.ParsedNotice(**parsed), guardian=s.GuardianVerdict(**json.loads(d.guardian_json)),
        untrusted=True, synthetic=d.synthetic, created_at=aware(d.created_at),  # type: ignore[arg-type]
    )  # fmt: skip


def registry(db: Session, owner_id: str) -> list[tuple[str, str, bool]]:
    rows = db.execute(select(Payee).where(Payee.owner_id == owner_id)).scalars()
    return [(p.name, p.account_hash, p.verified_at is not None) for p in rows]


def ingest(db: Session, user: User, filename: str, text: str, synthetic: bool = True) -> Document:
    text = text[: intake.MAX_TEXT]
    parsed = intake.parse_notice(text)
    verdict = guardian.scan_text(text, parsed)
    verdict = guardian.merge(
        verdict, guardian.registry_flags(parsed.payee_name, parsed.account_number, registry(db, user.id))
    )
    doc_hash = "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()
    parsed_json = {
        "amount_cny": str(parsed.amount_cny) if parsed.amount_cny is not None else None,
        "due_date": parsed.due_date.isoformat() if parsed.due_date else None,
        "payee_name": parsed.payee_name,
        "account_masked": ("****" + parsed.account_number[-4:]) if parsed.account_number else None,
        "reference": parsed.reference,
        "language": parsed.language,
    }  # fmt: skip
    doc = Document(owner_id=user.id, filename=filename[:255], doc_hash=doc_hash,
                   text_enc="", parsed_json=json.dumps(parsed_json),
                   guardian_json=verdict.model_dump_json(),
                   status="blocked" if verdict.verdict == "blocked" else "pending_confirmation",
                   synthetic=synthetic)  # fmt: skip
    db.add(doc)
    db.flush()
    # keep account number (needed at confirm) encrypted with the text; never plaintext at rest
    payload = json.dumps({"text": text, "account_number": parsed.account_number})
    doc.text_enc = crypto.encrypt(payload, aad=f"doc:{doc.id}")
    append_audit(db, user.id, "document.uploaded", {"document_id": doc.id, "doc_hash": doc_hash,
                                                     "filename": doc.filename})  # fmt: skip
    if doc.status == "blocked":
        append_audit(db, user.id, "guardian.blocked", {
            "document_id": doc.id, "doc_hash": doc_hash,
            "flags": [f.code for f in verdict.flags], "tier": "T4"})  # fmt: skip
    elif verdict.verdict == "suspicious":
        append_audit(db, user.id, "guardian.suspicious", {
            "document_id": doc.id, "flags": [f.code for f in verdict.flags]})  # fmt: skip
    return doc


def get_owned_document(db: Session, user: User, doc_id: str) -> Document:
    d = db.get(Document, doc_id)
    if d is None or d.owner_id != user.id:
        raise api_error(404, "NOT_FOUND", "Document not found")  # IDOR-safe: same error for both
    return d


def doc_plain(d: Document) -> dict[str, str | None]:
    out: dict[str, str | None] = json.loads(crypto.decrypt(d.text_enc, aad=f"doc:{d.id}"))
    return out


def confirm(db: Session, user: User, doc_id: str, body: s.DocumentConfirm) -> s.DocumentConfirmResponse:
    d = get_owned_document(db, user, doc_id)
    verdict = s.GuardianVerdict(**json.loads(d.guardian_json))
    if d.status == "blocked":
        append_audit(db, user.id, "document.confirm_blocked", {"document_id": d.id, "tier": "T4",
                                                               "flags": [f.code for f in verdict.flags]})  # fmt: skip
        seq = _last_seq(db)
        return s.DocumentConfirmResponse(document=doc_out(d), obligation=None, guardian=verdict,
                                         blocked=True, audit_seq=seq)  # fmt: skip
    if d.status == "confirmed":
        raise api_error(409, "ALREADY_CONFIRMED", "Document already confirmed")
    parsed = json.loads(d.parsed_json)
    plain = doc_plain(d)
    parsed_amount = Decimal(parsed["amount_cny"]) if parsed.get("amount_cny") else None
    if parsed_amount is not None and body.amount_cny != parsed_amount:
        append_audit(db, user.id, "document.amount_mismatch", {
            "document_id": d.id, "parsed": str(parsed_amount), "confirmed": str(body.amount_cny)})  # fmt: skip
        db.commit()
        raise api_error(409, "AMOUNT_MISMATCH", "Confirmed amount differs from the amount in the document",
                        {"parsed_amount_cny": str(parsed_amount)})  # fmt: skip
    if body.amount_cny <= 0:
        raise api_error(422, "validation_error", "Amount must be positive")
    acct = body.account_number or plain.get("account_number")
    payee: Payee | None = None
    if acct:
        existing = services.find_payee_by_account(db, user.id, acct)
        if existing is not None:
            payee = existing
        else:
            payee, _w = services.create_payee(db, user, body.payee_name, acct,
                                              bank="(from document, unverified)", source="document")  # fmt: skip
    ob = Obligation(user_id=user.id, title=parsed.get("reference") or body.payee_name,
                    amount_cny=body.amount_cny, due_date=body.due_date,
                    payee_id=payee.id if payee else None, doc_hash=d.doc_hash,
                    reference=body.reference or parsed.get("reference"), status="open")  # fmt: skip
    db.add(ob)
    d.status = "confirmed"
    db.flush()
    row = append_audit(db, user.id, "document.confirmed", {
        "document_id": d.id, "obligation_id": ob.id, "amount_cny": str(ob.amount_cny),
        "payee_id": ob.payee_id, "payee_verified": bool(payee and payee.verified_at)})  # fmt: skip
    return s.DocumentConfirmResponse(document=doc_out(d), obligation=services.obligation_out(db, ob),
                                     guardian=verdict, blocked=False, audit_seq=row.seq)  # fmt: skip


def _last_seq(db: Session) -> int | None:
    from app.models import AuditRow

    r = db.execute(select(AuditRow.seq).order_by(AuditRow.seq.desc()).limit(1)).scalar_one_or_none()
    return r


