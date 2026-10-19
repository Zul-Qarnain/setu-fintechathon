"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { PageHeader, Card, CardHead } from "@/components/page-header";
import { Banner } from "@/components/banner";
import { Cny, Bdt } from "@/components/money";
import { BudgetChart } from "@/components/dashboard-chart";
import { SecurityLevels } from "@/components/security-levels";
import { useApiError } from "@/components/use-api-error";
import { useAuth } from "@/components/auth-provider";
import { Icon } from "@/components/nav-icons";
import { button } from "@/components/ui";
import { api } from "@/lib/api";
import { isNegative, mul, sub } from "@/lib/decimal";
import { daysUntil, formatCny, formatDate, formatDateTime } from "@/lib/format";
import { displayName, obligationKind, KIND_ICON, KIND_TONE } from "@/lib/persona";
import type { Dashboard, Obligation } from "@/lib/types";

type Tone = "blue" | "green" | "violet" | "amber";
const TINT: Record<Tone, { card: string; tile: string }> = {
  blue: { card: "bg-bridge-50/60 border-bridge-600/15", tile: "bg-bridge-50 text-bridge-600 dark:bg-bridge-600/15" },
  green: { card: "bg-jade-50/60 border-jade-600/15", tile: "bg-jade-50 text-jade-600 dark:bg-jade-600/15" },
  violet: { card: "bg-violet-50/60 border-violet-600/15", tile: "bg-violet-50 text-violet-600 dark:bg-violet-600/15" },
  amber: { card: "bg-amber-50/60 border-amber-600/15", tile: "bg-amber-50 text-amber-600 dark:bg-amber-600/15" },
};

function Kpi({ tone, icon, label, href, children, foot }: { tone: Tone; icon: string; label: string; href?: "/approvals" | "/agent" | "/documents"; children: ReactNode; foot?: ReactNode }) {
  const c = TINT[tone];
  const body = (
    <>
      <div className="flex items-center gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${c.tile}`}><Icon name={icon} className="h-[22px] w-[22px]" /></span>
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{label}</p>
        {href ? <Icon name="chevron" className="h-4 w-4 text-ink-600" /> : null}
      </div>
      <div className="mt-3 pl-14 text-[1.65rem] font-bold leading-8 tracking-tight text-ink">{children}</div>
      {foot ? <div className="mt-1 pl-14 text-xs leading-5 text-ink-600">{foot}</div> : null}
    </>
  );
  const cls = `block rounded-2xl border p-4 shadow-card sm:p-5 ${c.card}`;
  return href ? <Link href={href} className={`${cls} transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600`}>{body}</Link> : <div className={cls}>{body}</div>;
}

