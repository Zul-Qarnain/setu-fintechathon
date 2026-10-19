"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader, Card, CardHead } from "@/components/page-header";
import { Icon } from "@/components/nav-icons";
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
      <code title={value} className="whitespace-nowrap font-mono text-xs">{shortHash(value, 4)}</code>
      <button type="button" className="inline-flex min-h-9 items-center rounded px-2 text-xs text-bridge-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600" aria-label={`${t("copy")} ${value.slice(0, 8)}`} onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setOk(true); window.setTimeout(() => setOk(false), 1500); }); }}>{ok ? t("copied") : t("copy")}</button>
    </span>
  );
}

function summarise(p: Record<string, unknown>): string {
  return Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object").slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
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

  const sample = (entries ?? []).slice(0, 4);
  const actorKind = (a: string) => (/^(system|guardian|policy|executor|demo|server)/i.test(a) ? "system" : "user");

  return (
    <>
      <PageHeader icon={<Icon name="shield" />} title={t("title")} subtitle={t("subtitle")} />
      {err ? <Banner tone="danger" className="mb-4">{err}</Banner> : null}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <div aria-live="polite">
            {verify?.ok ? (
              <div role="status" className="flex flex-wrap items-center gap-4 rounded-2xl border border-jade-600/30 bg-jade-50 p-4 sm:p-5" data-testid="chain-ok">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-jade-700 text-white"><Icon name="check" className="h-7 w-7" strokeWidth={3} /></span>
                <div className="min-w-0 flex-1 text-jade-800"><p className="text-xl font-extrabold">{t("chainOk")} — {t("entriesOk", { n: verify.checked })}</p><p className="mt-0.5 text-sm text-ink-700">{t("okSub")}</p></div>
                <button type="button" className={button("jade")} onClick={() => void doVerify()} disabled={verifying} data-testid="verify-chain"><Icon name="refresh" className="h-4 w-4" />{verifying ? t("verifying") : t("verifyAgain")}</button>
              </div>
            ) : verify && !verify.ok ? (
              <div role="alert" className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-cinnabar-600 bg-cinnabar-50 p-4 text-cinnabar-700 sm:p-5" data-testid="chain-broken">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-cinnabar-600 text-white"><Icon name="close" className="h-7 w-7" strokeWidth={3} /></span>
                <div className="min-w-0 flex-1"><p className="text-xl font-extrabold">{t("chainBroken", { seq: verify.broken_at_seq ?? 0 })}</p><p className="mt-0.5 text-sm">{t("reason")}: {verify.reason ?? "—"} · {t("checked", { n: verify.checked })}</p><p className="mt-0.5 text-xs text-ink-700">{t("brokenHint")}</p></div>
                <button type="button" className={button("danger")} onClick={() => void doVerify()} disabled={verifying} data-testid="verify-chain"><Icon name="refresh" className="h-4 w-4" />{verifying ? t("verifying") : t("verifyAgain")}</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-bridge-50 text-bridge-600"><Icon name="link" className="h-7 w-7" /></span>
                <div className="min-w-0 flex-1"><p className="text-lg font-bold text-ink">{t("notVerified")}</p><p className="mt-0.5 text-sm text-ink-600">{t("notVerifiedSub")}</p></div>
                <button type="button" className={button("primary")} onClick={() => void doVerify()} disabled={verifying} data-testid="verify-chain"><Icon name="shield" className="h-4 w-4" />{verifying ? t("verifying") : t("verify")}</button>
              </div>
            )}
          </div>
      {/* Mobile: one card per entry (no horizontal scrolling) */}
      <ul className="space-y-3 sm:hidden" aria-label={t("title")}>
        {entries === null && !err ? <li className="text-center text-ink-600" role="status">{tc("loading")}</li> : null}
        {entries?.length === 0 ? <li className="text-center text-ink-600">{t("empty")}</li> : null}
        {entries?.map((e) => {
          const hit = broken === e.seq;
          const isOpen = open === e.seq;
          return (
            <li key={e.seq} className={`rounded-xl border bg-surface p-3 shadow-card ${hit ? "border-2 border-cinnabar-600 bg-cinnabar-50" : "border-line"}`} data-testid={`audit-card-${e.seq}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words font-semibold"><span className="font-mono text-ink-600">#{e.seq}</span> {e.event}</p>
                {hit ? <span className="shrink-0 text-xs font-bold text-cinnabar-700">⚠ {t("tamperedRow")}</span> : null}
              </div>
              <p className="mt-1 text-xs text-ink-600">{formatDateTime(e.ts, locale)} · <code>{e.actor}</code></p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <CopyHash value={e.hash} />
                <button type="button" aria-expanded={isOpen} aria-controls={`plm-${e.seq}`} onClick={() => setOpen(isOpen ? null : e.seq)} className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-bridge-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600">{isOpen ? t("hide") : t("details")}</button>
              </div>
              {isOpen ? (
                <dl id={`plm-${e.seq}`} className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
                  <dt className="text-ink-600">{t("payloadHash")}</dt><dd><code className="break-all">{e.payload_hash}</code></dd>
                  <dt className="text-ink-600">{t("prevHash")}</dt><dd><code className="break-all">{e.prev_hash}</code></dd>
                  <dt className="text-ink-600">{t("hash")}</dt><dd><code className="break-all">{e.hash}</code></dd>
                  <dt className="text-ink-600">{t("payload")}</dt><dd><pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(e.payload, null, 2)}</pre></dd>
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Card as="div" className="hidden p-0 sm:block sm:p-0"><div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">{t("title")}</caption>
          <thead className="text-xs text-ink-600">
            <tr className="border-b border-line"><th scope="col" className="px-4 py-3 font-semibold">{t("cols.seq")}</th><th scope="col" className="px-3 py-2">{t("cols.time")}</th><th scope="col" className="px-3 py-2">{t("cols.actor")}</th><th scope="col" className="px-3 py-2">{t("cols.event")}</th><th scope="col" className="hidden px-3 py-2 lg:table-cell">{t("cols.summary")}</th><th scope="col" className="px-3 py-2">{t("cols.hash")}</th><th scope="col" className="px-3 py-2"><span className="sr-only">{t("cols.details")}</span></th></tr>
          </thead>
          <tbody>
            {entries === null && !err ? <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-600" role="status">{tc("loading")}</td></tr> : null}
            {entries?.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-600">{t("empty")}</td></tr> : null}
            {entries?.map((e) => {
              const hit = broken === e.seq;
              const isOpen = open === e.seq;
              return (
                <Fragment key={e.seq}>
                  <tr className={`border-t border-line transition-colors hover:bg-sunken/60 ${hit ? "bg-cinnabar-50 outline outline-2 -outline-offset-2 outline-cinnabar-600" : ""}`} data-testid={`audit-row-${e.seq}`} aria-current={hit ? "true" : undefined}>
                    <th scope="row" className="relative px-4 py-3">
                      <span aria-hidden="true" className={`absolute left-[1.95rem] top-0 h-full w-0.5 ${hit ? "bg-cinnabar-600" : "bg-jade-600/40"}`} />
                      <span className={`relative z-10 grid h-7 min-w-7 place-items-center rounded-full border-2 px-1 font-mono text-xs font-bold ${hit ? "border-cinnabar-600 bg-cinnabar-50 text-cinnabar-700" : "border-jade-600 bg-surface text-jade-800"}`}>{e.seq}</span>
                      {hit ? <span className="mt-1 block font-sans text-[11px] font-bold text-cinnabar-700">⚠ {t("tamperedRow")}</span> : null}
                    </th>
                    <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-ink-700">{formatDateTime(e.ts, locale)}</td>
                    <td className="px-3 py-3"><span className={`inline-flex max-w-[10rem] items-center gap-1 truncate rounded-md px-2 py-1 text-xs font-medium ${actorKind(e.actor) === "system" ? "bg-sunken text-ink-700" : "bg-bridge-50 text-bridge-700"}`} title={e.actor}><Icon name={actorKind(e.actor) === "system" ? "settings" : "user"} className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{e.actor}</span></span></td>
                    <td className="px-3 py-3"><code className="rounded-md bg-sunken px-2 py-1 font-mono text-xs text-ink">{e.event}</code></td>
                    <td className="hidden max-w-[16rem] px-3 py-3 text-xs text-ink-600 lg:table-cell"><span className="line-clamp-2 break-words">{summarise(e.payload)}</span></td>
                    <td className="px-3 py-3"><CopyHash value={e.hash} /></td>
                    <td className="px-3 py-3 text-right"><button type="button" aria-expanded={isOpen} aria-controls={`pl-${e.seq}`} onClick={() => setOpen(isOpen ? null : e.seq)} aria-label={isOpen ? t("hide") : t("details")} className="grid h-9 w-9 place-items-center rounded-lg text-ink-600 hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600"><Icon name="chevron" className={`h-4 w-4 transition ${isOpen ? "rotate-90" : ""}`} /></button></td>
                  </tr>
                  {isOpen ? (
                    <tr id={`pl-${e.seq}`} className="bg-sunken/60"><td colSpan={7} className="px-3 py-3">
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
      </div></Card>
      {entries && broken !== null && !entries.some((e) => e.seq === broken) ? <Banner tone="warning" className="mt-3">{t("hiddenBreak", { seq: broken })}</Banner> : null}

        </div>

        <aside className="space-y-4">
          <Card aria-labelledby="ex-h">
            <CardHead id="ex-h" icon={<Icon name="file" />} title={t("exportTitle")} />
            <p className="mt-3 text-sm text-ink-600">{t("exportBody")}</p>
            <button type="button" className={`${button("primary")} mt-4 w-full`} onClick={() => void exportEvidence()}><Icon name="download" className="h-4 w-4" />{t("export")}</button>
          </Card>
          <Card aria-labelledby="how-h">
            <CardHead id="how-h" icon={<Icon name="info" />} title={t("howTitle")} />
            <p className="mt-3 text-sm text-ink-600">{t("howBody")}</p>
            {sample.length ? (
              <ol className="mt-3 space-y-0">
                {sample.map((e, i) => (
                  <li key={e.seq}>
                    {i > 0 ? <div aria-hidden="true" className="ml-6 h-4 w-px bg-bridge-600/50" /> : null}
                    <div className="flex gap-3 rounded-xl border border-bridge-600/15 bg-bridge-50/70 p-3">
                      <Icon name={i === 0 ? "file" : "link"} className="mt-0.5 h-5 w-5 shrink-0 text-bridge-600" />
                      <dl className="min-w-0 font-mono text-[11px] leading-5 text-ink-700">
                        <dt className="font-sans text-xs font-semibold text-ink">{t("block", { seq: e.seq })}</dt>
                        <dd className="truncate">{t("data")}: {e.event}</dd>
                        {i > 0 ? <dd className="truncate">{t("prev")}: {shortHash(e.prev_hash, 4)}</dd> : null}
                        <dd className="truncate">{t("hashShort")}: {shortHash(e.hash, 4)}</dd>
                      </dl>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="mt-3 flex gap-2 rounded-xl border border-jade-600/30 bg-jade-50 p-3 text-xs text-jade-800"><Icon name="shield" className="h-4 w-4 shrink-0" /><p><strong className="block">{t("tamperTitle")}</strong>{t("tamperBody")}</p></div>
          </Card>
      <details className="rounded-2xl border border-dashed border-line-strong bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600">{t("demo.title")}</summary>
        <p className="mt-2 text-xs text-ink-600">{t("demo.body")}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label htmlFor="tseq" className={label}>{t("demo.seq")}</label><input id="tseq" inputMode="numeric" value={tamperSeq} onChange={(e) => setTamperSeq(e.target.value.replace(/\D/g, ""))} className={`${input} w-28`} /></div>
          <button type="button" className={button("danger")} onClick={() => void tamper()} disabled={!tamperSeq} data-testid="tamper">{t("demo.tamper")}</button>
        </div>
        <p role="status" className="mt-2 text-sm">{demoMsg}</p>
      </details>
        </aside>
      </div>
    </>
  );
}
