from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.domain import audit


@dataclass
class Row:
    seq: int
    ts: datetime
    actor: str
    event: str
    payload_hash: str
    prev_hash: str
    hash: str
    payload_json: str | None


def chain(n=4):
    rows, prev = [], audit.GENESIS_HASH
    t0 = datetime(2026, 10, 17, tzinfo=UTC)
    for i in range(1, n + 1):
        p = {"i": i}
        ph = audit.payload_hash(p)
        ts = t0 + timedelta(seconds=i)
        h = audit.compute_hash(i, ts, "u", f"e{i}", ph, prev)
        rows.append(Row(i, ts, "u", f"e{i}", ph, prev, h, audit.canonical_json(p)))
        prev = h
    return rows


def test_canonical_json_is_order_independent():
    assert audit.canonical_json({"b": 1, "a": 2}) == audit.canonical_json({"a": 2, "b": 1})
    assert audit.payload_hash({"a": 1}) != audit.payload_hash({"a": 2})


def test_valid_chain_verifies():
    r = audit.verify_chain(chain())
    assert r.ok and r.checked == 4 and r.broken_at_seq is None


def test_empty_chain_ok():
    assert audit.verify_chain([]).ok


def test_edit_event_detected():
    rows = chain()
    rows[1].event = "forged"
    r = audit.verify_chain(rows)
    assert not r.ok and r.broken_at_seq == 2 and r.reason == "hash mismatch"


def test_edit_payload_detected():
    rows = chain()
    rows[2].payload_json = '{"i":99}'
    r = audit.verify_chain(rows)
    assert not r.ok and r.broken_at_seq == 3 and "payload" in (r.reason or "")


def test_delete_row_detected():
    rows = chain()
    del rows[1]
    r = audit.verify_chain(rows)
    assert not r.ok and r.broken_at_seq == 3 and "gap" in (r.reason or "")


def test_relink_detected():
    rows = chain()
    rows[3].prev_hash = "f" * 64
    assert audit.verify_chain(rows).broken_at_seq == 4


def test_swapped_order_detected():
    rows = chain()
    rows[1], rows[2] = rows[2], rows[1]
    rows[1].seq, rows[2].seq = 2, 3  # attacker renumbers
    assert not audit.verify_chain(rows).ok


def test_ts_naive_and_aware_hash_equal():
    t = datetime(2026, 1, 1, 12, 0, 0, 5)
    assert audit.ts_str(t) == audit.ts_str(t.replace(tzinfo=UTC))
