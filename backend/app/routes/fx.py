from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Query

from app import schemas as s
from app import stubs

router = APIRouter(prefix="/fx", tags=["fx"])


@router.get("/quote", response_model=s.FxQuote)
def quote(amount_cny: Decimal = Query(Decimal("1000"), gt=0), to: str = "BDT") -> s.FxQuote:
    return stubs.fx_quote(amount_cny)
