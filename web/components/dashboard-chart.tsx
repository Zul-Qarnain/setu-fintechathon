"use client";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";
import { formatCny } from "@/lib/format";

/** Budget vs spent vs remaining (CNY). Values are plotted as numbers for geometry only; labels use exact decimal strings. */
export function BudgetChart({ budget, spent, remaining }: { budget: string; spent: string; remaining: string }) {
  const t = useTranslations("dashboard.chart");
  const rows = [
    { name: t("budget"), value: Number(budget), label: budget, fill: "rgb(var(--bridge-600))" },
    { name: t("spent"), value: Number(spent), label: spent, fill: "rgb(var(--amber-600))" },
    { name: t("remaining"), value: Math.max(0, Number(remaining)), label: remaining, fill: "rgb(var(--jade-600))" },
  ];
  return (
    <figure>
      <div role="img" aria-label={t("alt", { budget: formatCny(budget), spent: formatCny(spent) })} className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--line))" />
            <XAxis dataKey="name" tick={{ fill: "rgb(var(--ink-700))", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "rgb(var(--ink-700))", fontSize: 12 }} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => `¥${v}`} />
            <Tooltip formatter={(_v, _n, item) => formatCny((item.payload as { label: string }).label)} cursor={{ fill: "rgba(15,27,45,0.05)" }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.name} fill={r.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{t("title")}</caption>
        <tbody>{rows.map((r) => <tr key={r.name}><th scope="row">{r.name}</th><td>{formatCny(r.label)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
