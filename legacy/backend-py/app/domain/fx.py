"""FX rates: offline SAMPLE fixture (default) + optional live adapter (open.er-api.com).

Sample rates are never presented as live: every quote carries `source` and `is_live`.
Quotes are cached for 24h (injectable clock for tests).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

import httpx

from app.config import data_dir, get_settings

SAMPLE_SOURCE = "fixture-sample"
LIVE_SOURCE = "live-open.er-api.com"
DISCLAIMER_SAMPLE = "SAMPLE rate from offline fixture. Not a live market rate."
DISCLAIMER_LIVE = "Indicative mid-market rate from open.er-api.com. Not a bank quote."
LIVE_URL = "https://open.er-api.com/v6/latest/{base}"

_BUILTIN_SAMPLE: dict[str, Any] = {
    "as_of": "2026-10-01T00:00:00Z",
    "base": "CNY",
    "rates": {"BDT": "17.2000", "USD": "0.1400", "INR": "11.6000", "PKR": "39.5000",
              "LKR": "42.0000", "NPR": "19.5000", "EUR": "0.1200"},
}  # fmt: skip


class FxError(Exception):
    pass


@dataclass(frozen=True)
class Rate:
    base: str
    quote: str
    rate: Decimal
    source: str
    as_of: datetime
    cached: bool = False

    @property
    def is_live(self) -> bool:
        return self.source == LIVE_SOURCE

    @property
    def disclaimer(self) -> str:
        return DISCLAIMER_LIVE if self.is_live else DISCLAIMER_SAMPLE


def load_fixture(path: Path | None = None) -> dict[str, Any]:
    p = path or (data_dir() / "fx_rates_sample.json")
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _BUILTIN_SAMPLE


def _parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)


def quantize_money(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


LiveFetcher = Callable[[str], dict[str, Any]]


def default_live_fetcher(base: str) -> dict[str, Any]:
    r = httpx.get(LIVE_URL.format(base=base), timeout=5.0)
    r.raise_for_status()
    return dict(r.json())


class FxService:
    def __init__(
        self,
        mode: str | None = None,
        ttl_seconds: int | None = None,
        clock: Callable[[], datetime] | None = None,
        fixture: dict[str, Any] | None = None,
        live_fetcher: LiveFetcher | None = None,
    ) -> None:
        st = get_settings()
        self.mode = mode or st.fx_mode
        self.ttl = timedelta(seconds=ttl_seconds if ttl_seconds is not None else st.fx_cache_ttl_seconds)
        self.clock = clock or (lambda: datetime.now(UTC))
        self._fixture = fixture
        self._live = live_fetcher or default_live_fetcher
        self._cache: dict[tuple[str, str], tuple[datetime, Rate]] = {}

    def _fix(self) -> dict[str, Any]:
        if self._fixture is None:
            self._fixture = load_fixture()
        return self._fixture

    def _from_fixture(self, base: str, quote: str) -> Rate:
        fx = self._fix()
        rates = {k: Decimal(v) for k, v in fx["rates"].items()}
        rates[fx["base"]] = Decimal("1")
        if base not in rates or quote not in rates:
            raise FxError(f"unsupported pair {base}/{quote}")
        rate = rates[quote] / rates[base]
        return Rate(base, quote, rate.quantize(Decimal("0.0001")), SAMPLE_SOURCE, _parse_dt(fx["as_of"]))

    def get_rate(self, base: str = "CNY", quote: str = "BDT") -> Rate:
        base, quote = base.upper(), quote.upper()
        now = self.clock()
        hit = self._cache.get((base, quote))
        if hit and now - hit[0] < self.ttl:
            r = hit[1]
            return Rate(r.base, r.quote, r.rate, r.source, r.as_of, cached=True)
        rate: Rate
        if self.mode == "live":
            try:
                data = self._live(base)
                raw = data["rates"][quote]
                rate = Rate(base, quote, Decimal(str(raw)).quantize(Decimal("0.0001")), LIVE_SOURCE, now)
            except Exception:  # network/parse failure -> labelled fixture fallback
                rate = self._from_fixture(base, quote)
        else:
            rate = self._from_fixture(base, quote)
        self._cache[(base, quote)] = (now, rate)
        return rate

    def convert(self, amount: Decimal, base: str = "CNY", quote: str = "BDT") -> tuple[Decimal, Rate]:
        r = self.get_rate(base, quote)
        return quantize_money(amount * r.rate), r


_service: FxService | None = None


def get_fx_service() -> FxService:
    global _service
    if _service is None:
        _service = FxService()
    return _service
