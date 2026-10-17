"""FastAPI dependencies: auth, roles, TOTP verification, rate limiting."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app import security
from app.config import get_settings
from app.db import append_audit, get_session
from app.models import User, aware


def api_error(status: int, code: str, message: str, details: dict[str, object] | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, "details": details or {}})


def current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_session)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise api_error(401, "UNAUTHORIZED", "Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = security.decode_token(token)
    except jwt.PyJWTError:
        raise api_error(401, "UNAUTHORIZED", "Invalid or expired token") from None
    user = db.get(User, claims["sub"])
    if user is None or user.erased or user.role != claims.get("role"):
        raise api_error(401, "UNAUTHORIZED", "Invalid token subject")
    return user


def require_roles(*roles: str) -> Callable[[User], User]:
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise api_error(403, "FORBIDDEN", "Role not permitted for this operation")
        return user

    return dep


def verify_user_totp(db: Session, user: User, code: str, enrolling: bool = False) -> None:
    """Check a TOTP for `user` with replay protection and brute-force lockout. Raises on failure."""
    st = get_settings()
    now = datetime.now(UTC)
    locked = aware(user.totp_locked_until)
    if locked and locked > now:
        raise api_error(429, "TOTP_LOCKED", "Too many failed TOTP attempts; try again later",
                        {"retry_after_seconds": int((locked - now).total_seconds())})  # fmt: skip
    if (not user.totp_enabled and not enrolling) or not user.totp_secret_enc:
        raise api_error(403, "TOTP_NOT_ENABLED", "TOTP is not enabled for this user")
    secret = security.decrypt_secret(user.totp_secret_enc, user.id)
    step = security.check_totp(secret, code, user.totp_last_step)
    if step is None:
        user.totp_failures += 1
        append_audit(db, user.id, "totp.failed", {"failures": user.totp_failures})
        if user.totp_failures >= st.totp_max_failures:
            user.totp_locked_until = (now + timedelta(seconds=st.totp_lock_seconds)).replace(tzinfo=None)
            user.totp_failures = 0
            append_audit(db, user.id, "totp.locked", {"seconds": st.totp_lock_seconds})
        db.commit()  # persist failure counters even though we raise
        raise api_error(403, "TOTP_INVALID", "Invalid or expired TOTP code")
    user.totp_failures = 0
    user.totp_last_step = step
    db.flush()


class RateLimiter:
    """Tiny in-memory sliding-window limiter keyed by (client, path-group)."""

    def __init__(self) -> None:
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True

    def reset(self) -> None:
        self.hits.clear()


limiter = RateLimiter()


def rate_limit(request: Request) -> None:
    st = get_settings()
    client = request.client.host if request.client else "unknown"
    if not limiter.check(f"{client}:{request.url.path}", st.rate_limit_per_minute):
        raise api_error(429, "RATE_LIMITED", "Too many requests")
