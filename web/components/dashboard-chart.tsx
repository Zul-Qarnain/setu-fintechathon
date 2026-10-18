"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useTranslations } from "next-intl";
import { formatCny } from "@/lib/format";

/** Budget donut: spent vs remaining of the monthly budget, centre = % spent, legend rows with mono amounts. */
export function BudgetChart({ budget, spent, remaining }: { budget: string; spent: string; remaining: string }) {
  const t = useTranslations("dashboard.chart");
  const b = Number(budget) || 0, s = Math.max(0, Number(spent) || 0), r = Math.max(0, Number(remaining) || 0);
  const pct = b > 0 ? Math.min(100, Math.round((s / b) * 100)) : 0;
  const slices = [
    { name: t("spent"), value: s, label: spent, color: "rgb(var(--amber-600))", pct },
    { name: t("remaining"), value: r, label: remaining, color: "rgb(var(--jade-600))", pct: b > 0 ? Math.max(0, 100 - pct) : 0 },
  ];
  const data = s + r > 0 ? slices : [{ ...slices[1]!, value: 1 }];
  return (
    <figure>
      <div role="img" aria-label={t("alt", { budget: formatCny(budget), spent: formatCny(spent) })} className="relative mx-auto h-48 w-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius="64%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="rgb(var(--surface))" strokeWidth={2} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(_v, _n, item) => formatCny((item.payload as { label: string }).label)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="font-mono text-2xl font-bold tabular-nums text-ink">{pct}%</span>
          <span className="text-xs text-ink-600">{t("spent")}</span>
        </div>
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        <li className="flex items-center justify-between gap-3 border-t border-line pt-2"><span className="text-ink-600">{t("budget")}</span><span className="font-mono tabular-nums font-semibold">{formatCny(budget)}</span></li>
        {slices.map((x) => (
          <li key={x.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-ink-700"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} />{x.name}</span>
            <span className="font-mono tabular-nums">{formatCny(x.label)} <span className="text-ink-600">· {x.pct}%</span></span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{t("title")}</caption>
        <tbody>{[{ n: t("budget"), v: budget }, { n: t("spent"), v: spent }, { n: t("remaining"), v: remaining }].map((r2) => <tr key={r2.n}><th scope="row">{r2.n}</th><td>{formatCny(r2.v)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
