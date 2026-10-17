"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { PageHeader, Card } from "@/components/page-header";
import { Banner } from "@/components/banner";
import { LocaleToggle } from "@/components/locale-toggle";
import { TotpInput } from "@/components/totp-input";
import { useApiError } from "@/components/use-api-error";
import { useAuth } from "@/components/auth-provider";
import { button, input, label } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { MOCK } from "@/lib/config";
import { getFastCooling, setFastCooling } from "@/lib/mock/db";
import { useRouter } from "@/i18n/routing";
import type { TotpSetup } from "@/lib/types";

const CONSENT_KEY = "setu.consent";
type Consent = { sensitive: boolean; crossBorder: boolean; llm: boolean };

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { user, refresh, logout } = useAuth();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [alreadyEnabled, setAlreadyEnabled] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, fail, clear] = useApiError();
  const [consent, setConsent] = useState<Consent>({ sensitive: false, crossBorder: false, llm: false });
  const [consentSaved, setConsentSaved] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const [fast, setFast] = useState("");

  useEffect(() => {
    try { const raw = window.localStorage.getItem(CONSENT_KEY); if (raw) setConsent(JSON.parse(raw) as Consent); } catch { /* ignore */ }
    if (MOCK) setFast(String(getFastCooling() ?? ""));
  }, []);
  function setC(k: keyof Consent, v: boolean) {
    const n = { ...consent, [k]: v }; setConsent(n); window.localStorage.setItem(CONSENT_KEY, JSON.stringify(n)); setConsentSaved(true);
  }

  async function start() {
    clear(); setBusy(true);
    try { setSetup(await api.totpSetup()); }
    catch (e) { if (e instanceof ApiError && (e.code === "TOTP_ALREADY_ENABLED" || e.status === 409)) setAlreadyEnabled(true); else fail(e); }
    finally { setBusy(false); }
  }
  async function verify(e: FormEvent) {
    e.preventDefault(); clear(); setBusy(true);
    try { const r = await api.totpVerify(code); if (r.verified) { setDone(true); setSetup(null); await refresh(); } } catch (x) { fail(x); } finally { setBusy(false); }
  }
  async function erase() {
    clear();
    try { await api.eraseMe(); logout(); router.replace("/login"); } catch (e) { fail(e); }
  }
  async function exportEv() {
    try {
      const blob = new Blob([JSON.stringify(await api.evidenceExport(), null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "audit_export.json"; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { fail(e); }
  }

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Banner tone="info" className="mb-4">{t("notice")}</Banner>
      <div aria-live="polite" className="mb-4">{err ? <Banner tone="danger">{err}</Banner> : null}</div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="totp-h">
          <h2 id="totp-h" className="text-lg font-semibold">{t("totp.title")}</h2>
          <p className="mt-2 text-sm">{user?.totp_enabled || done ? <span className="font-medium text-jade-800">✓ {t("totp.enabled")}</span> : t("totp.notEnabled")}</p>
          {alreadyEnabled ? <Banner tone="info" className="mt-3">{t("totp.alreadyEnabled")}</Banner> : null}
          {done ? <Banner tone="success" className="mt-3">{t("totp.success")}</Banner> : null}
          {!setup && !done && !alreadyEnabled ? <button type="button" className={`${button("primary")} mt-3`} disabled={busy} onClick={() => void start()} data-testid="totp-start">{busy ? t("totp.starting") : t("totp.start")}</button> : null}
          {setup ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm">{t("totp.scan")}</p>
              <div className="inline-block rounded-lg border border-line bg-white p-3" role="img" aria-label={t("totp.qrAlt")}><QRCodeSVG value={setup.otpauth_uri} size={176} /></div>
              <div>
                <p className="text-xs font-semibold text-ink-600">{t("totp.orSecret")}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-paper px-2 py-1 font-mono text-sm">{showSecret ? setup.secret : "•".repeat(setup.secret.length)}</code>
                  <button type="button" className={button("ghost")} onClick={() => setShowSecret((v) => !v)} aria-pressed={showSecret}>{showSecret ? tc("hide") : tc("show")}</button>
                  <button type="button" className={button("ghost")} onClick={() => { void navigator.clipboard?.writeText(setup.secret).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}>{copied ? tc("copied") : tc("copy")}</button>
                </div>
              </div>
              <form onSubmit={(e) => void verify(e)} className="space-y-3">
                <TotpInput value={code} onChange={setCode} label={t("totp.code")} />
                <button type="submit" className={button("jade")} disabled={busy || code.length !== 6}>{busy ? t("totp.verifying") : t("totp.verify")}</button>
              </form>
            </div>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card aria-labelledby="lang-h">
            <h2 id="lang-h" className="text-lg font-semibold">{t("language.title")}</h2>
            <div className="mt-3"><LocaleToggle /></div>
            <p className="mt-2 text-sm text-ink-600" lang={locale}>{t("language.help")}</p>
          </Card>

          <Card aria-labelledby="consent-h">
            <h2 id="consent-h" className="text-lg font-semibold">{t("consent.title")}</h2>
            <p className="mt-1 text-sm text-ink-600">{t("consent.help")}</p>
            <div className="mt-3 space-y-3">
              {(["sensitive", "crossBorder", "llm"] as const).map((k) => (
                <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-jade-700" checked={consent[k]} onChange={(e) => setC(k, e.target.checked)} />{t(`consent.${k}`)}</label>
              ))}
            </div>
            <p role="status" className="mt-2 text-xs text-jade-800">{consentSaved ? t("consent.saved") : ""}</p>
          </Card>

          <Card aria-labelledby="data-h">
            <h2 id="data-h" className="text-lg font-semibold">{t("data.title")}</h2>
            <div className="mt-3 space-y-4">
              <div><button type="button" className={button("ghost")} onClick={() => void exportEv()}>{t("data.export")}</button><p className="mt-1 text-xs text-ink-600">{t("data.exportHelp")}</p></div>
              <div>
                <button type="button" className={button("danger")} onClick={() => setConfirmErase(true)}>{t("data.erase")}</button>
                <p className="mt-1 text-xs text-ink-600">{t("data.eraseHelp")}</p>
              </div>
            </div>
          </Card>

          {MOCK ? (
            <Card aria-labelledby="demo-h">
              <h2 id="demo-h" className="text-lg font-semibold">{t("demo.title")}</h2>
              <p className="mt-1 text-sm text-ink-600">{t("demo.help")}</p>
              <div className="mt-3 flex items-end gap-2">
                <div><label htmlFor="fast" className={label}>{t("demo.seconds")}</label><input id="fast" inputMode="numeric" className={`${input} w-32`} value={fast} onChange={(e) => setFast(e.target.value.replace(/\D/g, ""))} /></div>
                <button type="button" className={button("ghost")} onClick={() => setFastCooling(Number(fast) || null)}>{t("demo.set")}</button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {confirmErase ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="alertdialog" aria-modal="true" aria-labelledby="er-t" aria-describedby="er-d">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 id="er-t" className="text-lg font-bold">{t("data.eraseConfirmTitle")}</h2>
            <p id="er-d" className="mt-2 text-sm">{t("data.eraseConfirmBody")}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" autoFocus className={button("ghost")} onClick={() => setConfirmErase(false)}>{tc("cancel")}</button>
              <button type="button" className={button("danger")} onClick={() => void erase()}>{t("data.eraseConfirm")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
