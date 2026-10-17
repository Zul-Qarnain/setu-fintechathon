from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas as s
from app import security, services
from app.db import append_audit, get_session
from app.deps import api_error, current_user, rate_limit, verify_user_totp
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(rate_limit)])


@router.post("/register", response_model=s.UserOut, status_code=201)
def register(body: s.RegisterRequest, db: Session = Depends(get_session)) -> s.UserOut:
    return services.user_out(services.register_user(db, body))


@router.post("/login", response_model=s.TokenResponse)
def login(body: s.LoginRequest, db: Session = Depends(get_session)) -> s.TokenResponse:
    user = db.execute(select(User).where(User.email == body.email.strip().lower())).scalar_one_or_none()
    # constant-ish work for unknown users to limit user enumeration timing
    ok = security.verify_password(body.password, user.password_hash if user else security.hash_password("x"))
    if user is None or user.erased or not ok:
        append_audit(db, user.id if user else "anonymous", "login.failed", {})
        db.commit()
        raise api_error(401, "UNAUTHORIZED", "Invalid email or password")
    token, ttl = security.create_token(user.id, user.role)
    append_audit(db, user.id, "login.ok", {})
    return s.TokenResponse(access_token=token, expires_in=ttl, user=services.user_out(user))


@router.post("/totp/setup", response_model=s.TotpSetupResponse)
def totp_setup(user: User = Depends(current_user), db: Session = Depends(get_session)) -> s.TotpSetupResponse:
    if user.totp_enabled:
        raise api_error(409, "TOTP_ALREADY_ENABLED", "TOTP already enabled")
    secret = security.new_totp_secret()
    user.totp_secret_enc = security.encrypt_secret(secret, user.id)
    append_audit(db, user.id, "totp.setup_started", {})
    return s.TotpSetupResponse(secret=secret, otpauth_uri=security.totp_uri(secret, user.email))


@router.post("/totp/verify", response_model=s.TotpVerifyResponse)
def totp_verify(
    body: s.TotpVerifyRequest, user: User = Depends(current_user), db: Session = Depends(get_session)
) -> s.TotpVerifyResponse:
    if not user.totp_secret_enc:
        raise api_error(409, "TOTP_NOT_STARTED", "Call /auth/totp/setup first")
    # enrolment confirmation: accepts the first valid code, then enables
    if user.totp_enabled:
        verify_user_totp(db, user, body.code)
        return s.TotpVerifyResponse(verified=True, totp_enabled=True)
    secret = security.decrypt_secret(user.totp_secret_enc, user.id)
    step = security.check_totp(secret, body.code, user.totp_last_step)
    if step is None:
        append_audit(db, user.id, "totp.enrol_failed", {})
        db.commit()
        raise api_error(403, "TOTP_INVALID", "Invalid or expired TOTP code")
    user.totp_enabled = True
    user.totp_last_step = step
    append_audit(db, user.id, "totp.enabled", {})
    return s.TotpVerifyResponse(verified=True, totp_enabled=True)
