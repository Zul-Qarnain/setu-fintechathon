from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal

import pyotp
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("RATE_LIMIT_PER_MINUTE", "100000")
os.environ.setdefault("FIXED_TODAY", "2026-10-17")

from app import db as dbm  # noqa: E402
from app import security, services  # noqa: E402
from app.deps import limiter  # noqa: E402
from app.domain import fx as fxmod  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Obligation, User  # noqa: E402
from app.sandbox_bank import ledger  # noqa: E402

PW = "demo-password-123"
UNIV_ACCT = "6222000000004821"
UNIV_NAME = "Shenzhen Example University (SYNTHETIC)"


@dataclass
class Persona:
    id: str
    email: str
    secret: str
    token: str

    @property
    def h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def code(self) -> str:
        return pyotp.TOTP(self.secret).now()


@dataclass
class World:
    client: TestClient
    student: Persona
    approver: Persona
    other: Persona
    admin: Persona
    payee_id: str
    obligation_big: str
    obligation_small: str


def _mk(db, email: str, role: str, approver_id: str | None = None, secret: str | None = None) -> tuple[User, str]:
    u = User(email=email, password_hash=security.hash_password(PW), role=role, approver_id=approver_id,
             monthly_budget_cny=Decimal("3500"))  # fmt: skip
    db.add(u)
    db.flush()
    secret = secret or pyotp.random_base32()
    u.totp_secret_enc = security.encrypt_secret(secret, u.id)
    u.totp_enabled = True
    return u, secret


def _persona(u: User, secret: str) -> Persona:
    tok, _ = security.create_token(u.id, u.role)
    return Persona(u.id, u.email, secret, tok)


@pytest.fixture()
def world() -> Iterator[World]:
    dbm.init_db("sqlite://")
    limiter.reset()
    fxmod._service = fxmod.FxService(mode="fixture")
    app = create_app()
    with dbm.session_factory()() as db:
        ap, ap_s = _mk(db, "father@demo.setu.test", "family_approver")
        st, st_s = _mk(db, "aisha@demo.setu.test", "student", ap.id)
        ot, ot_s = _mk(db, "rafi@demo.setu.test", "student")
        ad, ad_s = _mk(db, "admin@demo.setu.test", "admin")
        ledger.open_account(db, "6222000100000001", "Aisha", Decimal("200000"), owner_id=st.id)
        ledger.open_account(db, "6222000100000002", "Rafi", Decimal("50000"), owner_id=ot.id)
        ledger.open_account(db, UNIV_ACCT, UNIV_NAME, Decimal("0"))
        pay, _ = services.create_payee(db, st, UNIV_NAME, UNIV_ACCT, "Sandbox Bank of China", verified=True, cooling_hours=0)
        big = Obligation(user_id=st.id, title="Spring 2027 tuition", amount_cny=Decimal("18500.00"),
                         due_date=__import__("datetime").date(2027, 3, 1), payee_id=pay.id, reference="2027-SPRING-TUITION-0042")  # fmt: skip
        small = Obligation(user_id=st.id, title="Dorm fee", amount_cny=Decimal("1350.00"),
                           due_date=__import__("datetime").date(2026, 11, 15), payee_id=pay.id, reference="DORM-2026-11")  # fmt: skip
        db.add_all([big, small])
        db.flush()
        w = World(TestClient(app), _persona(st, st_s), _persona(ap, ap_s), _persona(ot, ot_s), _persona(ad, ad_s),
                  pay.id, big.id, small.id)  # fmt: skip
        db.commit()
    yield w
