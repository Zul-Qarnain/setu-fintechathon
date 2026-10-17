"""`make demo`: scripted end-to-end run on a fresh in-memory DB seeded with SYNTHETIC personas.

Writes evidence/sandbox_logs.jsonl and evidence/audit_export.json (+ demo_summary.json). Offline, no keys.
Run: `python -m app.demo`.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("RATE_LIMIT_PER_MINUTE", "100000")

import pyotp  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app import db as dbm  # noqa: E402
from app.config import data_dir  # noqa: E402
from app.domain import fx as fxmod  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import BankAccount, BankTxn  # noqa: E402
from app.sandbox_bank import ledger  # noqa: E402
from app.seed import load_personas, seed_all  # noqa: E402

EVIDENCE = Path(__file__).resolve().parents[2] / "evidence"
steps: list[dict[str, Any]] = []


def say(step: str, **kw: Any) -> None:
    rec = {"step": step, **kw}
    steps.append(rec)
    detail = " ".join(f"{k}={v}" for k, v in kw.items())
    print(f"[demo] {step}: {detail}")


class Actor:
    """Logs in, and produces TOTP codes that respect replay protection (strictly increasing steps)."""

    def __init__(self, client: TestClient, persona: dict[str, Any]) -> None:
        self.p = persona
        r = client.post("/auth/login", json={"email": persona["email"], "password": persona["password"]})
        r.raise_for_status()
        self.token = r.json()["access_token"]
        self.h = {"Authorization": f"Bearer {self.token}"}
        self.id = r.json()["user"]["id"]
        self.last_step = int(time.time() // 30) - 2

    def code(self) -> str:
        now_step = int(time.time() // 30)
        step = max(self.last_step + 1, now_step - 1)
        if step > now_step + 1:
            time.sleep(30)  # wait out the window rather than reuse a code
            return self.code()
        self.last_step = step
        return pyotp.TOTP(self.p["totp_secret"]).at(step * 30)


def main() -> int:
    from argon2 import PasswordHasher

    from app import security

    security._ph = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)  # demo speed only
    dbm.init_db("sqlite://")
    fxmod._service = fxmod.FxService(mode="fixture")
    app = create_app()
    client = TestClient(app)
    with dbm.session_factory()() as db:
        rep = seed_all(db)
        db.commit()
    say("seed", **rep, synthetic=True, fx="SAMPLE fixture (not live)")

    people = {p["email"]: p for p in load_personas()}
    students = [p for p in people.values() if p["role"] == "student"]
    aisha = Actor(client, students[0])
    father = Actor(client, people[students[0]["approver_email"]])
    admin = Actor(client, next(p for p in people.values() if p["role"] == "admin"))
    notices = data_dir() / "fee_notices"

    # 1. confirmed tuition notice -> T3 -> student TOTP + family approver -> sandbox settlement
    tuition = next(o for o in students[0]["obligations"] if o["amount_cny"] and float(o["amount_cny"]) > 2000)
    text = (notices / tuition["notice_file"]).read_text(encoding="utf-8")
    d = client.post("/documents", json={"filename": tuition["notice_file"], "text": text}, headers=aisha.h).json()
    say("upload_notice", file=tuition["notice_file"], status=d["status"], guardian=d["guardian"]["verdict"],
        amount=d["parsed"]["amount_cny"])  # fmt: skip
    conf = client.post(f"/documents/{d['id']}/confirm", json={
        "amount_cny": d["parsed"]["amount_cny"], "due_date": d["parsed"]["due_date"],
        "payee_name": d["parsed"]["payee_name"] or tuition["payee_name"]}, headers=aisha.h).json()  # fmt: skip
    say("confirm_fields", blocked=conf["blocked"], obligation=conf["obligation"]["id"] if conf["obligation"] else None,
        payee_verified=True if conf["obligation"] and conf["obligation"]["payee_id"] else None)  # fmt: skip
    chat = client.post(
        "/chat", json={"message": "Pay my spring tuition from this notice", "document_id": d["id"]}, headers=aisha.h
    ).json()
    act = chat["proposed_actions"][0]
    say("chat_pay", intent=chat["intent"], tier=act["tier"], status=act["status"], required=act["decision"]["required"], reply_validated=chat["trace"]["reply_validated"])  # fmt: skip
    r1 = client.post(f"/actions/{act['id']}/approve", json={"totp_code": aisha.code()}, headers=aisha.h).json()
    say("student_totp", status=r1["status"], still_required=r1["decision"]["required"])
    r2 = client.post(f"/actions/{act['id']}/approve", json={"totp_code": father.code()}, headers=father.h).json()
    say("family_approver_totp", status=r2["status"], bank_txn=(r2.get("result") or {}).get("bank_txn_id"), state=(r2.get("result") or {}).get("state"))  # fmt: skip

    # 2. demo moment 1: injected notice -> red T4
    inj = sorted(notices.glob("atk_injection_en*.txt"))[0]
    di = client.post(
        "/documents", json={"filename": inj.name, "text": inj.read_text(encoding="utf-8")}, headers=aisha.h
    ).json()
    ci = client.post(
        "/chat", json={"message": "Pay my spring tuition from this notice", "document_id": di["id"]}, headers=aisha.h
    ).json()
    say("injected_notice", file=inj.name, doc_status=di["status"], flags=[f["code"] for f in di["guardian"]["flags"]],
        tier=ci["proposed_actions"][0]["tier"], status=ci["proposed_actions"][0]["status"])  # fmt: skip

    # 3. demo moment 2: SMS "payee changed" -> cooling-off
    sms = next(
        m
        for m in json.loads((data_dir() / "messages" / "messages.json").read_text(encoding="utf-8"))
        if m["label"] == "payee_change"
    )
    cs = client.post("/chat", json={"message": sms["text"]}, headers=aisha.h).json()
    ver = next((a for a in cs["proposed_actions"] if a["type"] == "verify_payee"), None)
    rr = (
        client.post(f"/actions/{ver['id']}/approve", json={"totp_code": aisha.code()}, headers=aisha.h) if ver else None
    )
    say("sms_payee_change", intent=cs["intent"], tier=ver["tier"] if ver else None, status=ver["status"] if ver else None,
        approve_attempt=(rr.status_code, rr.json()["error"]["code"]) if rr is not None else None)  # fmt: skip

    # 4. T2 payment (small obligation) + split-payment escalation
    small = next((o for o in students[0]["obligations"] if float(o["amount_cny"]) <= 2000), None)
    if small:
        c2 = client.post("/chat", json={"message": f"Pay my {small['title']}"}, headers=aisha.h).json()
        a2 = c2["proposed_actions"][0] if c2["proposed_actions"] else None
        if a2:
            r = client.post(f"/actions/{a2['id']}/approve", json={"totp_code": aisha.code()}, headers=aisha.h).json()
            say("t2_payment", tier=a2["tier"], required=a2["decision"]["required"], status=r.get("status"), amount=a2["params"].get("amount_cny"))  # fmt: skip

    # 5. sandbox determinism showcase (clearly labelled) -> sandbox_logs
    with dbm.session_factory()() as db:
        acct = db.execute(select(BankAccount).where(BankAccount.owner_id == aisha.id)).scalars().first()
        src = acct.account_number if acct else ""
        showcase = [
            ("idem-demo-1", "6222000000000013", "100.00", "dest ends 0013 -> ACCOUNT_CLOSED"),
            ("idem-demo-2", "6222000000008888", "100.99", "cents .99 -> RISK_HOLD"),
            ("idem-demo-3", "6222000000008888", "9999999.00", "over per-txn limit -> LIMIT_EXCEEDED"),
            ("idem-demo-4", "6222000000008888", "50.00", "ok -> settled"),
            ("idem-demo-4", "6222000000008888", "50.00", "same idempotency key -> replay, no double spend"),
        ]
        ledger.open_account(db, "6222000000008888", "Sandbox demo recipient (SYNTHETIC)", Decimal0())
        for key, to, amt, why in showcase:
            res = ledger.transfer(db, key, src, to, __import__("decimal").Decimal(amt), f"showcase-{key}")
            say(
                "sandbox_showcase",
                key=key,
                why=why,
                state=res.state,
                failure=res.failure_code,
                replay=res.idempotent_replay,
            )
        try:
            ledger.transfer(
                db,
                "idem-demo-4",
                src,
                "6222000000008888",
                __import__("decimal").Decimal("75.00"),
                "showcase-idem-demo-4",
            )
        except ledger.IdempotencyMismatch as e:
            say(
                "sandbox_showcase",
                key="idem-demo-4",
                why="same key, different amount -> rejected",
                state="rejected",
                failure=str(e),
            )
        db.commit()

    # 6. audit verify, export, tamper
    v = client.get("/audit?verify=true", headers=aisha.h).json()["verify"]
    say("audit_verify", **v)
    export = client.get("/evidence/export", headers=admin.h).json()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "audit_export.json").write_text(json.dumps(export, indent=2, ensure_ascii=False), encoding="utf-8")
    seq = 3
    client.post(f"/demo/tamper-audit?seq={seq}")
    v2 = client.get("/audit?verify=true", headers=aisha.h).json()["verify"]
    say("audit_after_tamper", **v2)

    with dbm.session_factory()() as db:
        txns = list(db.execute(select(BankTxn).order_by(BankTxn.created_at)).scalars())
        lines = [
            {"ts": t.created_at.replace(tzinfo=UTC).isoformat(), "sandbox": True, "synthetic": True, "txn_id": t.id,
             "idempotency_key": t.idempotency_key, "from": "****" + t.from_account[-4:], "to": "****" + t.to_account_number[-4:],
             "amount_cny": str(t.amount_cny), "state": t.state, "failure_code": t.failure_code, "reference": t.reference}
            for t in txns
        ]  # fmt: skip
    (EVIDENCE / "sandbox_logs.jsonl").write_text(
        "\n".join(json.dumps(x, ensure_ascii=False) for x in lines) + "\n", encoding="utf-8"
    )
    (EVIDENCE / "demo_summary.json").write_text(
        json.dumps({"generated_at": datetime.now(UTC).isoformat(), "offline": True, "synthetic": True, "steps": steps}, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8")  # fmt: skip
    print(
        f"[demo] wrote {EVIDENCE}/sandbox_logs.jsonl ({len(lines)} txns), audit_export.json ({len(export['audit'])} rows), demo_summary.json"
    )
    return 0 if v["ok"] and not v2["ok"] else 1


def Decimal0() -> Any:
    from decimal import Decimal

    return Decimal("0")


if __name__ == "__main__":
    sys.exit(main())
