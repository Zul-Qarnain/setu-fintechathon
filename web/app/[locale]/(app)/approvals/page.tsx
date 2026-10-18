"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
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
      <PageHeader title={t("title")} subtitle={isApprover ? t("subtitleApprover") : t("subtitleStudent")} actions={<button type="button" className={button("ghost")} onClick={() => { setTouched([]); void load(); }}>{t("refresh")}</button>} />
      {isApprover ? <Banner tone="info" className="mb-4">{t("approverBanner")}</Banner> : null}
      {err ? <Banner tone="danger" className="mb-4">{err}</Banner> : null}
      <div role="tablist" aria-label={t("title")} className="mb-4 inline-flex overflow-hidden rounded-lg border border-line bg-surface">
        {(["pending", "history"] as const).map((k) => (
          <button key={k} role="tab" type="button" id={`tab-${k}`} aria-selected={tab === k} aria-controls="panel" onClick={() => setTab(k)} className={`min-h-11 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 ${tab === k ? "bg-primary text-white" : "text-ink hover:bg-paper"}`}>
            {t(`tabs.${k}`)}<span className={`ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs ${tab === k ? "bg-white/20" : "bg-paper text-ink-600"}`}>{k === "pending" ? pending.length : history.length}</span>
          </button>
        ))}
      </div>
      <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="space-y-4">
        {items === null && !err ? <p role="status" className="text-ink-600">{tc("loading")}</p> : null}
        {items !== null && shown.length === 0 ? <div className="grid min-h-[40vh] place-content-center justify-items-center gap-3 rounded-xl border border-dashed border-line p-10 text-center"><NavIcon name="approvals" className="h-8 w-8 text-ink-500" /><p className="text-ink-600">{tab === "pending" ? t("emptyPending") : t("emptyHistory")}</p></div> : null}
        {shown.map((a) => <ActionCard key={a.id} action={a} onChange={(r) => { setTouched((x) => (x.includes(r.id) ? x : [...x, r.id])); void load(); }} studentLabel={isApprover ? t("studentOf") : undefined} />)}
      </div>
    </>
  );
}
