from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, Query

from app import schemas as s
from app import services
from app.deps import api_error, current_user, rate_limit
from app.domain.fx import FxError
from app.models import User

router = APIRouter(prefix="/fx", tags=["fx"], dependencies=[Depends(rate_limit)])


@router.get("/quote", response_model=s.FxQuote)
def quote(amount_cny: Decimal = Query(Decimal("1000"), gt=0, lt=100000000),
          to: str = Query("BDT", min_length=3, max_length=3),
          _user: User = Depends(current_user)) -> s.FxQuote:  # fmt: skip
    try:
        return services.fx_quote_out(amount_cny, to.upper())
    except FxError as e:
        raise api_error(422, "UNSUPPORTED_PAIR", str(e)) from None
