"use client";
import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { AuthLayout } from "@/components/auth-layout";
import { Banner } from "@/components/banner";
import { useApiError } from "@/components/use-api-error";
import { button, input, label } from "@/components/ui";
import { api } from "@/lib/api";
import type { Role } from "@/lib/types";

export default function RegisterPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [approver, setApprover] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, fail, clear] = useApiError();

  async function submit(e: FormEvent) {
    e.preventDefault();
    clear();
    setBusy(true);
    try {
      await api.register({ email: email.trim(), password, role, locale, ...(role === "student" && approver.trim() ? { approver_email: approver.trim() } : {}) });
      setDone(true);
      window.setTimeout(() => router.replace("/login"), 1200);
    } catch (x) { fail(x); } finally { setBusy(false); }
  }
  return (
    <AuthLayout title={t("register.title")} subtitle={t("register.subtitle")} aside={<p className="text-2xl font-bold">{t("tagline")}</p>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {err ? <Banner tone="danger">{err}</Banner> : null}
        {done ? <Banner tone="success">{t("register.created")}</Banner> : null}
        <div><label htmlFor="email" className={label}>{t("register.email")}</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} /></div>
        <div><label htmlFor="password" className={label}>{t("register.password")}</label><input id="password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} className={input} /></div>
        <fieldset>
          <legend className={label}>{t("register.role")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["student", "family_approver"] as const).map((r) => (
              <label key={r} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-bridge-600 ${role === r ? "border-jade-600 bg-jade-50" : "border-line bg-white"}`}>
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="accent-jade-700" />
                {t(`register.${r}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {role === "student" ? (
          <div><label htmlFor="appr" className={label}>{t("register.approverEmail")}</label><input id="appr" type="email" value={approver} onChange={(e) => setApprover(e.target.value)} aria-describedby="appr-h" className={input} /><p id="appr-h" className="mt-1 text-xs text-ink-600">{t("register.approverHint")}</p></div>
        ) : null}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 accent-jade-700" />{t("register.consent")}</label>
        <button type="submit" disabled={busy || !agree || !email || password.length < 10} className={`${button("primary")} w-full`}>{busy ? t("register.submitting") : t("register.submit")}</button>
        <p className="text-sm text-ink-600">{t("register.haveAccount")} <Link href="/login" className="font-semibold text-bridge-700 underline">{t("register.login")}</Link></p>
      </form>
    </AuthLayout>
  );
}
