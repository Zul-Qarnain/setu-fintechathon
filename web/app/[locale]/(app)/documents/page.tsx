"use client";
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { PageHeader, Card } from "@/components/page-header";
import { Banner } from "@/components/banner";
import { Cny } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { useApiError } from "@/components/use-api-error";
import { button, input, label } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate, shortHash } from "@/lib/format";
import { addSessionDoc, updateSessionDoc } from "@/lib/session-docs";
import { GROUPS, noticeGroup, type Group } from "@/lib/notice-group";
import type { ConfirmResponse, DemoNotice, DocumentOut } from "@/lib/types";

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
  const [checked, setChecked] = useState(false);
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
  function reset() { setDoc(null); setResult(null); setChecked(false); setLocalErr(null); clear(); }
  const pick = (prefix: string) => notices.find((n) => n.id.startsWith(prefix));

  function acceptDoc(d: DocumentOut) {
    setDoc(d); setResult(null); setChecked(false); setShowText(false);
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

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="in-h">
          <h2 id="in-h" className="text-lg font-semibold">{t("paste")}</h2>
          <form onSubmit={(e) => void analyse(e)} className="mt-3 space-y-4">
            <div>
              <label htmlFor="sample" className={label}>{t("sample")}</label>
              <select id="sample" className={input} value="" onChange={(e) => loadNotice(notices.find((n) => n.id === e.target.value))}>
                <option value="">{t("sampleSelect")}</option>
                {grouped.map(([g, list]) => <optgroup key={g} label={t(`groups.${g}`)}>{list.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</optgroup>)}
              </select>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={button("ghost")} onClick={() => loadNotice(pick("en_tuition"))} data-testid="load-clean">{t("loadClean")}</button>
                <button type="button" className={button("ghost")} onClick={() => loadNotice(pick("atk_injection_en"))} data-testid="load-injected">{t("loadInjected")}</button>
              </div>
              <p className="mt-1 text-xs text-ink-600">{t("sampleHint")}</p>
            </div>
            <div><label htmlFor="fname" className={label}>{t("filename")}</label><input id="fname" className={input} value={filename} onChange={(e) => setFilename(e.target.value)} /></div>
            <div><label htmlFor="txt" className={label}>{t("pasteLabel")}</label><textarea id="txt" rows={9} className={`${input} font-mono`} value={text} onChange={(e) => { setText(e.target.value); }} placeholder={t("pastePlaceholder")} data-testid="notice-text" /></div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
              className={`rounded-xl border-2 border-dashed p-4 text-center text-sm ${drag ? "border-bridge-600 bg-bridge-50" : "border-line bg-paper"}`}
            >
              <button type="button" onClick={() => fileRef.current?.click()} className="font-semibold text-bridge-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600">{t("dropTitle")}</button>
              <p className="mt-1 text-xs text-ink-600">{t("dropHint")}</p>
              <input ref={fileRef} type="file" accept=".txt,.pdf,text/plain,application/pdf" className="sr-only" aria-label={t("upload")} onChange={(e) => void onFile(e.target.files?.[0])} />
            </div>
            <button type="submit" disabled={busy} className={button("primary")} data-testid="analyse">{busy ? t("analysing") : t("analyse")}</button>
          </form>
          <div aria-live="polite" className="mt-3 space-y-2">
            {err ? <Banner tone="danger">{err}</Banner> : null}
            {localErr ? <Banner tone="warning">{localErr}</Banner> : null}
          </div>
        </Card>

        <div className="space-y-6" aria-live="polite">
          {doc ? (
            <Card aria-labelledby="res-h">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="res-h" className="text-lg font-semibold">{t("result")}</h2>
                <StatusBadge status={doc.status} />
              </div>
              <div className="mt-3">
                <Banner tone={verdictTone} title={`${t(`guardian.${doc.guardian.verdict}`)} (${t("guardian.score")} ${doc.guardian.score.toFixed(2)})`}>
                  {blocked ? <p className="font-medium" data-testid="doc-blocked">{t("blockedBody")}</p> : null}
                  {doc.guardian.flags.length ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {doc.guardian.flags.map((f) => <li key={f.code}><strong>{f.severity.toUpperCase()}</strong> {f.message} <code className="text-xs">{f.code}</code>{tr.has(f.code) ? <span className="sr-only"> — {tr(f.code)}</span> : null}</li>)}
                    </ul>
                  ) : null}
                </Banner>
              </div>
              <p className="mt-3 text-xs text-ink-600">{t("docHash")}: <code title={doc.doc_hash}>{shortHash(doc.doc_hash.replace("sha256:", ""), 12)}</code></p>
              <p className="mt-1 text-xs text-ink-600">{t("untrustedNote")}</p>
              <button type="button" className="mt-2 text-sm font-semibold text-bridge-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600" aria-expanded={showText} onClick={() => setShowText((v) => !v)}>{showText ? t("hideText") : t("showText")}</button>
              {showText ? <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 font-mono text-xs">{text}</pre> : null}
            </Card>
          ) : null}

          {doc && !result ? (
            <Card aria-labelledby="conf-h">
              <h2 id="conf-h" className="text-lg font-semibold">{t("confirmTitle")}</h2>
              <p className="mt-1 text-sm text-ink-600">{t("confirmHelp")}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <section aria-label={t("parsedCol")} className="rounded-lg border border-line bg-paper p-3 text-sm">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-600">{t("parsedCol")}</h3>
                  <dl className="space-y-1">
                    <div><dt className="text-xs text-ink-600">{t("amount")}</dt><dd>{doc.parsed.amount_cny ? <Cny value={doc.parsed.amount_cny} /> : t("notFound")}</dd></div>
                    <div><dt className="text-xs text-ink-600">{t("due")}</dt><dd>{doc.parsed.due_date ? formatDate(doc.parsed.due_date, locale) : t("notFound")}</dd></div>
                    <div><dt className="text-xs text-ink-600">{t("payee")}</dt><dd className="break-words">{doc.parsed.payee_name ?? t("notFound")}</dd></div>
                    <div><dt className="text-xs text-ink-600">{t("account")}</dt><dd><code>{doc.parsed.account_masked ?? t("notFound")}</code></dd></div>
                    <div><dt className="text-xs text-ink-600">{t("reference")}</dt><dd className="break-words">{doc.parsed.reference ?? t("notFound")}</dd></div>
                  </dl>
                </section>
                <form onSubmit={(e) => void confirm(e)} aria-label={t("confirmCol")} className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-600">{t("confirmCol")}</h3>
                  <div><label htmlFor="c-amt" className={label}>{t("amount")}</label><input id="c-amt" inputMode="decimal" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={blocked} aria-describedby="c-amt-h" required /><p id="c-amt-h" className="mt-1 text-xs text-ink-600">{t("mismatchHelp")}</p></div>
                  <div><label htmlFor="c-due" className={label}>{t("due")}</label><input id="c-due" type="date" className={input} value={due} onChange={(e) => setDue(e.target.value)} disabled={blocked} required /></div>
                  <div><label htmlFor="c-payee" className={label}>{t("payee")}</label><input id="c-payee" className={input} value={payee} onChange={(e) => setPayee(e.target.value)} disabled={blocked} required /></div>
                  <div>
                    <label htmlFor="c-acct" className={label}>{t("account")}</label>
                    <div className="flex gap-2"><input id="c-acct" type={showAcct ? "text" : "password"} autoComplete="off" inputMode="numeric" className={input} value={account} onChange={(e) => setAccount(e.target.value)} disabled={blocked} aria-describedby="c-acct-h" placeholder={doc.parsed.account_masked ?? ""} /><button type="button" className={button("ghost")} onClick={() => setShowAcct((v) => !v)} aria-pressed={showAcct}>{showAcct ? t("hide") : t("show")}</button></div>
                    <p id="c-acct-h" className="mt-1 text-xs text-ink-600">{t("accountHint", { masked: doc.parsed.account_masked ?? "—" })}</p>
                  </div>
                  <div><label htmlFor="c-ref" className={label}>{t("reference")}</label><input id="c-ref" className={input} value={reference} onChange={(e) => setReference(e.target.value)} disabled={blocked} /></div>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-jade-700" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={blocked} />{t("checked")}</label>
                  <button type="submit" className={button("jade")} disabled={blocked || !checked || confirming} data-testid="confirm-doc">{confirming ? t("confirming") : t("confirm")}</button>
                </form>
              </div>
            </Card>
          ) : null}

          {result ? (
            result.blocked ? (
              <div role="alert" className="rounded-xl border-2 border-cinnabar-600 bg-cinnabar-50 p-4 text-cinnabar-700" data-testid="confirm-blocked">
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
            )
          ) : null}
          {!doc ? <p className="text-sm text-ink-600">{tc("synthetic")} · {tc("sandbox")}</p> : null}
        </div>
      </div>
    </>
  );
}
