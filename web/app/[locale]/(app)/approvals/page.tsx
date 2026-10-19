"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader, Card } from "@/components/page-header";
import { Cny } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { TierBadge } from "@/components/tier-badge";
import { formatDateTime } from "@/lib/format";
import { useLocale } from "next-intl";
import { Banner } from "@/components/banner";
import { ActionCard } from "@/components/action-card";
import { useApiError } from "@/components/use-api-error";
import { useAuth } from "@/components/auth-provider";
import { NavIcon } from "@/components/nav-icons";
import { button } from "@/components/ui";
import { api } from "@/lib/api";
import type { ActionOut } from "@/lib/types";

const OPEN = ["awaiting_approval", "cooling_off"];

export default function ApprovalsPage() {
  const t = useTranslations("approvals");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const locale = useLocale();
  const [items, setItems] = useState<ActionOut[] | null>(null);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [touched, setTouched] = useState<string[]>([]);
  const [err, fail, clear] = useApiError();

  const load = useCallback(async () => { clear(); try { setItems(await api.actions()); } catch (e) { fail(e); } }, [fail, clear]);
  useEffect(() => { void load(); }, [load]);

  // Cards the user just acted on stay visible (with their result) in Pending until the next refresh.
  const pending = (items ?? []).filter((a) => OPEN.includes(a.status) || touched.includes(a.id));
  const history = (items ?? []).filter((a) => !OPEN.includes(a.status) && !touched.includes(a.id));
  const shown = tab === "pending" ? pending : history;
  const isApprover = user?.role === "family_approver";

  return (
    <>
      <PageHeader icon={<NavIcon name="approvals" />} title={t("title")} subtitle={isApprover ? t("subtitleApprover") : t("subtitleStudent")} actions={<button type="button" className={button("ghost")} onClick={() => { setTouched([]); void load(); }}>{t("refresh")}</button>} />
      {isApprover ? <Banner tone="info" className="mb-4">{t("approverBanner")}</Banner> : null}
      {err ? <Banner tone="danger" className="mb-4">{err}</Banner> : null}
      <div role="tablist" aria-label={t("title")} className="mb-5 flex gap-6 border-b border-line">
        {(["pending", "history"] as const).map((k) => (
          <button key={k} role="tab" type="button" id={`tab-${k}`} aria-selected={tab === k} aria-controls="panel" onClick={() => setTab(k)} className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 ${tab === k ? "border-cta text-cta" : "border-transparent text-ink-600 hover:text-ink"}`}>
            {t(`tabs.${k}`)}<span className={`ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs ${tab === k ? "bg-bridge-50 text-bridge-700" : "bg-sunken text-ink-600"}`}>{k === "pending" ? pending.length : history.length}</span>
          </button>
        ))}
      </div>
      <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="space-y-4">
        {items === null && !err ? <p role="status" className="text-ink-600">{tc("loading")}</p> : null}
        {items !== null && shown.length === 0 ? <div className="grid min-h-[40vh] place-content-center justify-items-center gap-3 rounded-xl border border-dashed border-line p-10 text-center"><NavIcon name="approvals" className="h-8 w-8 text-ink-500" /><p className="text-ink-600">{tab === "pending" ? t("emptyPending") : t("emptyHistory")}</p></div> : null}
        {tab === "history" && history.length ? (
          <Card as="div" className="hidden p-0 sm:p-0 md:block"><div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("tabs.history")}</caption>
              <thead className="text-xs text-ink-600"><tr className="border-b border-line">{["date", "type", "payee", "amount", "tier", "status", "by"].map((c) => <th key={c} scope="col" className="px-4 py-3 font-semibold">{t(`hist.${c}`)}</th>)}</tr></thead>
              <tbody>{history.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-700">{formatDateTime(a.created_at, locale)}</td>
                  <td className="px-4 py-3 font-medium text-ink">{t(`type.${a.type}`)}</td>
                  <td className="max-w-[14rem] truncate px-4 py-3 text-ink-700">{typeof a.params.payee_name === "string" ? a.params.payee_name : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3">{typeof a.params.amount_cny === "string" ? <Cny value={a.params.amount_cny} /> : "—"}</td>
                  <td className="px-4 py-3"><TierBadge tier={a.tier} /></td>
                  <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 text-xs text-ink-700">{a.approvals.length ? a.approvals.map((x) => tc(`roles.${x.role}`)).join(" + ") : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div></Card>
        ) : null}
        {shown.map((a) => tab === "history" ? <div key={a.id} className="md:hidden"><ActionCard action={a} compact /></div> : <ActionCard key={a.id} action={a} onChange={(r) => { setTouched((x) => (x.includes(r.id) ? x : [...x, r.id])); void load(); }} studentLabel={isApprover ? t("studentOf") : undefined} />)}
      </div>
    </>
  );
}
