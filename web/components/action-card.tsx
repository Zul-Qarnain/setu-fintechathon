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

  const border = a.tier === "T4" ? "border-cinnabar-600/60" : a.status === "cooling_off" ? "border-amber-600/60" : "border-line";
  const idp = `act-${a.id}`;
  return (
    <article aria-labelledby={`${idp}-t`} className={`rounded-xl border-2 bg-surface p-4 shadow-card ${border}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${idp}-t`} className="font-semibold">{t(`type.${a.type}`)}{amount ? <> · <Cny value={amount} /></> : null}</h3>
        <TierBadge tier={a.tier} />
        <StatusBadge status={a.status} />
        <span className="ml-auto text-xs text-ink-500">{formatDateTime(a.created_at, locale)}</span>
      </div>
      {studentLabel ? <p className="mt-1 text-sm text-ink-700">{t("onBehalf", { name: studentLabel })}</p> : null}
      {payee ? <p className="mt-1 text-sm text-ink-700">{tc("payee")}: <strong>{payee}</strong>{typeof a.params.account_masked === "string" ? <> · <code>{a.params.account_masked}</code></> : null}</p> : null}
      {amount && !compact ? <p className="text-xs text-ink-600">≈ <Bdt value={mul(amount, "17.2")} /> <span className="font-semibold text-amber-700">({tc("sampleRate")})</span></p> : null}
      {!compact ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-600">{t("why")}</p><ReasonList reasons={a.decision.reasons} />{locale === "en" ? <p className="mt-1 text-xs text-ink-600">{a.decision.explanation}</p> : null}</div>
          <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-600">{t("required")}</p><RequiredChips required={allRequired.length ? allRequired : a.decision.required} done={doneKinds} />
            {a.approvals.length ? <ul className="mt-2 space-y-0.5 text-xs text-ink-700">{a.approvals.map((x, i) => <li key={i}>✓ {t("approvedBy", { role: tc(`roles.${x.role}`), when: formatDateTime(x.at, locale) })}</li>)}</ul> : <p className="mt-2 text-xs text-ink-600">{t("noApprovals")}</p>}
          </div>
        </div>
      ) : null}

      {a.status === "blocked" ? <Banner tone="danger" title={t("blockedTitle")} className="mt-3">{t("blockedBody")}</Banner> : null}
      {a.status === "cooling_off" && a.decision.cooling_off_until ? (
        <Banner tone="warning" title={t("coolingTitle")} className="mt-3">
          <p>{t("coolingBody")}</p>
          <p className="mt-1">{t("coolingEnds")}: <Countdown until={a.decision.cooling_off_until} /> <span className="text-xs">({formatDateTime(a.decision.cooling_off_until, locale)})</span></p>
        </Banner>
      ) : null}
      {a.status === "executed" && a.result ? (
        <Banner tone="success" title={t("executedTitle")} className="mt-3">
          <p>{t("sandboxResult", { txn: String(a.result.bank_txn_id ?? "—"), state: String(a.result.state ?? "—") })}</p>
        </Banner>
      ) : null}
      {a.status === "rejected" ? <Banner tone="info" className="mt-3">{t("rejectedMsg")}</Banner> : null}

      {canAct ? (
        <div className="mt-4 border-t border-line pt-3">
          {alreadyMine ? <p className="text-sm font-medium text-jade-800">✓ {t("youApproved")}</p> : (
            <div className="flex flex-wrap items-end gap-3 [&>button]:min-h-11 max-sm:[&>button]:flex-1">
              <TotpInput value={code} onChange={setCode} label={t(myKind === "family_approver" ? "totpFamily" : "totpStudent")} hint={coolingActive ? t("coolingBlock") : undefined} id={`${idp}-totp`} />
              <button type="button" className={button("jade")} disabled={busy || code.length !== 6 || coolingActive} onClick={() => void approve()}>{busy ? tc("loading") : t("approve")}</button>
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
