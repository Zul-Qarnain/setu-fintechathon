"use client";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { useTranslations } from "next-intl";
import { formatCny } from "@/lib/format";

/** Budget donut: spent vs remaining of the monthly budget; centre = remaining. */
export function BudgetChart({ budget, spent, remaining }: { budget: string; spent: string; remaining: string }) {
  const t = useTranslations("dashboard.chart");
  const b = Number(budget) || 0, s = Math.max(0, Number(spent) || 0), r = Math.max(0, Number(remaining) || 0);
  const pct = b > 0 ? Math.min(100, Math.round((s / b) * 1000) / 10) : 0;
  const slices = [
    { name: t("spent"), value: s, label: spent, color: "rgb(var(--jade-600))", pct },
    { name: t("remaining"), value: r, label: remaining, color: "rgb(var(--bridge-600) / .35)", pct: b > 0 ? Math.max(0, Math.round((100 - pct) * 10) / 10) : 0 },
  ];
  const data = s + r > 0 ? slices : [{ ...slices[1]!, value: 1 }];
  return (
    <figure className="mt-4 grid items-center gap-4 sm:grid-cols-[11rem_1fr] xl:grid-cols-1 2xl:grid-cols-[11rem_1fr]">
      <div role="img" aria-label={t("alt", { budget: formatCny(budget), spent: formatCny(spent) })} className="relative mx-auto h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="rgb(var(--surface))" strokeWidth={2} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="font-mono text-xl font-bold tabular-nums text-ink">{formatCny(remaining)}</span>
          <span className="text-xs text-ink-600">{t("remaining")}</span>
        </div>
      </div>
      <ul className="space-y-3 text-sm">
        {slices.map((x) => (
          <li key={x.name} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
            <span><span className="block text-ink-700">{x.name}</span><span className="font-mono font-semibold tabular-nums text-ink">{formatCny(x.label)}</span> <span className="text-xs text-ink-600">({x.pct}%)</span></span>
          </li>
        ))}
        <li className="border-t border-line pt-3"><span className="block text-ink-700">{t("budget")}</span><span className="font-mono font-semibold tabular-nums text-ink">{formatCny(budget)}</span> <span className="text-xs text-ink-600">(100%)</span></li>
      </ul>
      <table className="sr-only">
        <caption>{t("title")}</caption>
        <tbody>{[{ n: t("budget"), v: budget }, { n: t("spent"), v: spent }, { n: t("remaining"), v: remaining }].map((r2) => <tr key={r2.n}><th scope="row">{r2.n}</th><td>{formatCny(r2.v)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
