"""Budget helpers (deterministic)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class Obl:
    amount_cny: Decimal
    due_date: date


@dataclass(frozen=True)
class BudgetSummary:
    monthly_budget_cny: Decimal
    spent_this_month_cny: Decimal
    remaining_cny: Decimal
    over_budget: bool


def summarize(monthly_budget: Decimal, spent: Decimal) -> BudgetSummary:
    remaining = monthly_budget - spent
    return BudgetSummary(monthly_budget, spent, remaining, remaining < 0)


def total_due_by(obligations: list[Obl], by: date) -> Decimal:
    """Sum of open obligations due on/before `by`."""
    return sum((o.amount_cny for o in obligations if o.due_date <= by), Decimal("0"))


def monthly_saving_needed(target: Decimal, today: date, due: date) -> Decimal:
    """Equal monthly amount to reach `target` by `due` (at least one month)."""
    months = max(1, (due.year - today.year) * 12 + (due.month - today.month))
    return (target / months).quantize(Decimal("0.01"))
