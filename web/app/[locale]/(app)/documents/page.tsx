"use client";
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { PageHeader, Card } from "@/components/page-header";
import { Banner } from "@/components/banner";
import { StatusBadge } from "@/components/status-badge";
import { useApiError } from "@/components/use-api-error";
import { button, input, label } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatCny, formatDate, shortHash } from "@/lib/format";
import { Icon } from "@/components/nav-icons";
import { addSessionDoc, updateSessionDoc } from "@/lib/session-docs";
import { GROUPS, noticeGroup, type Group } from "@/lib/notice-group";
import type { ConfirmResponse, DemoNotice, DocumentOut } from "@/lib/types";

type Field = "payee" | "amount" | "due" | "reference";
const FIELDS: Field[] = ["payee", "amount", "due", "reference"];
const NONE: Record<Field, boolean> = { payee: false, amount: false, due: false, reference: false };

const FALLBACK_NOTICES: DemoNotice[] = [
  { id: "en_tuition_fallback.txt", label: "Spring tuition, EN (clean, SYNTHETIC)", text: "SYNTHETIC SAMPLE - Shenzhen Example University Finance Office\nSpring 2027 tuition: CNY 18,500.00. Due: 2027-03-01.\nPayee: Shenzhen Example University  Account: 6222 0000 0000 4821\nReference: 2027-SPRING-TUITION-0042" },
];

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const tc = useTranslations("common");
  const tr = useTranslations("reasons");
  const locale = useLocale();
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("pasted-notice.txt");
  const [notices, setNotices] = useState<DemoNotice[]>(FALLBACK_NOTICES);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<DocumentOut | null>(null);
  const [showText, setShowText] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, fail, clear] = useApiError();

  // confirm form
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [payee, setPayee] = useState("");
  const [account, setAccount] = useState("");
  const [showAcct, setShowAcct] = useState(false);
  const [reference, setReference] = useState("");
  const [fields, setFields] = useState<Record<Field, boolean>>(NONE);
  const allChecked = FIELDS.every((k) => fields[k]);
  const setAll = (v: boolean) => setFields({ payee: v, amount: v, due: v, reference: v });
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => { api.demoNotices().then((n) => { if (Array.isArray(n) && n.length) setNotices(n); }).catch(() => undefined); }, []);

  const grouped = useMemo(() => {
    const m = new Map<Group, DemoNotice[]>();
    for (const n of notices) { const g = noticeGroup(n); m.set(g, [...(m.get(g) ?? []), n]); }
    return GROUPS.filter((g) => m.has(g)).map((g) => [g, m.get(g) ?? []] as const);
  }, [notices]);

  function loadNotice(n: DemoNotice | undefined) {
    if (!n) return;
    setText(n.text); setFilename(n.id.endsWith(".txt") ? n.id : `${n.id}.txt`); reset();
  }
  function reset() { setDoc(null); setResult(null); setFields(NONE); setLocalErr(null); clear(); }
  const pick = (prefix: string) => notices.find((n) => n.id.startsWith(prefix));

  function acceptDoc(d: DocumentOut) {
    setDoc(d); setResult(null); setFields(NONE); setShowText(false);
    setAmount(d.parsed.amount_cny ?? ""); setDue(d.parsed.due_date ?? ""); setPayee(d.parsed.payee_name ?? ""); setReference(d.parsed.reference ?? ""); setAccount("");
    addSessionDoc({ id: d.id, filename: d.filename, status: d.status });
  }
  async function analyse(e?: FormEvent) {
    e?.preventDefault(); reset();
    if (!text.trim()) { setLocalErr(t("emptyText")); return; }
    setBusy(true);
    try { acceptDoc(await api.createDocument({ filename: filename || "pasted-notice.txt", text, synthetic: true })); } catch (x) { fail(x); } finally { setBusy(false); }
  }
  async function onFile(f: File | undefined) {
    if (!f) return; reset(); setBusy(true);
    try {
      setFilename(f.name);
      if (/\.pdf$/i.test(f.name)) acceptDoc(await api.uploadDocumentFile(f));
      else { const txt = await f.text(); setText(txt); acceptDoc(await api.uploadDocumentFile(f)); }
    } catch (x) { fail(x); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files?.[0]); };

  async function confirm(e: FormEvent) {
    e.preventDefault(); if (!doc) return; clear(); setConfirming(true);
    try {
      const r = await api.confirmDocument(doc.id, { amount_cny: amount.trim(), due_date: due, payee_name: payee.trim(), ...(account.trim() ? { account_number: account.replace(/\s/g, "") } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}) });
      setResult(r); setDoc(r.document); updateSessionDoc(doc.id, r.document.status);
    } catch (x) {
      if (x instanceof ApiError && x.code === "AMOUNT_MISMATCH") fail(x); else fail(x);
    } finally { setConfirming(false); }
  }

  const blocked = doc?.status === "blocked" || doc?.guardian.verdict === "blocked";
  const verdictTone = !doc ? "info" : doc.guardian.verdict === "blocked" ? "danger" : doc.guardian.verdict === "suspicious" ? "warning" : "success";

  const fieldRow = (k: Field, icon: string, lbl: string, control: React.ReactNode, help?: React.ReactNode) => (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:grid-cols-[2.25rem_6.5rem_minmax(0,1fr)_auto]">
      <span className="mt-1 grid h-9 w-9 place-items-center rounded-lg bg-bridge-50 text-bridge-600"><Icon name={icon} className="h-[18px] w-[18px]" /></span>
      <span className="mt-2.5 text-sm font-medium text-ink-700 max-sm:hidden" aria-hidden="true">{lbl}</span>
      <div className="min-w-0">{control}{help ? <p className="mt-1 text-xs text-ink-600">{help}</p> : null}</div>
      <label className="col-start-2 inline-flex min-h-10 items-center gap-2 text-sm text-ink-700 sm:col-start-auto"><input type="checkbox" className="h-[18px] w-[18px] rounded accent-cta" checked={fields[k]} onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.checked }))} disabled={blocked} aria-label={t("confirmField", { field: lbl })} />{t("confirmShort")}</label>
    </div>
  );

  return (
    <>
      <PageHeader icon={<Icon name="documents" />} title={t("title")} subtitle={t("subtitle")} />

      <Card aria-labelledby="in-h" className="p-4 sm:p-5">
        <h2 id="in-h" className="sr-only">{t("paste")}</h2>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <form onSubmit={(e) => void analyse(e)} className="space-y-4">
            <label
              htmlFor="file" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
              className={`grid min-h-48 cursor-pointer place-content-center justify-items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center focus-within:ring-2 focus-within:ring-bridge-600 ${drag ? "border-cta bg-bridge-50" : "border-bridge-600/40 bg-bridge-50/40"}`}
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-bridge-50 text-bridge-600"><Icon name="upload" className="h-8 w-8" /></span>
              <span className="text-lg font-semibold text-ink">{t("dropBig")}</span>
              <span className="text-sm text-ink-600">{t("dropSub")}</span>
              <span className="text-xs text-ink-600">{t("dropHint")}</span>
              <input id="file" ref={fileRef} type="file" accept=".txt,.pdf,text/plain,application/pdf" className="sr-only" aria-label={t("upload")} onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink-700">{t("sample")}:</span>
              <button type="button" className={button("ghost")} onClick={() => loadNotice(pick("en_tuition"))} data-testid="load-clean"><Icon name="file" className="h-4 w-4" />{t("loadClean")}</button>
              <button type="button" className={button("ghost")} onClick={() => loadNotice(pick("atk_injection_en"))} data-testid="load-injected"><Icon name="shieldAlert" className="h-4 w-4" />{t("loadInjected")}</button>
              <label htmlFor="sample" className="sr-only">{t("sample")}</label>
              <select id="sample" className={`${input} h-10 w-auto min-w-[11rem] flex-1 py-1.5`} value="" onChange={(e) => loadNotice(notices.find((n) => n.id === e.target.value))}>
                <option value="">{t("sampleSelect")}</option>
                {grouped.map(([g, list]) => <optgroup key={g} label={t(`groups.${g}`)}>{list.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</optgroup>)}
              </select>
            </div>
            <p className="-mt-2 text-xs text-ink-600">{t("sampleHint")}</p>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <div><label htmlFor="txt" className={label}>{t("pasteLabel")}</label><textarea id="txt" rows={5} className={`${input} font-mono text-xs`} value={text} onChange={(e) => { setText(e.target.value); }} placeholder={t("pastePlaceholder")} data-testid="notice-text" /></div>
              <div className="flex flex-col gap-3">
                <div><label htmlFor="fname" className={label}>{t("filename")}</label><input id="fname" className={input} value={filename} onChange={(e) => setFilename(e.target.value)} /></div>
                <button type="submit" disabled={busy} className={`${button("primary")} mt-auto w-full`} data-testid="analyse"><Icon name="search" className="h-4 w-4" />{busy ? t("analysing") : t("analyse")}</button>
              </div>
            </div>
            <div aria-live="polite" className="space-y-2">
              {err ? <Banner tone="danger">{err}</Banner> : null}
              {localErr ? <Banner tone="warning">{localErr}</Banner> : null}
            </div>
          </form>

          <ul className="space-y-3 rounded-2xl bg-sunken p-4">
            {([["extract", "documents", "blue"], ["scan", "shield", "green"], ["control", "lock", "violet"]] as const).map(([k, ic, tone]) => (
              <li key={k} className="flex gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${tone === "blue" ? "bg-bridge-50 text-bridge-600" : tone === "green" ? "bg-jade-50 text-jade-600" : "bg-violet-50 text-violet-600"}`}><Icon name={ic} className="h-5 w-5" /></span>
                <div className="text-sm"><p className="font-semibold text-ink">{t(`info.${k}.title`)}</p><p className="text-xs text-ink-600">{t(`info.${k}.body`)}</p></div>
              </li>
            ))}
            <li className="border-t border-line pt-3 text-xs text-ink-600">{tc("synthetic")} · {tc("sandbox")}</li>
          </ul>
        </div>
      </Card>

      <div aria-live="polite" className="mt-6 space-y-4">
        {doc ? (
          <Card aria-labelledby="res-h">
            <div className="flex flex-wrap items-start gap-3">
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${blocked ? "bg-cinnabar-50 text-cinnabar-600" : "bg-bridge-50 text-bridge-600"}`}><Icon name="file" className="h-6 w-6" /></span>
              <div className="min-w-0 flex-1">
                <h2 id="res-h" className="text-lg font-semibold text-ink"><span className="sr-only">{t("result")}: </span>{doc.filename}</h2>
                <p className="text-xs text-ink-600">{t("docHash")}: <code title={doc.doc_hash} className="font-mono">{shortHash(doc.doc_hash.replace("sha256:", ""), 10)}</code></p>
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-semibold ${blocked ? "bg-cinnabar-50 text-cinnabar-700" : doc.guardian.verdict === "suspicious" ? "bg-amber-50 text-amber-700" : "bg-jade-50 text-jade-800"}`}><Icon name={blocked ? "shieldAlert" : "shield"} className="h-4 w-4" />{t(`verdict.${blocked ? "blocked" : doc.guardian.verdict}`)}</span>
                <p className="mt-1"><StatusBadge status={doc.status} /></p>
              </div>
            </div>
            {blocked || doc.guardian.flags.length ? (
              <div className="mt-4">
                <Banner tone={verdictTone} title={`${t(`guardian.${doc.guardian.verdict}`)} (${t("guardian.score")} ${doc.guardian.score.toFixed(2)})`}>
                  {blocked ? <p className="font-medium" data-testid="doc-blocked">{t("blockedBody")}</p> : null}
                  {doc.guardian.flags.length ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {doc.guardian.flags.map((f) => <li key={f.code}><strong>{f.severity.toUpperCase()}</strong> {f.message} <code className="text-xs">{f.code}</code>{tr.has(f.code) ? <span className="sr-only"> — {tr(f.code)}</span> : null}</li>)}
                    </ul>
                  ) : null}
                </Banner>
              </div>
            ) : null}

            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <section aria-label={t("parsedCol")} className="rounded-2xl border border-line bg-sunken p-3">
                <p className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-ink-600"><span>{t("previewTitle")}</span><span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">{t("untrustedChip")}</span></p>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface p-4 font-mono text-xs leading-5 text-ink shadow-card" data-testid="doc-preview">{showText || text.length < 1200 ? text : text.slice(0, 1200) + "…"}</pre>
                <p className="mt-2 text-xs text-ink-600">{t("untrustedNote")}</p>
                {text.length >= 1200 ? <button type="button" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-bridge-700 underline" aria-expanded={showText} onClick={() => setShowText((v) => !v)}>{showText ? t("hideText") : t("showText")}</button> : null}
              </section>

              {!result ? (
                <form onSubmit={(e) => void confirm(e)} aria-labelledby="conf-h" className="space-y-3">
                  <div><h3 id="conf-h" className="text-base font-semibold text-ink">{t("confirmTitle")}</h3><p className="text-sm text-ink-600">{t("confirmHelp")}</p></div>
                  {fieldRow("payee", "building", t("payee"), <><label htmlFor="c-payee" className="sr-only">{t("payee")}</label><input id="c-payee" className={input} value={payee} onChange={(e) => setPayee(e.target.value)} disabled={blocked} required /></>, <>{t("parsed")}: {doc.parsed.payee_name ?? t("notFound")}</>)}
                  {fieldRow("amount", "database", t("amount"), <><label htmlFor="c-amt" className="sr-only">{t("amount")}</label><input id="c-amt" inputMode="decimal" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={blocked} aria-describedby="c-amt-h" required /></>, <span id="c-amt-h">{t("parsed")}: {doc.parsed.amount_cny ? formatCny(doc.parsed.amount_cny) : t("notFound")} · {t("mismatchHelp")}</span>)}
                  {fieldRow("due", "calendar", t("due"), <><label htmlFor="c-due" className="sr-only">{t("due")}</label><input id="c-due" type="date" className={input} value={due} onChange={(e) => setDue(e.target.value)} disabled={blocked} required /></>, <>{t("parsed")}: {doc.parsed.due_date ? formatDate(doc.parsed.due_date, locale) : t("notFound")}</>)}
                  {fieldRow("reference", "file", t("reference"), <><label htmlFor="c-ref" className="sr-only">{t("reference")}</label><input id="c-ref" className={input} value={reference} onChange={(e) => setReference(e.target.value)} disabled={blocked} /></>, <>{t("parsed")}: {doc.parsed.reference ?? t("notFound")}</>)}
                  <details className="rounded-xl border border-line p-3">
                    <summary className="flex min-h-8 cursor-pointer items-center text-sm font-medium text-ink-700">{t("account")} · <code className="ml-1">{doc.parsed.account_masked ?? t("notFound")}</code></summary>
                    <div className="mt-2 flex gap-2"><label htmlFor="c-acct" className="sr-only">{t("account")}</label><input id="c-acct" type={showAcct ? "text" : "password"} autoComplete="off" inputMode="numeric" className={input} value={account} onChange={(e) => setAccount(e.target.value)} disabled={blocked} aria-describedby="c-acct-h" placeholder={doc.parsed.account_masked ?? ""} /><button type="button" className={button("ghost")} onClick={() => setShowAcct((v) => !v)} aria-pressed={showAcct}>{showAcct ? t("hide") : t("show")}</button></div>
                    <p id="c-acct-h" className="mt-1 text-xs text-ink-600">{t("accountHint", { masked: doc.parsed.account_masked ?? "—" })}</p>
                  </details>
                  <div className="rounded-xl bg-bridge-50 p-3">
                    <label className="flex min-h-10 items-start gap-2 text-sm text-ink"><input type="checkbox" className="mt-0.5 h-[18px] w-[18px] rounded accent-cta" checked={allChecked} onChange={(e) => setAll(e.target.checked)} disabled={blocked} />{t("checked")}</label>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className={button("ghost")} onClick={() => { reset(); setText(""); }}>{t("discard")}</button>
                    <button type="submit" className={button("primary")} disabled={blocked || !allChecked || confirming} data-testid="confirm-doc">{confirming ? t("confirming") : t("confirm")}</button>
                  </div>
                </form>
              ) : result.blocked ? (
                <div role="alert" className="rounded-2xl border-2 border-cinnabar-600 bg-cinnabar-50 p-4 text-cinnabar-700" data-testid="confirm-blocked">
                  <p className="text-lg font-extrabold">⛔ {t("blockedConfirm", { seq: result.audit_seq })}</p>
                  <Link href="/audit" className="mt-2 inline-block font-semibold underline">{t("viewAudit")}</Link>
                </div>
              ) : (
                <Banner tone="success" title={t("confirmedTitle")}>
                  {result.obligation ? <p>{t("confirmedBody", { amount: result.obligation.amount_cny, date: formatDate(result.obligation.due_date, locale), payee: result.obligation.payee_name })}</p> : null}
                  <p className="mt-2 flex flex-wrap gap-3">
                    <Link href="/agent" className={button("primary")}>{t("planIt")}</Link>
                    <Link href="/audit" className="self-center font-semibold underline">{t("viewAudit")} (#{result.audit_seq})</Link>
                  </p>
                </Banner>
              )}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
