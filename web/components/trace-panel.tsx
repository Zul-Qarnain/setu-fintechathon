"use client";
import { waitingSubKey } from "@/lib/approval-text";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Banner } from "./banner";
import { Countdown } from "./countdown";
import { TierBadge } from "./tier-badge";
import { RequiredChips, ReasonList } from "./action-card";
import { formatDateTime } from "@/lib/format";
import type { ActionOut, ChatResponse, TraceStep } from "@/lib/types";

const ICON: Record<TraceStep["status"], string> = { ok: "✓", blocked: "⛔", skipped: "–", rejected: "✕" };
const TONE: Record<TraceStep["status"], string> = {
  ok: "border-jade-600/50 bg-jade-50 text-jade-800",
  blocked: "border-cinnabar-600 bg-cinnabar-50 text-cinnabar-700",
  skipped: "border-slate-300 bg-slate-100 text-ink-600",
  rejected: "border-cinnabar-600 bg-cinnabar-50 text-cinnabar-700",
};

export function summariseDetail(d: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    parts.push(`${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join(" · ");
}

export function intakeText(steps: TraceStep[]): string {
  return summariseDetail(steps.find((s) => s.step === "intake")?.detail ?? {});
}

function primaryAction(r: ChatResponse): ActionOut | undefined {
  return r.proposed_actions.find((a) => a.tier === r.trace.tier) ?? r.proposed_actions[0];
}

export function TracePanel({ turn }: { turn: ChatResponse | null }) {
  const t = useTranslations("agent.trace");
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(null);
  if (!turn) {
    return (
      <aside aria-label={t("title")} className="rounded-xl border border-dashed border-line bg-white p-5 text-sm text-ink-600">
        <h2 className="text-lg font-semibold text-ink">{t("title")}</h2>
        <p className="mt-2">{t("empty")}</p>
        <ol className="mt-3 flex flex-wrap gap-1.5 text-xs">{(["intake", "planner", "tools", "guardian", "policy", "executor", "validator"] as const).map((s, i) => <li key={s} className="rounded-md border border-line bg-paper px-2 py-0.5">{i + 1}. {t(`steps.${s}`)}</li>)}</ol>
      </aside>
    );
  }
  const tc = turn.trace;
  const act = primaryAction(turn);
  const blocked = tc.decision === "BLOCK" || tc.tier === "T4";
  const cooling = tc.decision === "REQUIRE_COOLING_OFF";
  const injected = !!act?.decision.reasons.some((r) => r === "INJECTION_DETECTED" || r === "DOC_ONLY_SOURCE");
  const until = act?.decision.cooling_off_until ?? null;
  const frame = blocked ? "border-cinnabar-600 ring-2 ring-cinnabar-600/30" : cooling ? "border-amber-600 ring-2 ring-amber-600/30" : "border-line";

  return (
    <aside aria-label={t("title")} aria-live="polite" className={`rounded-xl border-2 bg-white p-4 shadow-card ${frame}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <span className="rounded-md border border-line bg-paper px-2 py-0.5 text-xs">{t("llmMode")}: <code>{tc.llm_mode}</code></span>
        <span className="ml-auto text-xs text-ink-500"><code>{tc.trace_id}</code></span>
      </div>

      {blocked ? (
        <div role="alert" className="mt-3 rounded-lg border-2 border-cinnabar-600 bg-cinnabar-50 p-4 text-cinnabar-700" data-testid="t4-block">
          <p className="flex items-center gap-2 text-xl font-extrabold"><span aria-hidden="true">⛔</span>{t("blockedTitle")}</p>
          <p className="mt-1 text-sm font-medium">{t("blockedSub")}</p>
          {injected ? <p className="mt-2 text-sm">{t("dataNotInstructions")}</p> : null}
          <div className="mt-2 text-ink"><ReasonList reasons={act?.decision.reasons ?? []} /></div>
        </div>
      ) : null}
      {cooling ? (
        <div className="mt-3 rounded-lg border-2 border-amber-600 bg-amber-50 p-4 text-amber-700" data-testid="cooling-off">
          <p className="flex items-center gap-2 text-lg font-extrabold"><span aria-hidden="true">⏳</span>{t("coolingTitle")}</p>
          <p className="mt-1 text-sm">{t("coolingSub")}</p>
          {until ? <p className="mt-2 text-base font-semibold">{t("coolingEnds")}: <Countdown until={until} /> <span className="text-xs font-normal">({formatDateTime(until, locale)})</span></p> : null}
        </div>
      ) : null}
      {!blocked && !cooling && tc.decision === "REQUIRE_APPROVAL" ? (
        <Banner tone="warning" title={t("waitingTitle")} className="mt-3">{t(waitingSubKey(tc.tier, act?.decision.required))} <Link href="/approvals" className="font-semibold underline">{t("openApprovals")}</Link></Banner>
      ) : null}
      {!blocked && !cooling && tc.decision === "ALLOW" && tc.tier === "T2" ? <Banner tone="info" title={t("t2Title")} className="mt-3">{t("t2Sub")}</Banner> : null}

      <ol className="mt-4 space-y-2" aria-label={t("pipeline")}>
        {tc.steps.map((s, i) => {
          const isOpen = open === s.step;
          return (
            <li key={`${s.step}-${i}`} className="relative">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.step)} className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 ${TONE[s.status]}`} data-testid={`step-${s.step}`} data-status={s.status}>
                <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-current text-xs font-bold">{ICON[s.status]}</span>
                <span className="font-semibold">{i + 1}. {t(`steps.${s.step}`)}</span>
                <span className="sr-only">{t(`status.${s.status}`)}</span>
                <span className="ml-auto text-xs opacity-80">{s.duration_ms} ms</span>
              </button>
              {isOpen ? <div className="mt-1 rounded-lg border border-line bg-paper p-3 text-xs"><p className="mb-1 font-medium text-ink-700">{t(`desc.${s.step}`)}</p><pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-ink">{JSON.stringify(s.detail, null, 2)}</pre></div> : null}
              {s.step === "tools" && tc.tool_calls.length ? (
                <div className="mt-1 overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">{t("toolCalls")}</caption>
                    <thead className="bg-paper"><tr><th scope="col" className="px-2 py-1">{t("tool")}</th><th scope="col" className="px-2 py-1">{t("args")}</th><th scope="col" className="px-2 py-1">{t("output")}</th><th scope="col" className="px-2 py-1">{t("ok")}</th></tr></thead>
                    <tbody>{tc.tool_calls.map((c, j) => <tr key={j} className="border-t border-line align-top"><th scope="row" className="px-2 py-1 font-mono">{c.tool}</th><td className="px-2 py-1"><code className="break-all">{JSON.stringify(c.args)}</code></td><td className="px-2 py-1"><code className="break-all">{JSON.stringify(c.output)}</code></td><td className="px-2 py-1">{c.ok ? "✓" : "✕"}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 rounded-lg border border-line bg-paper p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{t("finalTier")}</span><TierBadge tier={tc.tier} />
          <span className="rounded-md border border-line bg-white px-2 py-0.5 text-xs font-semibold">{t(`decision.${tc.decision}`)}</span>
        </div>
        {act && !blocked ? <div className="mt-2"><ReasonList reasons={act.decision.reasons} /></div> : null}
        {act && act.decision.required.length ? <div className="mt-2"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-600">{t("required")}</p><RequiredChips required={act.decision.required} /></div> : null}
        <p className={`mt-2 text-xs font-medium ${tc.reply_validated ? "text-jade-800" : "text-cinnabar-700"}`}>{tc.reply_validated ? `✓ ${t("validated")}` : `✕ ${t("notValidated")}`}</p>
        {tc.audit_seqs.length ? <p className="mt-1 text-xs text-ink-600">{t("auditSeqs")}: {tc.audit_seqs.map((n) => <Link key={n} href="/audit" className="mr-1 font-mono text-bridge-700 underline">#{n}</Link>)}</p> : null}
      </div>
    </aside>
  );
}
