import time
from decimal import Decimal

import jwt
import pytest
from sqlalchemy import select

from app import db as dbm
from app import security
from app.sandbox_bank import ledger

D = Decimal


@pytest.fixture()
def s():
    dbm.init_db("sqlite://")
    with dbm.session_factory()() as sess:
        ledger.open_account(sess, "6222000000000001", "Student", D("30000"))
        ledger.open_account(sess, "6222000000004821", "Univ")
        yield sess


def tr(s, key, to="6222000000004821", amt="100.00", ref="r"):
    return ledger.transfer(s, key, "6222000000000001", to, D(amt), ref)


def test_settle_moves_money(s):
    r = tr(s, "k1")
    assert r.state == "settled" and ledger.get_account(s, "6222000000000001").balance_cny == D("29900.00")
    assert ledger.get_account(s, "6222000000004821").balance_cny == D("100.00")


@pytest.mark.parametrize(
    ("to", "amt", "state", "code"),
    [
        ("6222000000000013", "10", "failed", "ACCOUNT_CLOSED"),
        ("6222000000004821", "50000.01", "failed", "LIMIT_EXCEEDED"),
        ("6222000000004821", "10.99", "held", "RISK_HOLD"),
        ("6222000000004821", "30000.01", "failed", "INSUFFICIENT_FUNDS"),
        ("6222000000004821", "0", "failed", "INVALID_AMOUNT"),
    ],
)
def test_deterministic_failures_do_not_move_money(s, to, amt, state, code):
    r = tr(s, "kx", to, amt)
    assert (r.state, r.failure_code) == (state, code)
    assert ledger.get_account(s, "6222000000000001").balance_cny == D("30000")


def test_insufficient_funds(s):
    assert tr(s, "k", amt="30000.50").failure_code == "INSUFFICIENT_FUNDS"


def test_idempotent_replay_no_double_spend(s):
    a, b = tr(s, "k1"), tr(s, "k1")
    assert a.txn_id == b.txn_id and b.idempotent_replay and not a.idempotent_replay
    assert ledger.get_account(s, "6222000000000001").balance_cny == D("29900.00")
    assert len(list(s.execute(select(ledger.BankTxn)).scalars())) == 1


def test_idempotency_key_reuse_with_other_params_rejected(s):
    tr(s, "k1")
    with pytest.raises(ledger.IdempotencyMismatch):
        tr(s, "k1", amt="101.00")


def test_unknown_source_account(s):
    with pytest.raises(ledger.UnknownAccount):
        ledger.transfer(s, "k", "6222000000009999", "6222000000004821", D("1"))


def test_list_transactions(s):
    tr(s, "a")
    tr(s, "b")
    assert len(ledger.list_transactions(s, "6222 0000 0000 4821")) == 2


def test_password_hash_roundtrip():
    h = security.hash_password("demo-password-123")
    assert h.startswith("$argon2id$") and security.verify_password("demo-password-123", h)
    assert not security.verify_password("wrong", h) and not security.verify_password("x", "garbage")


def test_jwt_roundtrip_and_attacks():
    tok, _ = security.create_token("u1", "student")
    assert security.decode_token(tok)["sub"] == "u1"
    none_tok = jwt.encode({"sub": "u1", "exp": int(time.time()) + 99, "iat": 1}, key="", algorithm="none")
    with pytest.raises(jwt.PyJWTError):
        security.decode_token(none_tok)
    with pytest.raises(jwt.PyJWTError):
        security.decode_token(tok[:-3] + "AAA")
    expired, _ = security.create_token("u1", "student", ttl=-10)
    with pytest.raises(jwt.PyJWTError):
        security.decode_token(expired)
    other = jwt.encode(
        {"sub": "u1", "exp": int(time.time()) + 99, "iat": 1},
        "other-secret-other-secret-other-secret",
        algorithm="HS256",
    )
    with pytest.raises(jwt.PyJWTError):
        security.decode_token(other)
    no_exp = jwt.encode({"sub": "u1", "iat": 1}, security.get_settings().jwt_secret, algorithm="HS256")
    with pytest.raises(jwt.PyJWTError):
        security.decode_token(no_exp)


def test_totp_validation_window_and_replay():
    sec = security.new_totp_secret()
    now = 1_800_000_000.0
    import pyotp

    code = pyotp.TOTP(sec).at(now)
    step = security.check_totp(sec, code, 0, now)
    assert step == int(now // 30)
    assert security.check_totp(sec, code, step, now) is None  # replay
    assert security.check_totp(sec, pyotp.TOTP(sec).at(now - 30), 0, now) is not None  # -1 step
    assert security.check_totp(sec, pyotp.TOTP(sec).at(now - 120), 0, now) is None  # too old
    for bad in ("", "12345", "abcdef", "1234567", "000000"):
        assert security.check_totp(sec, bad, 0, now) is None or bad == "000000"


def test_totp_secret_encrypted_and_bound_to_user():
    sec = security.new_totp_secret()
    enc = security.encrypt_secret(sec, "u1")
    assert sec not in enc and security.decrypt_secret(enc, "u1") == sec
    with pytest.raises(Exception):  # noqa: B017
        security.decrypt_secret(enc, "u2")


def test_logging_redaction(capsys):
    import logging

    from app.logging_config import RedactingFilter, configure_logging, get_logger

    configure_logging()
    get_logger("t").info("evt", email="a@b.com", acct="6222 0000 0000 4821")
    logging.getLogger("x").warning("raw 6222000000004821 mail z@y.org")
    out = capsys.readouterr()
    text = out.out + out.err
    assert "a@b.com" not in text and "6222000000004821" not in text and "6222 0000 0000 4821" not in text
    rec = logging.LogRecord("n", 20, "p", 1, "acct 6222000000004821", None, None)
    RedactingFilter().filter(rec)
    assert "6222000000004821" not in rec.getMessage()
