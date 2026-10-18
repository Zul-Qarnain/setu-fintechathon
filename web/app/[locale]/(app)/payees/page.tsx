"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader, Card } from "@/components/page-header";
import { Banner } from "@/components/banner";
import { Countdown } from "@/components/countdown";
import { StatusBadge } from "@/components/status-badge";
import { useApiError } from "@/components/use-api-error";
import { useAuth } from "@/components/auth-provider";
import { button, input, label } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, timeRemaining } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import type { Payee } from "@/lib/types";

function PayeeRow({ p, canVerify, onVerify, busy }: { p: Payee; canVerify: boolean; onVerify: (id: string) => void; busy: boolean }) {
  const t = useTranslations("payees");
  const locale = useLocale();
  const now = useNow(1000);
  const cooling = !p.verified && p.cooling_off_until ? timeRemaining(p.cooling_off_until, now) : null;
  return (
    <Card as="li" className="space-y-2" aria-labelledby={`p-${p.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`p-${p.id}`} className="min-w-0 flex-1 font-semibold">{p.name}</h3>
        <StatusBadge status={p.verified ? "verified" : "unverified"} />
      </div>
      <dl className="grid items-baseline gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(6rem,auto)_minmax(10rem,1fr)_1fr]">
        <div><dt className="text-xs text-ink-600">{t("account")}</dt><dd><code>{p.account_masked}</code></dd></div>
        <div><dt className="text-xs text-ink-600">{t("token")}</dt><dd><code className="break-all text-xs">{p.account_token}</code></dd></div>
        <div><dt className="text-xs text-ink-600">{t("bank")}</dt><dd>{p.bank}</dd></div>
      </dl>
      <p className="text-xs text-ink-600">{p.verified && p.verified_at ? t("verifiedAt", { date: formatDate(p.verified_at, locale) }) : t("createdAt", { date: formatDate(p.created_at, locale) })}</p>
      {!p.verified && p.cooling_off_until ? (
        <Banner tone="warning">
          {cooling && !cooling.done ? <>{t("cooling")}: <Countdown until={p.cooling_off_until} /></> : t("coolingDone")}
        </Banner>
      ) : null}
      {!p.verified ? (
        canVerify ? <button type="button" className={button("jade")} disabled={busy} onClick={() => onVerify(p.id)}>{busy ? t("verifying") : t("verifyBtn")}</button>
          : <p className="text-sm font-medium text-amber-700">{t("needsApprover")}</p>
      ) : null}
    </Card>
  );
}

export default function PayeesPage() {
  const t = useTranslations("payees");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const [items, setItems] = useState<Payee[] | null>(null);
  const [name, setName] = useState("");
  const [acct, setAcct] = useState("");
  const [bank, setBank] = useState("Sandbox Bank of China (SYNTHETIC)");
  const [busy, setBusy] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [err, fail, clear] = useApiError();

  const load = useCallback(async () => { try { setItems(await api.payees()); } catch (e) { fail(e); } }, [fail]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault(); clear(); setOk(null); setBusy(true);
    try { await api.createPayee({ name: name.trim(), account_number: acct.replace(/\s/g, ""), bank: bank.trim(), source: "manual" }); setName(""); setAcct(""); setOk(t("added")); await load(); }
    catch (x) { fail(x); } finally { setBusy(false); }
  }
  async function verify(id: string) {
    clear(); setOk(null); setVerifyingId(id);
    try { await api.verifyPayee(id); setOk(t("verifyDone")); await load(); } catch (x) { fail(x); } finally { setVerifyingId(null); }
  }
  const canVerify = user?.role === "family_approver" || user?.role === "admin";

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div aria-live="polite" className="mb-4 space-y-2">
        {err ? <Banner tone="danger">{err}</Banner> : null}
        {ok ? <Banner tone="success">{ok}</Banner> : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-label={t("title")}>
          {items === null && !err ? <p role="status" className="text-ink-600">{tc("loading")}</p> : null}
          {items?.length === 0 ? <p className="rounded-lg border border-dashed border-line p-6 text-center text-ink-600">{t("empty")}</p> : null}
          <ul className="space-y-4">{items?.map((p) => <PayeeRow key={p.id} p={p} canVerify={canVerify} onVerify={(id) => void verify(id)} busy={verifyingId === p.id} />)}</ul>
          <p className="mt-3 text-xs text-ink-600">{t("syntheticNote")}</p>
        </section>
        {user?.role === "student" ? (
          <Card aria-labelledby="add-h" className="h-fit">
            <h2 id="add-h" className="text-lg font-semibold">{t("add")}</h2>
            <p className="mt-1 text-sm text-ink-600">{t("addHelp")}</p>
            <form onSubmit={(e) => void add(e)} className="mt-4 space-y-3">
              <div><label htmlFor="pn" className={label}>{t("name")}</label><input id="pn" className={input} value={name} onChange={(e) => setName(e.target.value)} required /></div>
              <div><label htmlFor="pa" className={label}>{t("accountNumber")}</label><input id="pa" inputMode="numeric" autoComplete="off" className={input} value={acct} onChange={(e) => setAcct(e.target.value)} required minLength={8} /></div>
              <div><label htmlFor="pb" className={label}>{t("bankName")}</label><input id="pb" className={input} value={bank} onChange={(e) => setBank(e.target.value)} required /></div>
              <button type="submit" disabled={busy || !name || acct.length < 8} className={`${button("primary")} w-full min-h-11`}>{busy ? t("adding") : t("addSubmit")}</button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
