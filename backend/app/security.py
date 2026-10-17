"""Password hashing (argon2id), JWT (HS256, pinned alg), TOTP with replay + lockout."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import get_settings
from app.domain import crypto

_ph = PasswordHasher()
JWT_ALG = "HS256"


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except (VerificationError, InvalidHashError):
        return False


def create_token(user_id: str, role: str, ttl: int | None = None) -> tuple[str, int]:
    st = get_settings()
    ttl = ttl if ttl is not None else st.jwt_ttl_seconds
    now = datetime.now(UTC)
    claims = {"sub": user_id, "role": role, "iat": int(now.timestamp()),
              "exp": int((now + timedelta(seconds=ttl)).timestamp()), "jti": uuid.uuid4().hex}  # fmt: skip
    return jwt.encode(claims, st.jwt_secret, algorithm=JWT_ALG), ttl


def decode_token(token: str) -> dict[str, Any]:
    """Raises jwt.PyJWTError on any problem. Algorithm is pinned (rejects alg=none/RS*)."""
    return jwt.decode(
        token, get_settings().jwt_secret, algorithms=[JWT_ALG],
        options={"require": ["exp", "sub", "iat"]},
    )  # fmt: skip


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="Setu")


def encrypt_secret(secret: str, user_id: str) -> str:
    return crypto.encrypt(secret, aad=f"totp:{user_id}")


def decrypt_secret(enc: str, user_id: str) -> str:
    return crypto.decrypt(enc, aad=f"totp:{user_id}")


def totp_now(secret: str) -> str:
    return pyotp.TOTP(secret).now()


def check_totp(secret: str, code: str, last_step: int, now: float | None = None) -> int | None:
    """Return the matched time-step if valid and not replayed (step > last_step), else None."""
    t = now if now is not None else time.time()
    totp = pyotp.TOTP(secret)
    for offset in (-1, 0, 1):  # +-30s tolerance
        step = int(t // 30) + offset
        if step <= last_step:
            continue
        if code.isdigit() and len(code) == 6 and totp.at(step * 30) == code:
            return step
    return None
