from __future__ import annotations

from fastapi import APIRouter

from app import schemas as s
from app import stubs

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=s.UserOut, status_code=201)
def register(body: s.RegisterRequest) -> s.UserOut:
    return stubs.USER.model_copy(update={"email": body.email, "role": body.role,
                                         "locale": body.locale, "totp_enabled": False})


@router.post("/login", response_model=s.TokenResponse)
def login(body: s.LoginRequest) -> s.TokenResponse:
    return s.TokenResponse(access_token="stub.jwt.token", expires_in=3600, user=stubs.USER)


@router.post("/totp/setup", response_model=s.TotpSetupResponse)
def totp_setup() -> s.TotpSetupResponse:
    return s.TotpSetupResponse(
        secret="JBSWY3DPEHPK3PXP",
        otpauth_uri="otpauth://totp/Setu:aisha@demo.setu.test?secret=JBSWY3DPEHPK3PXP&issuer=Setu")


@router.post("/totp/verify", response_model=s.TotpVerifyResponse)
def totp_verify(body: s.TotpVerifyRequest) -> s.TotpVerifyResponse:
    return s.TotpVerifyResponse(verified=True, totp_enabled=True)
