"""Deterministic cost / BDT-needed computation. All money is Decimal; LLMs never compute numbers."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path

from app.config import data_dir
from app.domain.fx import FxService, quantize_money

# Illustrative sandbox channel parameters (used if data/channel_costs.csv is missing).
DEFAULT_CHANNEL = "Sandbox licensed partner A"
_BUILTIN_CHANNELS: dict[str, dict[str, Decimal]] = {
    "Sandbox licensed partner A": {"fixed_fee_usd": Decimal("3.00"), "fx_margin_pct": Decimal("0.40"),
                                   "pct": Decimal("0.00")},
    "Sandbox bank wire": {"fixed_fee_usd": Decimal("15.00"), "fx_margin_pct": Decimal("1.50"),
                          "pct": Decimal("0.00")},
}  # fmt: skip


@dataclass(frozen=True)
class FeeLineD:
    label: str
    amount_cny: Decimal


@dataclass(frozen=True)
class CostBreakdown:
    channel: str
    amount_cny: Decimal
    fx_rate: Decimal
    fx_source: str
    fees: list[FeeLineD]
    total_fees_cny: Decimal
    fee_pct: Decimal
    total_cny: Decimal
    bdt_needed: Decimal
    notes: list[str] = field(default_factory=list)


def load_channels(path: Path | None = None) -> dict[str, dict[str, Decimal]]:
    p = path or (data_dir() / "channel_costs.csv")
    out: dict[str, dict[str, Decimal]] = {}
    try:
        with p.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                if not row.get("channel", "").startswith("Sandbox"):
                    continue  # only sandbox channels are offered; others are reference rows
                try:
                    out[row["channel"]] = {
                        "fixed_fee_usd": Decimal(row.get("fixed_fee_usd") or "0"),
                        "fx_margin_pct": Decimal(row.get("fx_margin_pct") or "0"),
                        "pct": Decimal(row.get("send_cost_pct_200usd") or "0") * 0,
                    }
                except Exception:
                    continue
    except OSError:
        pass
    return out or dict(_BUILTIN_CHANNELS)


def compute_costs(
    amount_cny: Decimal,
    fx: FxService,
    channel: str = DEFAULT_CHANNEL,
    to_currency: str = "BDT",
    channels: dict[str, dict[str, Decimal]] | None = None,
) -> CostBreakdown:
    """BDT needed = (amount + fees in CNY) x CNY->BDT rate. Fees = fixed (USD->CNY) + FX margin."""
    if amount_cny <= 0:
        raise ValueError("amount must be positive")
    chans = channels or load_channels()
    params = chans.get(channel) or chans.get(DEFAULT_CHANNEL) or next(iter(chans.values()))
    usd_cny = fx.get_rate("USD", "CNY")
    fixed_cny = quantize_money(params["fixed_fee_usd"] * usd_cny.rate)
    margin_cny = quantize_money(amount_cny * params["fx_margin_pct"] / Decimal("100"))
    fees = [FeeLineD("Partner transfer fee", fixed_cny), FeeLineD("FX margin (est.)", margin_cny)]
    total_fees = fixed_cny + margin_cny
    total = amount_cny + total_fees
    rate = fx.get_rate("CNY", to_currency)
    notes = ["Setu never holds funds; licensed partners move money (sandbox only)."]
    if not rate.is_live:
        notes.append("FX rate is a SAMPLE fixture, not live.")
    return CostBreakdown(
        channel=channel if channel in chans else DEFAULT_CHANNEL,
        amount_cny=quantize_money(amount_cny),
        fx_rate=rate.rate,
        fx_source=rate.source,
        fees=fees,
        total_fees_cny=total_fees,
        fee_pct=(total_fees / amount_cny * 100).quantize(Decimal("0.01")),
        total_cny=quantize_money(total),
        bdt_needed=quantize_money(total * rate.rate),
        notes=notes,
    )


def days_until(due: date, today: date) -> int:
    return (due - today).days
