from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest

from app.domain import budget, costs, fx


class Clock:
    def __init__(self):
        self.t = datetime(2026, 10, 17, tzinfo=UTC)

    def __call__(self):
        return self.t


def svc(mode="fixture", clock=None, fetcher=None):
    return fx.FxService(mode=mode, clock=clock or Clock(), live_fetcher=fetcher)


def test_fixture_rate_is_labelled_sample():
    r = svc().get_rate("CNY", "BDT")
    assert r.rate == Decimal("17.2000") and r.source == "fixture-sample" and not r.is_live
    assert "SAMPLE" in r.disclaimer


def test_cross_and_inverse_rates():
    assert svc().get_rate("USD", "CNY").rate == Decimal("7.1429")
    assert svc().get_rate("CNY", "CNY").rate == Decimal("1.0000")


def test_unsupported_pair():
    with pytest.raises(fx.FxError):
        svc().get_rate("CNY", "XXX")


def test_cache_24h_then_refresh():
    c = Clock()
    calls = []

    def fetcher(base):
        calls.append(base)
        return {"rates": {"BDT": 18.5}}

    s = svc("live", c, fetcher)
    r1 = s.get_rate("CNY", "BDT")
    r2 = s.get_rate("CNY", "BDT")
    assert r1.is_live and r1.rate == Decimal("18.5000") and not r1.cached and r2.cached and calls == ["CNY"]
    c.t += timedelta(hours=23, minutes=59)
    assert s.get_rate("CNY", "BDT").cached
    c.t += timedelta(minutes=2)
    assert not s.get_rate("CNY", "BDT").cached and len(calls) == 2


def test_live_failure_falls_back_to_labelled_fixture():
    def boom(base):
        raise RuntimeError("network down")

    r = svc("live", fetcher=boom).get_rate("CNY", "BDT")
    assert r.source == "fixture-sample" and not r.is_live


def test_convert_quantizes():
    amt, r = svc().convert(Decimal("100.005"), "CNY", "BDT")
    assert amt == Decimal("1720.09") and r.quote == "BDT"


def test_costs_known_values():
    c = costs.compute_costs(Decimal("18500"), svc())
    assert [f.amount_cny for f in c.fees] == [Decimal("21.43"), Decimal("74.00")]
    assert c.total_fees_cny == Decimal("95.43") and c.fee_pct == Decimal("0.52")
    assert c.bdt_needed == Decimal("319841.40") and c.fx_source == "fixture-sample"
    assert any("SAMPLE" in n for n in c.notes)


def test_costs_rejects_nonpositive():
    for bad in ("0", "-5"):
        with pytest.raises(ValueError):
            costs.compute_costs(Decimal(bad), svc())


def test_costs_other_channel_and_unknown_channel_default():
    wire = costs.compute_costs(Decimal("1000"), svc(), "Sandbox bank wire")
    assert wire.total_fees_cny > costs.compute_costs(Decimal("1000"), svc()).total_fees_cny
    assert costs.compute_costs(Decimal("1000"), svc(), "Nonexistent").channel == costs.DEFAULT_CHANNEL


def test_load_channels_only_sandbox_rows():
    ch = costs.load_channels()
    assert ch and all(k.startswith("Sandbox") for k in ch)


def test_days_until():
    assert costs.days_until(date(2027, 3, 1), date(2027, 2, 1)) == 28


def test_budget_summary_and_due():
    b = budget.summarize(Decimal("3500"), Decimal("1240.50"))
    assert b.remaining_cny == Decimal("2259.50") and not b.over_budget
    assert budget.summarize(Decimal("100"), Decimal("150")).over_budget
    obs = [budget.Obl(Decimal("10"), date(2026, 11, 1)), budget.Obl(Decimal("20"), date(2027, 1, 1))]
    assert budget.total_due_by(obs, date(2026, 12, 31)) == Decimal("10")
    assert budget.total_due_by(obs, date(2027, 1, 1)) == Decimal("30")


def test_monthly_saving_needed():
    assert budget.monthly_saving_needed(Decimal("1200"), date(2026, 10, 17), date(2027, 2, 1)) == Decimal("300.00")
    assert budget.monthly_saving_needed(Decimal("100"), date(2026, 10, 1), date(2026, 10, 20)) == Decimal("100.00")
