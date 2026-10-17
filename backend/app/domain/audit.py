"""SHA-256 hash-chained audit log: pure functions (DB glue lives in app/db.py)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

GENESIS_HASH = "0" * 64


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def payload_hash(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def ts_str(ts: datetime) -> str:
    """Stable UTC string used in the hash input (microsecond precision, naive-safe)."""
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def compute_hash(
    seq: int, ts: datetime, actor: str, event: str, p_hash: str, prev_hash: str
) -> str:
    material = "|".join([str(seq), ts_str(ts), actor, event, p_hash, prev_hash])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


class AuditRow(Protocol):
    seq: int
    ts: datetime
    actor: str
    event: str
    payload_hash: str
    prev_hash: str
    hash: str
    payload_json: str | None


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    checked: int
    broken_at_seq: int | None = None
    reason: str | None = None


def verify_chain(rows: list[AuditRow]) -> VerifyResult:
    """Recompute every link. Detects edited fields, edited payloads, deleted/reordered rows."""
    prev = GENESIS_HASH
    expected_seq = None
    checked = 0
    for row in sorted(rows, key=lambda r: r.seq):
        if expected_seq is not None and row.seq != expected_seq:
            return VerifyResult(False, checked, row.seq, f"sequence gap: expected {expected_seq}")
        expected_seq = row.seq + 1
        if row.prev_hash != prev:
            return VerifyResult(False, checked, row.seq, "prev_hash mismatch")
        if row.payload_json is not None:
            try:
                payload = json.loads(row.payload_json)
            except ValueError:
                return VerifyResult(False, checked, row.seq, "payload not valid JSON")
            if payload_hash(payload) != row.payload_hash:
                return VerifyResult(False, checked, row.seq, "payload hash mismatch")
        if compute_hash(row.seq, row.ts, row.actor, row.event, row.payload_hash, row.prev_hash) != row.hash:
            return VerifyResult(False, checked, row.seq, "hash mismatch")
        prev = row.hash
        checked += 1
    return VerifyResult(True, checked)
