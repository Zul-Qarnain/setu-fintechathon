"""SQLAlchemy engine/session + audit-log append/verify glue."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.domain import audit as audit_dom
from app.domain.tokenize import redact_obj
from app.models import AuditRow, Base

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def make_engine(url: str) -> Engine:
    kwargs: dict[str, Any] = {"future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url or url in ("sqlite://", "sqlite:///"):
            kwargs["poolclass"] = StaticPool
    eng = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(eng, "connect")
        def _fk(dbapi_conn: Any, _rec: Any) -> None:
            dbapi_conn.execute("PRAGMA foreign_keys=ON")

    return eng


def init_db(url: str | None = None) -> Engine:
    """(Re)initialise the global engine and create tables. Tests pass sqlite:// (memory)."""
    global _engine, _SessionLocal
    _engine = make_engine(url or get_settings().database_url)
    Base.metadata.create_all(_engine)
    _SessionLocal = sessionmaker(_engine, expire_on_commit=False, future=True)
    return _engine


def get_engine() -> Engine:
    if _engine is None:
        init_db()
    assert _engine is not None
    return _engine


def session_factory() -> sessionmaker[Session]:
    if _SessionLocal is None:
        init_db()
    assert _SessionLocal is not None
    return _SessionLocal


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one transaction per request."""
    with session_factory()() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def append_audit(session: Session, actor: str, event_name: str, payload: dict[str, Any] | None = None) -> AuditRow:
    """Append a hash-chained audit row. Payload is PII-redacted before hashing/storing."""
    clean = redact_obj(payload or {})
    last = session.execute(select(AuditRow).order_by(AuditRow.seq.desc()).limit(1)).scalar_one_or_none()
    seq = (last.seq + 1) if last else 1
    prev = last.hash if last else audit_dom.GENESIS_HASH
    ts = datetime.now(UTC)
    ph = audit_dom.payload_hash(clean)
    row = AuditRow(
        seq=seq, ts=ts, actor=actor, event=event_name, payload_hash=ph, prev_hash=prev,
        hash=audit_dom.compute_hash(seq, ts, actor, event_name, ph, prev),
        payload_json=audit_dom.canonical_json(clean),
    )  # fmt: skip
    session.add(row)
    session.flush()
    return row


def verify_audit(session: Session) -> audit_dom.VerifyResult:
    rows = list(session.execute(select(AuditRow).order_by(AuditRow.seq)).scalars())
    return audit_dom.verify_chain(rows)  # type: ignore[arg-type]


def dumps(obj: Any) -> str:
    return json.dumps(obj, default=str, ensure_ascii=False)
