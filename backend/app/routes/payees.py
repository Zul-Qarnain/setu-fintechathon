from __future__ import annotations

from fastapi import APIRouter

from app import schemas as s
from app import stubs

router = APIRouter(prefix="/payees", tags=["payees"])


@router.get("", response_model=list[s.PayeeOut])
def list_payees() -> list[s.PayeeOut]:
    return [stubs.payee(True), stubs.payee(False, "pay_new_02")]


@router.post("", response_model=s.PayeeOut, status_code=201)
def create_payee(body: s.PayeeCreate) -> s.PayeeOut:
    return stubs.payee(False, "pay_new_03").model_copy(update={"name": body.name, "bank": body.bank})


@router.post("/{payee_id}/verify", response_model=s.PayeeOut)
def verify_payee(payee_id: str) -> s.PayeeOut:
    return stubs.payee(True, payee_id)
