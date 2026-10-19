"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Banner } from "./banner";
import { Cny, Bdt } from "./money";
import { Countdown } from "./countdown";
import { StatusBadge } from "./status-badge";
import { TierBadge } from "./tier-badge";
import { TotpInput } from "./totp-input";
import { useApiError } from "./use-api-error";
import { useAuth } from "./auth-provider";
import { button, input } from "./ui";
import { Icon } from "./nav-icons";
import { api, ApiError } from "@/lib/api";
import { mul } from "@/lib/decimal";
import { formatDateTime } from "@/lib/format";
import type { ActionOut } from "@/lib/types";

export function ReasonList({ reasons }: { reasons: string[] }) {
  const t = useTranslations("reasons");
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm">
      {reasons.map((r) => <li key={r}>{t.has(r) ? t(r) : t("unknown", { code: r })} <code className="text-xs text-ink-500">{r}</code></li>)}
    </ul>
  );
}

export function RequiredChips({ required, done }: { required: string[]; done?: string[] }) {
  const t = useTranslations("common.required");
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="required checks">
      {required.map((r) => {
        const ok = done?.includes(r);
        return <li key={r} className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${ok ? "border-jade-600/40 bg-jade-50 text-jade-800" : "border-amber-600/50 bg-amber-50 text-amber-700"}`}><span aria-hidden="true">{ok ? "✓ " : "○ "}</span>{t.has(r) ? t(r) : r}</li>;
      })}
    </ul>
  );
}

const OPEN = ["awaiting_approval", "cooling_off"];

/** Reusable action card: shows decision, required checks, approvals and (if permitted) TOTP + approve/reject. */
export function ActionCard({ action, onChange, studentLabel, compact = false }: { action: ActionOut; onChange?: (a: ActionOut) => void; studentLabel?: string; compact?: boolean }) {
  const t = useTranslations("approvals");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { user } = useAuth();
  const [a, setA] = useState(action);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [err, fail, clear] = useApiError();
  const [done, setDone] = useState<string | null>(null);

  const amount = typeof a.params.amount_cny === "string" ? a.params.amount_cny : null;
  const payee = typeof a.params.payee_name === "string" ? a.params.payee_name : null;
  const open = OPEN.includes(a.status);
  const coolingActive = !!a.decision.cooling_off_until && Date.parse(a.decision.cooling_off_until) > Date.now() && (a.decision.required.includes("cooling_off") || a.status === "cooling_off");
  const doneKinds = a.approvals.map((x) => x.kind);
  const allRequired = Array.from(new Set([...doneKinds, ...a.decision.required]));
  const canAct = open && !!user && user.role !== "admin";
  const myKind = user?.role === "family_approver" ? "family_approver" : "totp";
  const alreadyMine = a.approvals.some((x) => x.approver_id === user?.id);

  async function fillDemo() {
    if (!user) return;
    clear();
    try {
      // Demo codes rotate within seconds, so fetch and submit in one step.
      const c = (await api.demoTotp(user.email)).code;
      setCode(c);
      await approve(c);
    } catch (e) { if (e instanceof ApiError && e.status === 404) fail(new ApiError(404, "NOT_FOUND", t("demoUnavailable"))); else fail(e); }
  }
  async function approve(override?: string) {
    clear(); setBusy(true);
    try {
      const r = await api.approve(a.id, override ?? code);
      setA(r); setCode(""); onChange?.(r);
      setDone(r.status === "executed" ? t("executedMsg") : t("recordedMsg"));
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function reject() {
    clear(); setBusy(true);
    try { const r = await api.reject(a.id, reason || "rejected"); setA(r); setRejecting(false); onChange?.(r); setDone(t("rejectedMsg")); } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const border = a.tier === "T4" || a.status === "blocked" ? "border-cinnabar-600/50" : a.status === "cooling_off" ? "border-amber-600/50" : a.tier === "T3" && open ? "border-amber-600/40" : "border-line";
  const idp = `act-${a.id}`;
  const needsFamily = allRequired.includes("family_approver");
  const totpDone = doneKinds.includes("totp");
  const famDone = doneKinds.includes("family_approver");
  const at = (k: string) => a.approvals.find((x) => x.kind === k)?.at;
  const pill = open ? (needsFamily ? t("pillFamily") : allRequired.includes("totp") ? t("pillTotp") : null) : null;
  return (
    <article aria-labelledby={`${idp}-t`} className={`rounded-2xl border bg-surface p-4 shadow-card sm:p-5 ${border} ${a.tier === "T3" && open ? "bg-amber-50/30" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${idp}-t`} className="text-base font-semibold text-ink">{t(`type.${a.type}`)}</h3>
        <TierBadge tier={a.tier} />
        <StatusBadge status={a.status} />
        {pill ? <span className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${needsFamily ? "bg-amber-50 text-amber-700" : "bg-jade-50 text-jade-800"}`}><Icon name="shield" className="h-3.5 w-3.5" />{pill}</span> : null}
      </div>
      <p className="mt-1 text-xs text-ink-600">{formatDateTime(a.created_at, locale)}</p>
      {studentLabel ? <p className="mt-1 text-sm text-ink-700">{t("onBehalf", { name: studentLabel })}</p> : null}

      {payee || amount ? (
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          {payee ? (
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bridge-50 text-bridge-600"><Icon name="building" /></span>
              <div className="min-w-0"><p className="truncate font-semibold text-ink"><span className="sr-only">{tc("payee")}: </span>{payee}</p>{typeof a.params.account_masked === "string" ? <p className="text-xs text-ink-600"><code>{a.params.account_masked}</code></p> : null}</div>
            </div>
          ) : null}
          {amount ? (
            <div className={`grid gap-2 sm:grid-cols-2 ${payee ? "mt-3" : ""}`}>
              <div className="rounded-lg bg-sunken p-3"><p className="text-xs text-ink-600">{t("amountCny")}</p><Cny value={amount} sans className="text-2xl font-bold text-ink" /></div>
              {!compact ? <div className="rounded-lg bg-sunken p-3"><p className="text-xs text-ink-600">{t("equivBdt")}</p><Bdt value={mul(amount, "17.2")} sans className="text-lg font-semibold text-ink" /><p className="text-[11px] font-semibold text-amber-700">1 CNY = 17.2 BDT · {tc("sampleRate")}</p></div> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {needsFamily && !compact && a.status !== "blocked" ? (
        <ol className="mt-3 grid gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2" aria-label={t("steps")}>
          {[{ k: "totp", done: totpDone, title: t("step1"), who: tc("roles.student") }, { k: "family_approver", done: famDone, title: t("step2"), who: tc("roles.family_approver") }].map((st, i) => (
            <li key={st.k} className="flex items-start gap-3">
              <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${st.done ? "bg-jade-700 text-white" : i === 1 && totpDone ? "border-2 border-amber-600 bg-amber-50 text-amber-700" : "border-2 border-line-strong text-ink-600"}`}>{st.done ? <Icon name="check" className="h-4 w-4" strokeWidth={3} /> : i + 1}</span>
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-ink">{st.title}</p>
                <p className={st.done ? "text-jade-800" : "text-amber-700"}>{st.done ? t("stepDone") : t("stepWaiting")}</p>
                {st.done && at(st.k) ? <p className="text-xs text-ink-600">{formatDateTime(at(st.k)!, locale)}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {coolingActive && a.decision.cooling_off_until ? (
        <p className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-xl bg-cinnabar-50 px-3 py-2 text-sm text-cinnabar-700"><Icon name="clock" className="h-4 w-4" />{t("coolingEnds")}: <Countdown until={a.decision.cooling_off_until} /> <span className="text-xs">({formatDateTime(a.decision.cooling_off_until, locale)})</span></p>
      ) : null}

      {!compact ? (
        <details className="group mt-3 rounded-xl border border-line bg-sunken/60 p-3 text-sm">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 font-semibold text-ink"><Icon name="chevron" className="h-4 w-4 transition group-open:rotate-90" />{t("why")} · {t("required")}</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div><ReasonList reasons={a.decision.reasons} />{locale === "en" ? <p className="mt-1 text-xs text-ink-600">{a.decision.explanation}</p> : null}</div>
            <div><RequiredChips required={allRequired.length ? allRequired : a.decision.required} done={doneKinds} />
              {a.approvals.length ? <ul className="mt-2 space-y-0.5 text-xs text-ink-700">{a.approvals.map((x, i) => <li key={i}>✓ {t("approvedBy", { role: tc(`roles.${x.role}`), when: formatDateTime(x.at, locale) })}</li>)}</ul> : <p className="mt-2 text-xs text-ink-600">{t("noApprovals")}</p>}
            </div>
          </div>
        </details>
      ) : null}

      {a.status === "blocked" ? <Banner tone="danger" title={t("blockedTitle")} className="mt-3">{t("blockedBody")}</Banner> : null}
      {a.status === "cooling_off" ? <Banner tone="warning" title={t("coolingTitle")} className="mt-3">{t("coolingBody")}</Banner> : null}
      {a.status === "executed" && a.result ? (
        <Banner tone="success" title={t("executedTitle")} className="mt-3">
          <p>{t("sandboxResult", { txn: String(a.result.bank_txn_id ?? "—"), state: String(a.result.state ?? "—") })}</p>
        </Banner>
      ) : null}
      {a.status === "rejected" ? <Banner tone="info" className="mt-3">{t("rejectedMsg")}</Banner> : null}

      {canAct ? (
        <div className="mt-4 border-t border-line pt-4">
          {alreadyMine ? <p className="text-sm font-medium text-jade-800">✓ {t("youApproved")}</p> : (
            <div className="flex flex-wrap items-end gap-3 [&>button]:min-h-12 max-sm:[&>button]:flex-1">
              <TotpInput value={code} onChange={setCode} label={t(myKind === "family_approver" ? "totpFamily" : "totpStudent")} hint={coolingActive ? t("coolingBlock") : undefined} id={`${idp}-totp`} />
              <button type="button" className={`${button("jade")} px-6`} disabled={busy || code.length !== 6 || coolingActive} onClick={() => void approve()}><Icon name="lock" className="h-4 w-4" />{busy ? tc("loading") : t("approve")}</button>
              <button type="button" className={button("ghost")} disabled={busy} onClick={() => setRejecting((v) => !v)} aria-expanded={rejecting}>{t("reject")}</button>
              <button type="button" className="inline-flex min-h-9 items-center rounded px-1 text-xs font-medium text-bridge-700 underline" onClick={() => void fillDemo()}>{t("demoFill")}</button>
            </div>
          )}
          {rejecting ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[14rem] flex-1"><label htmlFor={`${idp}-why`} className="mb-1 block text-sm font-medium text-ink-700">{t("rejectReason")}</label><input id={`${idp}-why`} className={input} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              <button type="button" className={button("danger")} disabled={busy} onClick={() => void reject()}>{t("confirmReject")}</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div aria-live="polite" className="mt-2 space-y-2">
        {err ? <Banner tone="danger">{err}</Banner> : null}
        {done ? <Banner tone="success">{done}</Banner> : null}
      </div>
      {a.status === "awaiting_approval" && user?.role === "student" && a.decision.required.includes("family_approver") && alreadyMine ? <p className="mt-2 text-sm text-ink-700">{t("waitingFamily")} <Link href="/approvals" className="font-semibold text-bridge-700 underline">{t("openApprovals")}</Link></p> : null}
    </article>
  );
}