function TempleArt() {
  return (
    <svg viewBox="0 0 320 110" aria-hidden="true" focusable="false" className="pointer-events-none absolute -top-2 right-0 hidden h-28 w-80 text-bridge-600/25 md:block">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M0 100c40-22 70-30 110-18s60 2 90-14 70-10 120 6" opacity=".6" />
        <path d="M200 100V78h80v22M190 78h100l-10-10h-80zM205 68V56h70v12M196 56h88l-9-9h-70zM212 47V38h56v9M204 38h72l-8-9h-56zM240 29v-8" />
        <path d="M222 100V84h12v16M246 100V84h12v16" />
      </g>
    </svg>
  );
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [err, fail] = useApiError();

  const load = useCallback(async () => { try { setData(await api.dashboard()); } catch (e) { fail(e); } }, [fail]);
  useEffect(() => { void load(); }, [load]);

  const name = user ? displayName(user.email) : "";
  const title = t("welcomeBack", { name });
  if (err) return <><PageHeader title={title} /><Banner tone="danger" title={err} /><button className={`${button("ghost")} mt-3`} onClick={() => void load()}>{tc("retry")}</button></>;
  if (!data) return <><PageHeader title={title} /><p role="status" className="text-ink-600">{tc("loading")}</p></>;

  const safe = sub(data.monthly_budget_cny, data.spent_this_month_cny);
  const over = isNegative(safe);
  const sorted: Obligation[] = [...data.obligations].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const fx = data.fx;
  const rateChip = fx.is_live ? <span className="rounded-md bg-jade-50 px-1.5 py-0.5 text-[11px] font-semibold text-jade-800">{tc("liveRate")}</span> : <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-amber-700">{tc("sampleRate")}</span>;

  return (
    <>
      <div className="relative">
        <TempleArt />
        <PageHeader title={<>{title} <span aria-hidden="true">👋</span></>} subtitle={t("overview")} />
      </div>
      {user?.role === "family_approver" ? <Banner tone="info" className="mb-4">{t("approverNote")}</Banner> : null}

      <section aria-label={t("title")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="blue" icon="calendar" label={t("stats.nextDue")} foot={data.next_due ? <><span className="block truncate">{data.next_due.payee_name}</span>{formatDate(data.next_due.due_date, locale)}</> : undefined}>
          {data.next_due ? <Cny sans value={data.next_due.amount_cny} /> : <span className="text-lg">{t("stats.noneDue")}</span>}
        </Kpi>
        <Kpi tone="green" icon="wallet" label={t("stats.bdtNeeded")} foot={<><span className="block">{t("stats.basedOn", { rate: fx.rate })} · {t("stats.fees")}</span><span className="mt-1 inline-block">{rateChip}</span></>}>
          {data.bdt_needed_next ? <Bdt sans value={data.bdt_needed_next} /> : "—"}
        </Kpi>
        <Kpi tone="violet" icon="chart" label={t("stats.safeToSpend")} foot={over ? <span className="font-semibold text-cinnabar-700">{t("stats.negative")}</span> : t("stats.budgetLine", { budget: formatCny(data.monthly_budget_cny), spent: formatCny(data.spent_this_month_cny) })}>
          <Cny sans value={safe} className={over ? "text-cinnabar-700" : ""} />
        </Kpi>
        <Kpi tone="amber" icon="clock" label={t("stats.pending")} href="/approvals" foot={data.pending_actions > 0 ? t("stats.pendingHint") : t("stats.caughtUp")}>
          <span data-testid="pending-count">{data.pending_actions}</span>
        </Kpi>
      </section>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-6">
        <Card aria-labelledby="tl-h">
          <CardHead id="tl-h" icon={<Icon name="calendar" />} title={t("timeline.title")} sub={t("timeline.sub")} />
          {sorted.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-line p-6 text-center">
              <p className="text-ink-600">{t("timeline.empty")}</p>
              <Link href="/documents" className={`${button("primary")} mt-3`}>{t("timeline.emptyCta")}</Link>
            </div>
          ) : (
            <ol className="relative mt-5">
              <span aria-hidden="true" className="absolute bottom-6 left-[4.6rem] top-6 hidden w-px bg-line-strong sm:block" />
              {sorted.map((o, i) => {
                const d = daysUntil(o.due_date);
                const kind = obligationKind(o.title ?? o.payee_name);
                const dt = new Date(`${o.due_date}T00:00:00`);
                const due = d < 0 ? t("timeline.overdue", { days: -d }) : t("timeline.dueIn", { days: d });
                const dueTone = d < 0 || d <= 7 ? "text-cinnabar-700" : d <= 30 ? "text-amber-700" : "text-ink-600";
                return (
                  <li key={o.id} className="relative grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 border-b border-line py-4 last:border-b-0 sm:grid-cols-[3.6rem_1.5rem_2.75rem_minmax(0,1fr)_auto_auto]">
                    <time dateTime={o.due_date} className="hidden text-center text-sm font-semibold leading-5 text-ink sm:block">
                      {new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", { day: "numeric", month: "short" }).format(dt)}<span className="block font-normal text-ink-600">{dt.getFullYear()}</span>
                    </time>
                    <span aria-hidden="true" className={`relative z-10 mx-auto hidden h-3 w-3 rounded-full ring-4 ring-surface sm:block ${i === 0 ? "bg-cta" : "bg-line-strong"}`} />
                    <span className={`grid h-11 w-11 place-items-center rounded-xl ${KIND_TONE[kind]}`}><Icon name={KIND_ICON[kind]} /></span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{o.title ?? o.payee_name}</span><span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${KIND_TONE[kind]}`}>{t(`kinds.${kind}`)}</span></p>
                      <p className="truncate text-sm text-ink-600">{o.payee_name}</p>
                      <p className="text-xs"><span className="sm:hidden">{formatDate(o.due_date, locale)} · </span><span className={`font-medium ${dueTone}`}>{due}</span></p>
                    </div>
                    <div className="col-span-2 text-left sm:col-span-1 sm:text-right">
                      <Cny sans value={o.amount_cny} className="block text-base font-bold text-ink" />
                      <span className="text-xs text-ink-600">≈ <Bdt sans value={mul(o.amount_cny, fx.rate)} /></span>
                    </div>
                    <Link href={{ pathname: "/agent", query: { q: t("timeline.planPrompt", { title: o.title ?? o.payee_name ?? "" }) } }} className={`${button("primary")} col-span-2 sm:col-span-1`} data-testid={`plan-${o.id}`}>{t("timeline.planPayment")}</Link>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <SecurityLevels compact />
        </div>

        <div className="space-y-6">
          <Card aria-labelledby="ch-h">
            <CardHead id="ch-h" icon={<Icon name="pie" />} title={t("chart.title")} right={<span className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-700">{t("chart.thisMonth")}</span>} />
            <BudgetChart budget={data.monthly_budget_cny} spent={data.spent_this_month_cny} remaining={safe} />
          </Card>

          <Card aria-labelledby="fx-h">
            <CardHead id="fx-h" icon={<Icon name="swap" />} title={t("fx.title")} right={rateChip} />
            <p className="mt-4 text-xl font-bold tabular-nums text-ink">1 CNY = <span className="text-cta">{fx.rate}</span> BDT</p>
            <p className="mt-1 text-sm text-ink-600">{fx.is_live ? fx.disclaimer : t("fx.sampleNote")}</p>
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-sunken px-3 py-2 text-xs text-ink-600"><Icon name="info" className="h-4 w-4 shrink-0" />{t("fx.source", { source: t.has(`fx.sources.${fx.source}`) ? t(`fx.sources.${fx.source}`) : fx.source })} · {t("fx.asOf", { date: formatDateTime(fx.as_of, locale) })}</p>
          </Card>

        </div>
      </div>
    </>
  );
}
