"use client";
import { useLocale, useTranslations } from "next-intl";
import { Bdt, Cny } from "./money";
import { formatDate } from "@/lib/format";
import type { Plan } from "@/lib/types";

export function PlanCard({ plan }: { plan: Plan }) {
  const t = useTranslations("agent.plan");
  const tc = useTranslations("common");
  const locale = useLocale();
  const sample = plan.fx_source.includes("fixture") || plan.fx_source.includes("sample");
  return (
    <section aria-label={t("title")} className="rounded-xl border border-line bg-paper p-3 text-sm">
      <h4 className="font-semibold">{t("title")}</h4>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-ink-600">{t("channel")}</dt><dd>{plan.channel}</dd>
        <dt className="text-ink-600">{tc("amount")}</dt><dd><Cny value={plan.amount_cny} className="font-semibold" /></dd>
        <dt className="text-ink-600">{t("fxRate")}</dt><dd className="tabular-nums">1 CNY = {plan.fx_rate} BDT {sample ? <span className="ml-1 rounded border border-amber-600/50 bg-amber-50 px-1.5 text-xs font-semibold text-amber-700">{tc("sampleRate")}</span> : null} <span className="text-xs text-ink-500">({plan.fx_source})</span></dd>
        {plan.fees.map((f) => (<><dt key={`${f.label}-l`} className="text-ink-600">{f.label}</dt><dd key={`${f.label}-v`}><Cny value={f.amount_cny} /></dd></>))}
        <dt className="text-ink-600">{t("totalFees")}</dt><dd><Cny value={plan.total_fees_cny} /> <span className="text-xs text-ink-600">({plan.fee_pct}%)</span></dd>
        <dt className="font-semibold">{t("bdtNeeded")}</dt><dd className="font-bold"><Bdt value={plan.bdt_needed} /></dd>
        {plan.due_date ? <><dt className="text-ink-600">{tc("dueDate")}</dt><dd>{formatDate(plan.due_date, locale)}</dd></> : null}
      </dl>
      {plan.notes.length ? <ul className="mt-2 list-disc pl-5 text-xs text-ink-600">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
    </section>
  );
}
