"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader, Card } from "@/components/page-header";
import { Banner } from "@/components/banner";
import { useApiError } from "@/components/use-api-error";
import { button, input, label } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, shortHash } from "@/lib/format";
import type { AuditEntry, AuditVerify } from "@/lib/types";

function CopyHash({ value }: { value: string }) {
  const t = useTranslations("common");
  const [ok, setOk] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <code title={value} className="text-xs">{shortHash(value, 8)}</code>
      <button type="button" className="rounded px-1 text-xs text-bridge-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600" aria-label={`${t("copy")} ${value.slice(0, 8)}`} onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setOk(true); window.setTimeout(() => setOk(false), 1500); }); }}>{ok ? t("copied") : t("copy")}</button>
    </span>
  );
}

export default function AuditPage() {
  const t = useTranslations("audit");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [verify, setVerify] = useState<AuditVerify | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [err, fail, clear] = useApiError();
  const [tamperSeq, setTamperSeq] = useState("2");
  const [demoMsg, setDemoMsg] = useState<string | null>(null);

  const load = useCallback(async () => { clear(); try { const r = await api.audit(false); setEntries(r.entries); } catch (e) { fail(e); } }, [fail, clear]);
  useEffect(() => { void load(); }, [load]);

  async function doVerify() {
    clear(); setVerifying(true);
    try { const r = await api.audit(true); setEntries(r.entries); setVerify(r.verify); } catch (e) { fail(e); } finally { setVerifying(false); }
  }
  async function exportEvidence() {
    try {
      const data = await api.evidenceExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "audit_export.json"; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { fail(e); }
  }
  async function tamper() {
    setDemoMsg(null);
    try { await api.demoTamperAudit(Number(tamperSeq)); setDemoMsg(t("demo.done", { seq: tamperSeq })); setVerify(null); await load(); }
    catch (e) { setDemoMsg(e instanceof ApiError && (e.status === 404 || e.status === 403) ? t("demo.unavailable") : String(e instanceof Error ? e.message : e)); }
  }

  const broken = verify && !verify.ok ? verify.broken_at_seq : null;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={<>
        <button type="button" className={button("primary")} onClick={() => void doVerify()} disabled={verifying} data-testid="verify-chain">{verifying ? t("verifying") : t("verify")}</button>
        <button type="button" className={button("ghost")} onClick={() => void exportEvidence()}>{t("export")}</button>
      </>} />
      {err ? <Banner tone="danger" className="mb-4">{err}</Banner> : null}
      <div aria-live="polite" className="mb-4">
        {verify?.ok ? (
          <div role="status" className="rounded-xl border-2 border-jade-600 bg-jade-50 p-4 text-jade-800" data-testid="chain-ok">
            <p className="text-xl font-extrabold"><span aria-hidden="true">✓ </span>{t("chainOk")}</p>
            <p className="mt-1 text-sm">{t("checked", { n: verify.checked })}</p>
          </div>
        ) : null}
        {verify && !verify.ok ? (
          <div role="alert" className="rounded-xl border-2 border-cinnabar-600 bg-cinnabar-50 p-4 text-cinnabar-700" data-testid="chain-broken">
            <p className="text-xl font-extrabold"><span aria-hidden="true">✕ </span>{t("chainBroken", { seq: verify.broken_at_seq ?? 0 })}</p>
            <p className="mt-1 text-sm">{t("reason")}: {verify.reason ?? "—"} · {t("checked", { n: verify.checked })}</p>
            <p className="mt-1 text-xs text-ink-700">{t("brokenHint")}</p>
          </div>
        ) : null}
      </div>

      <Card as="div" className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">{t("title")}</caption>
          <thead className="bg-paper text-xs uppercase tracking-wide text-ink-600">
            <tr><th scope="col" className="px-3 py-2">{t("cols.seq")}</th><th scope="col" className="px-3 py-2">{t("cols.time")}</th><th scope="col" className="px-3 py-2">{t("cols.actor")}</th><th scope="col" className="px-3 py-2">{t("cols.event")}</th><th scope="col" className="px-3 py-2">{t("cols.hash")}</th><th scope="col" className="px-3 py-2"><span className="sr-only">{t("cols.details")}</span></th></tr>
          </thead>
          <tbody>
            {entries === null && !err ? <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-600" role="status">{tc("loading")}</td></tr> : null}
            {entries?.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-600">{t("empty")}</td></tr> : null}
            {entries?.map((e) => {
              const hit = broken === e.seq;
              const isOpen = open === e.seq;
              return (
                <Fragment key={e.seq}>
                  <tr className={`border-t border-line ${hit ? "bg-cinnabar-50 outline outline-2 -outline-offset-2 outline-cinnabar-600" : ""}`} data-testid={`audit-row-${e.seq}`} aria-current={hit ? "true" : undefined}>
                    <th scope="row" className="px-3 py-2 font-mono">{e.seq}{hit ? <span className="ml-1 font-sans text-xs font-bold text-cinnabar-700">⚠ {t("tamperedRow")}</span> : null}</th>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDateTime(e.ts, locale)}</td>
                    <td className="px-3 py-2"><code className="text-xs">{e.actor}</code></td>
                    <td className="px-3 py-2 font-medium">{e.event}</td>
                    <td className="px-3 py-2"><CopyHash value={e.hash} /></td>
                    <td className="px-3 py-2 text-right"><button type="button" aria-expanded={isOpen} aria-controls={`pl-${e.seq}`} onClick={() => setOpen(isOpen ? null : e.seq)} className="text-xs font-semibold text-bridge-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600">{isOpen ? t("hide") : t("details")}</button></td>
                  </tr>
                  {isOpen ? (
                    <tr id={`pl-${e.seq}`} className="bg-paper"><td colSpan={6} className="px-3 py-3">
                      <dl className="grid gap-1 text-xs sm:grid-cols-[8rem_1fr]">
                        <dt className="text-ink-600">{t("payloadHash")}</dt><dd><code className="break-all">{e.payload_hash}</code></dd>
                        <dt className="text-ink-600">{t("prevHash")}</dt><dd><code className="break-all">{e.prev_hash}</code></dd>
                        <dt className="text-ink-600">{t("hash")}</dt><dd><code className="break-all">{e.hash}</code></dd>
                        <dt className="text-ink-600">{t("payload")}</dt><dd><pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(e.payload, null, 2)}</pre></dd>
                      </dl>
                    </td></tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
      {entries && broken !== null && !entries.some((e) => e.seq === broken) ? <Banner tone="warning" className="mt-3">{t("hiddenBreak", { seq: broken })}</Banner> : null}

      <details className="mt-6 rounded-xl border border-dashed border-line bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600">{t("demo.title")}</summary>
        <p className="mt-2 text-xs text-ink-600">{t("demo.body")}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label htmlFor="tseq" className={label}>{t("demo.seq")}</label><input id="tseq" inputMode="numeric" value={tamperSeq} onChange={(e) => setTamperSeq(e.target.value.replace(/\D/g, ""))} className={`${input} w-28`} /></div>
          <button type="button" className={button("danger")} onClick={() => void tamper()} disabled={!tamperSeq} data-testid="tamper">{t("demo.tamper")}</button>
        </div>
        <p role="status" className="mt-2 text-sm">{demoMsg}</p>
      </details>
    </>
  );
}
