"use client";
import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bdt, Cny } from "./money";
import { Icon } from "./nav-icons";
import { formatDate } from "@/lib/format";
import type { Plan } from "@/lib/types";

/** Deterministic payment plan: amount, FX, fee breakdown, BDT total. */
export function PlanCard({ plan }: { plan: Plan }) {
  const t = useTranslations("agent.plan");
  const tc = useTranslations("common");
  const locale = useLocale();
  const sample = plan.fx_source.includes("fixture") || plan.fx_source.includes("sample");
  return (
    <section aria-label={t("title")} className="rounded-2xl border border-line bg-surface p-4 text-sm shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="file" className="h-4 w-4 text-cta" />
        <h4 className="font-semibold text-ink">{t("title")}</h4>
        <span className="rounded-md bg-bridge-50 px-1.5 py-0.5 text-[11px] font-semibold text-bridge-700">{plan.channel}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-sunken p-3"><p className="text-xs text-ink-600">{tc("amount")}</p><Cny sans value={plan.amount_cny} className="text-xl font-bold text-ink" /></div>
        <div className="rounded-lg bg-sunken p-3"><p className="text-xs text-ink-600">{t("bdtNeeded")}</p><Bdt sans value={plan.bdt_needed} className="text-xl font-bold text-ink" /><p className="text-[11px] text-ink-600">1 CNY = {plan.fx_rate} BDT {sample ? <span className="font-semibold text-amber-700">· {tc("sampleRate")}</span> : null}</p></div>
      </div>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
        {plan.fees.map((f) => (<Fragment key={f.label}><dt className="text-ink-600">{f.label}</dt><dd className="text-right"><Cny value={f.amount_cny} /></dd></Fragment>))}
        <dt className="border-t border-line pt-1.5 font-semibold text-ink">{t("totalFees")} <span className="text-xs font-normal text-ink-600">({plan.fee_pct}%)</span></dt><dd className="border-t border-line pt-1.5 text-right font-semibold"><Cny value={plan.total_fees_cny} /></dd>
        {plan.due_date ? <><dt className="text-ink-600">{tc("dueDate")}</dt><dd className="text-right">{formatDate(plan.due_date, locale)}</dd></> : null}
        <dt className="text-xs text-ink-600">{t("fxRate")}</dt><dd className="text-right text-xs text-ink-600">{plan.fx_source}</dd>
      </dl>
      {plan.notes.length ? <ul className="mt-2 list-disc pl-5 text-xs text-ink-600">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
    </section>
  );
}
