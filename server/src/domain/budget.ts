/** Budget helpers (deterministic). Dates are ISO 'YYYY-MM-DD' strings. */
import { Decimal, HALF_EVEN } from './money.js';

export interface Obl {
  amount_cny: Decimal;
  due_date: string;
}
export interface BudgetSummary {
  monthly_budget_cny: Decimal;
  spent_this_month_cny: Decimal;
  remaining_cny: Decimal;
  over_budget: boolean;
}

export function summarize(monthlyBudget: Decimal, spent: Decimal): BudgetSummary {
  const remaining = monthlyBudget.minus(spent);
  return {
    monthly_budget_cny: monthlyBudget,
    spent_this_month_cny: spent,
    remaining_cny: remaining,
    over_budget: remaining.lt(0),
  };
}

/** Sum of open obligations due on/before `by` (ISO dates compare lexicographically). */
export const totalDueBy = (obls: Obl[], by: string): Decimal =>
  obls.filter((o) => o.due_date <= by).reduce((a, o) => a.plus(o.amount_cny), new Decimal(0));

export function monthlySavingNeeded(target: Decimal, today: string, due: string): Decimal {
  const y = (s: string) => Number(s.slice(0, 4));
  const m = (s: string) => Number(s.slice(5, 7));
  const months = Math.max(1, (y(due) - y(today)) * 12 + (m(due) - m(today)));
  return target.div(months).toDecimalPlaces(2, HALF_EVEN);
}
