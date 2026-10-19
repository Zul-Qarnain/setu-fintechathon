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
import { Icon } from "./nav-icons";
import type { ActionOut, ChatResponse, TraceStep } from "@/lib/types";

const DOT: Record<TraceStep["status"], string> = {
  ok: "bg-jade-700 text-white",
  blocked: "bg-cinnabar-600 text-white",
  skipped: "border-2 border-line-strong bg-surface text-ink-600",
  rejected: "bg-cinnabar-600 text-white",
};

/** key: value lines for the monospace detail box. */
function detailLines(d: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    const val = Array.isArray(v) ? `[${v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")}]` : typeof v === "object" ? JSON.stringify(v) : String(v);
    out.push(`${k}: ${val.length > 90 ? val.slice(0, 88) + "…" : val}`);
  }
  return out;
}

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
      <aside aria-label={t("title")} className="rounded-2xl border border-line bg-surface p-5 text-sm text-ink-600 shadow-card">
        <h2 className="text-lg font-semibold text-ink">{t("title")}</h2>
        <p className="mt-2">{t("empty")}</p>
        <ol className="relative mt-4 space-y-3">{(["intake", "planner", "tools", "guardian", "policy", "executor", "validator"] as const).map((s, i) => <li key={s} className="flex items-center gap-3"><span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full border-2 border-line-strong text-xs font-semibold">{i + 1}</span><span className="text-ink-700">{t(`steps.${s}`)}</span></li>)}</ol>
      </aside>
    );
  }
  const tc = turn.trace;
  const act = primaryAction(turn);
  const blocked = tc.decision === "BLOCK" || tc.tier === "T4";
  const cooling = tc.decision === "REQUIRE_COOLING_OFF";
  const injected = !!act?.decision.reasons.some((r) => r === "INJECTION_DETECTED" || r === "DOC_ONLY_SOURCE");
  const until = act?.decision.cooling_off_until ?? null;
  const frame = blocked ? "border-cinnabar-600/60" : cooling ? "border-amber-600/60" : "border-line";

  return (
    <aside aria-label={t("title")} aria-live="polite" className={`rounded-2xl border bg-surface p-4 shadow-card sm:p-5 ${frame}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="chart" className="h-5 w-5 text-cta" />
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-jade-50 px-2.5 py-0.5 text-xs font-semibold text-jade-800"><span className="h-1.5 w-1.5 rounded-full bg-jade-600" />{t("llmMode")}: {tc.llm_mode}</span>
      </div>
      <p className="mt-1 text-xs text-ink-600">{t("sub")} · <code className="font-mono">{tc.trace_id}</code></p>

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

      <ol className="relative mt-5" aria-label={t("pipeline")}>
        {tc.steps.map((s, i) => {
          const isOpen = open === s.step;
          const last = i === tc.steps.length - 1;
          const lines = detailLines(s.detail);
          return (
            <li key={`${s.step}-${i}`} className="relative pb-5 pl-11 last:pb-0">
              {!last ? <span aria-hidden="true" className={`absolute bottom-0 left-[0.9rem] top-8 w-0.5 ${s.status === "ok" ? "bg-jade-600/40" : "bg-line-strong"}`} /> : null}
              <span aria-hidden="true" className={`absolute left-0 top-0 grid h-[1.875rem] w-[1.875rem] place-items-center rounded-full text-xs font-bold ${DOT[s.status]}`}>{s.status === "ok" ? <Icon name="check" className="h-4 w-4" strokeWidth={3} /> : s.status === "skipped" ? i + 1 : <Icon name="close" className="h-4 w-4" strokeWidth={3} />}</span>
              <div className={s.status === "blocked" || s.status === "rejected" ? "-mx-2 -mt-1 rounded-xl bg-cinnabar-50 px-2 py-1" : ""}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.step)} className="flex min-h-8 w-full items-center gap-2 rounded-md text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600" data-testid={`step-${s.step}`} data-status={s.status}>
                  <span className={`font-semibold ${s.status === "blocked" || s.status === "rejected" ? "text-cinnabar-700" : s.status === "skipped" ? "text-ink-600" : "text-ink"}`}>{i + 1}. {t(`steps.${s.step}`)}</span>
                  <span className="sr-only">{t(`status.${s.status}`)}</span>
                  {s.status === "blocked" ? <span className="rounded bg-cinnabar-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">{t(`status.${s.status}`)}</span> : null}
                  <span className="ml-auto font-mono text-xs text-ink-600">{s.duration_ms} ms</span>
                </button>
                <p className="mt-0.5 text-xs text-ink-600">{t(`desc.${s.step}`)}</p>
                {lines.length ? (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[11px] leading-5 text-ink-700">{isOpen ? JSON.stringify(s.detail, null, 2) : lines.slice(0, 4).join("\n")}{!isOpen && lines.length > 4 ? "\n…" : ""}</pre>
                ) : null}
                {s.step === "tools" && tc.tool_calls.length && isOpen ? (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">{t("toolCalls")}</caption>
                      <thead className="bg-sunken"><tr><th scope="col" className="px-2 py-1">{t("tool")}</th><th scope="col" className="px-2 py-1">{t("args")}</th><th scope="col" className="px-2 py-1">{t("output")}</th><th scope="col" className="px-2 py-1">{t("ok")}</th></tr></thead>
                      <tbody>{tc.tool_calls.map((c, j) => <tr key={j} className="border-t border-line align-top"><th scope="row" className="px-2 py-1 font-mono">{c.tool}</th><td className="px-2 py-1"><code className="break-all">{JSON.stringify(c.args)}</code></td><td className="px-2 py-1"><code className="break-all">{JSON.stringify(c.output)}</code></td><td className="px-2 py-1">{c.ok ? "✓" : "✕"}</td></tr>)}</tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 rounded-xl border border-line bg-sunken p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{t("finalTier")}</span><TierBadge tier={tc.tier} />
          <span className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-semibold">{t(`decision.${tc.decision}`)}</span>
        </div>
        {act && !blocked ? <div className="mt-2"><ReasonList reasons={act.decision.reasons} /></div> : null}
        {act && act.decision.required.length ? <div className="mt-2"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-600">{t("required")}</p><RequiredChips required={act.decision.required} /></div> : null}
        <p className={`mt-2 text-xs font-medium ${tc.reply_validated ? "text-jade-800" : "text-cinnabar-700"}`}>{tc.reply_validated ? `✓ ${t("validated")}` : `✕ ${t("notValidated")}`}</p>
        {tc.audit_seqs.length ? <p className="mt-1 text-xs text-ink-600">{t("auditSeqs")}: {tc.audit_seqs.map((n) => <Link key={n} href="/audit" className="mr-1 font-mono text-bridge-700 underline">#{n}</Link>)}</p> : null}
      </div>
    </aside>
  );
}
