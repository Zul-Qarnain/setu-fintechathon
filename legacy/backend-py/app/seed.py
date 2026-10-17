"""Seed SYNTHETIC personas from data/personas.json (3 students + family approvers + admin)."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import security, services
from app.config import data_dir
from app.db import append_audit
from app.domain.tokenize import normalize_account
from app.models import Obligation, Payee, User
from app.sandbox_bank import ledger


def load_personas() -> list[dict[str, Any]]:
    raw = json.loads((data_dir() / "personas.json").read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        for key in ("users", "personas", "people"):
            if key in raw:
                return list(raw[key])
        raise ValueError("personas.json: expected a list or a dict with 'users'")
    return list(raw)


def seed_all(db: Session) -> dict[str, Any]:
    people = load_personas()
    by_email: dict[str, User] = {}
    # approvers + admin first so students can link to them
    for p in sorted(people, key=lambda x: 0 if x["role"] != "student" else 1):
        u = User(email=p["email"].lower(), password_hash=security.hash_password(p["password"]), role=p["role"],
                 locale=p.get("locale", "en"), display_name=p.get("display_name"),
                 monthly_budget_cny=Decimal(p.get("monthly_budget_cny", "0")))  # fmt: skip
        if p.get("approver_email"):
            u.approver_id = by_email[p["approver_email"].lower()].id
        db.add(u)
        db.flush()
        if p.get("totp_secret"):
            u.totp_secret_enc = security.encrypt_secret(p["totp_secret"], u.id)
            u.totp_enabled = True
        by_email[u.email] = u
        append_audit(db, u.id, "user.seeded", {"role": u.role, "synthetic": True})
    n_obl = 0
    idx = 0
    for p in people:
        if p["role"] != "student":
            continue
        idx += 1
        u = by_email[p["email"].lower()]
        n = 0
        # student's own sandbox account (deterministic synthetic number)
        n_students = idx
        ledger.open_account(db, f"62220001{n_students:08d}", p.get("display_name", u.email),
                            Decimal(p.get("sandbox_balance_cny", "0")), owner_id=u.id)  # fmt: skip
        for vp in p.get("verified_payees", []):
            pay, _ = services.create_payee(db, u, vp["name"], vp["account_number"], vp.get("bank", "Sandbox Bank"),
                                           source="manual", verified=True, cooling_hours=0)  # fmt: skip
            ledger.open_account(db, normalize_account(vp["account_number"]), vp["name"], Decimal("0"))
            n += 1
        for ob in p.get("obligations", []):
            if ob.get("seed") is False:
                continue  # demo uploads this notice live
            pay_row = next((q for q in db.execute(select(Payee).where(Payee.owner_id == u.id)).scalars()
                            if q.name == ob["payee_name"]), None)  # fmt: skip
            db.add(Obligation(user_id=u.id, title=ob["title"], amount_cny=Decimal(ob["amount_cny"]),
                              due_date=date.fromisoformat(ob["due_date"]),
                              payee_id=pay_row.id if pay_row else None, reference=ob.get("reference"), status="open"))  # fmt: skip
            n_obl += 1
        append_audit(db, u.id, "persona.seeded", {"payees": n, "synthetic": True})
    db.flush()
    return {"users": len(by_email), "obligations": n_obl}


def seed_if_empty(db: Session) -> None:
    if db.execute(select(User).limit(1)).first() is None:
        try:
            seed_all(db)
        except (OSError, ValueError, KeyError):
            pass  # no seed data available: start empty
