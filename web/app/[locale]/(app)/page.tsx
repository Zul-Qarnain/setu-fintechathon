"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { PageHeader, Card } from "@/components/page-header";
import { Banner } from "@/components/banner";
import { Cny, Bdt } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { BudgetChart } from "@/components/dashboard-chart";
import { useApiError } from "@/components/use-api-error";
import { useAuth } from "@/components/auth-provider";
import { button, chip as hashChip } from "@/components/ui";
import { api } from "@/lib/api";
import { clampZero, isNegative, mul, sub } from "@/lib/decimal";
import { daysUntil, formatCny, formatDate, formatDateTime, shortHash } from "@/lib/format";
import type { Dashboard, Obligation } from "@/lib/types";

function Stat({ label, children, foot, tone = "default" }: { label: string; children: React.ReactNode; foot?: React.ReactNode; tone?: "default" | "warn" | "bad" }) {
  const ring = tone === "bad" ? "border-l-cinnabar-600" : tone === "warn" ? "border-l-amber-600" : "border-l-jade-600";
  return (
    <Card as="div" className={`border-l-4 ${ring}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-600">{label}</p>
      <p className="mt-2 font-mono text-[1.75rem] font-bold leading-8 tracking-tight text-ink">{children}</p>
      {foot ? <p className="mt-1 text-xs text-ink-600">{foot}</p> : null}
    </Card>
  );
}

function urgency(days: number): "urgent" | "soon" | "later" { return days <= 7 ? "urgent" : days <= 30 ? "soon" : "later"; }

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [err, fail] = useApiError();

  const load = useCallback(async () => { try { setData(await api.dashboard()); } catch (e) { fail(e); } }, [fail]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <><PageHeader title={t("title")} /><Banner tone="danger" title={err} /><button className={`${button("ghost")} mt-3`} onClick={() => void load()}>{tc("retry")}</button></>;
  if (!data) return <><PageHeader title={t("title")} /><p role="status" className="text-ink-600">{tc("loading")}</p></>;

  const safe = sub(data.monthly_budget_cny, data.spent_this_month_cny);
  const over = isNegative(safe);
  const sorted: Obligation[] = [...data.obligations].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const upcoming = sorted.filter((o) => daysUntil(o.due_date) <= 30);
  const fx = data.fx;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {user?.role === "family_approver" ? <Banner tone="info" className="mb-4">{t("approverNote")}</Banner> : null}

      <section aria-label={t("title")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("stats.nextDue")} foot={data.next_due ? `${data.next_due.payee_name} · ${formatDate(data.next_due.due_date, locale)}` : undefined}>
          {data.next_due ? <Cny value={data.next_due.amount_cny} /> : t("stats.noneDue")}
        </Stat>
        <Stat label={t("stats.bdtNeeded")} foot={<>{t("stats.rateLine", { rate: fx.rate })} · {fx.is_live ? tc("liveRate") : <strong className="text-amber-700">{tc("sampleRate")}</strong>} · {t("stats.fees")}</>}>
          {data.bdt_needed_next ? <Bdt value={data.bdt_needed_next} /> : "—"}
        </Stat>
        <Stat label={t("stats.safeToSpend")} tone={over ? "bad" : "default"} foot={over ? t("stats.negative") : t("stats.budgetLine", { budget: formatCny(data.monthly_budget_cny), spent: formatCny(data.spent_this_month_cny) })}>
          <span className="block"><Cny value={safe} /></span>
          <span className="block text-base font-semibold text-ink-700"><Bdt value={mul(clampZero(safe), fx.rate)} /></span>
          <span className="mt-0.5 block text-xs font-normal text-ink-600">{t("stats.safeBdt")}</span>
        </Stat>
        <Stat label={t("stats.pending")} tone={data.pending_actions > 0 ? "warn" : "default"} foot={t("stats.pendingHint")}>
          {data.pending_actions > 0
            ? <Link href="/approvals" className="inline-flex min-h-11 items-center rounded-lg bg-amber-50 px-3 font-mono text-xl text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600">{data.pending_actions}</Link>
            : <span>0</span>}
        </Stat>
      </section>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <Card aria-labelledby="tl-h">
          <h2 id="tl-h" className="text-lg font-semibold">{t("timeline.title")}</h2>
          {sorted.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-line p-6 text-center">
              <p className="text-ink-600">{t("timeline.empty")}</p>
              <Link href="/documents" className={`${button("primary")} mt-3`}>{t("timeline.emptyCta")}</Link>
            </div>
          ) : (
            <ol className="relative mt-4 space-y-5 border-l-2 border-line pl-6">
              {sorted.map((o) => {
                const d = daysUntil(o.due_date);
                const u = urgency(d);
                const chip = u === "urgent" ? "bg-cinnabar-50 text-cinnabar-700 border-cinnabar-600/50" : u === "soon" ? "bg-amber-50 text-amber-700 border-amber-600/50" : "bg-sunken text-ink-700 border-line-strong";
                return (
                  <li key={o.id} className="relative">
                    <span aria-hidden="true" className={`absolute -left-[1.95rem] top-1.5 h-3 w-3 rounded-full border-2 border-surface ${u === "urgent" ? "bg-cinnabar-600" : u === "soon" ? "bg-amber-600" : "bg-jade-600"}`} />
                    <div className="flex flex-wrap items-center gap-2">
                      <time dateTime={o.due_date} className="font-semibold">{formatDate(o.due_date, locale)}</time>
                      <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${chip}`}>{d < 0 ? t("timeline.overdue", { days: -d }) : t("timeline.dueIn", { days: d })}</span>
                      <StatusBadge status={o.status} />
                    </div>
                    <p className="mt-1 text-sm text-ink-700">{o.payee_name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <Cny value={o.amount_cny} className="text-lg font-bold" />
                      <Link href="/agent" className="inline-flex min-h-11 items-center text-sm font-semibold text-bridge-700 underline">{t("timeline.planPayment")} <span aria-hidden="true" className="ml-1">→</span></Link>
                      {o.doc_hash ? <span className="inline-flex items-center gap-1 text-xs text-ink-600" title={o.doc_hash}>{t("timeline.docHash")}: <code className={hashChip}>{shortHash(o.doc_hash.replace("sha256:", ""), 8)}</code></span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="space-y-6">
          <Card aria-labelledby="dl-h">
            <h2 id="dl-h" className="text-lg font-semibold">{t("deadlines.title")}</h2>
            {upcoming.length === 0 ? <p className="mt-3 text-sm text-ink-600">{t("deadlines.none")}</p> : (
              <ul className="mt-3 space-y-3">
                {upcoming.map((o) => {
                  const d = daysUntil(o.due_date);
                  const u = urgency(d);
                  const box = u === "urgent" ? "border-cinnabar-600/50 bg-cinnabar-50" : "border-amber-600/50 bg-amber-50";
                  return (
                    <li key={o.id} className={`rounded-lg border p-3 ${box}`}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-700">{u === "urgent" ? "⚠ " : "⏳ "}{t(`deadlines.${u}`)}</p>
                      <p className="mt-0.5 font-semibold"><Cny value={o.amount_cny} /> · {formatDate(o.due_date, locale)}</p>
                      <p className="text-sm text-ink-700">{o.payee_name}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card aria-labelledby="ch-h">
            <h2 id="ch-h" className="mb-2 text-lg font-semibold">{t("chart.title")}</h2>
            <BudgetChart budget={data.monthly_budget_cny} spent={data.spent_this_month_cny} remaining={safe} />
          </Card>

          <Card aria-labelledby="fx-h">
            <h2 id="fx-h" className="text-lg font-semibold">{t("fx.title")}</h2>
            <p className="mt-2 text-sm"><span className="font-semibold tabular-nums">{t("stats.rateLine", { rate: fx.rate })}</span></p>
            <p className={`mt-1 text-sm ${fx.is_live ? "text-jade-800" : "text-amber-700"} font-medium`}>{fx.is_live ? t("fx.live") : t("fx.sample")}</p>
            <p className="mt-1 text-xs text-ink-600">{t("fx.source", { source: t.has(`fx.sources.${fx.source}`) ? t(`fx.sources.${fx.source}`) : fx.source })} · {t("fx.asOf", { date: formatDateTime(fx.as_of, locale) })}</p>
            <p className="mt-1 text-xs text-ink-600">{fx.is_live ? fx.disclaimer : t("fx.sampleNote")}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
