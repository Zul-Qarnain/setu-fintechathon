"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { AuthLayout } from "@/components/auth-layout";
import { useAuth } from "@/components/auth-provider";
import { Banner } from "@/components/banner";
import { useApiError } from "@/components/use-api-error";
import { button, input, label } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Persona } from "@/lib/types";

// Synthetic personas from docs/API.md (used only if GET /demo/personas is unavailable).
const FALLBACK: Persona[] = [
  { email: "aisha@demo.setu.test", password: "demo-password-123", role: "student", name: "Aisha (BD, MSc, Shenzhen)" },
  { email: "father.rahman@demo.setu.test", password: "demo-password-123", role: "family_approver", name: "Aisha's father" },
  { email: "rafi@demo.setu.test", password: "demo-password-123", role: "student", name: "Rafi (BD, PhD)" },
];

export default function LoginPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const { login, user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>(FALLBACK);
  const [err, fail, clear] = useApiError();

  useEffect(() => { if (!loading && user) router.replace("/"); }, [loading, user, router]);
  useEffect(() => {
    api.demoPersonas().then((p) => { if (Array.isArray(p) && p.length) setPersonas(p.filter((x) => x.role !== "admin")); }).catch(() => undefined);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    clear();
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace("/");
    } catch (x) {
      if (x instanceof ApiError && x.status === 401) fail(new ApiError(401, "UNAUTHORIZED", t("login.invalid")));
      else fail(x);
    } finally { setBusy(false); }
  }

  return (
    <AuthLayout
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      aside={<><p className="text-2xl font-bold">{t("tagline")}</p><ul className="mt-6 space-y-3 text-white/85">{(["pitch1", "pitch2", "pitch3"] as const).map((k) => <li key={k} className="flex gap-2"><span aria-hidden="true" className="text-amber-100">◆</span>{t(k)}</li>)}</ul></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {err ? <Banner tone="danger">{err}</Banner> : null}
        <div><label htmlFor="email" className={label}>{t("login.email")}</label><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} /></div>
        <div><label htmlFor="password" className={label}>{t("login.password")}</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} /></div>
        <button type="submit" disabled={busy || !email || !password} className={`${button("primary")} w-full`}>{busy ? t("login.submitting") : t("login.submit")}</button>
        <p className="text-sm text-ink-600">{t("login.noAccount")} <Link href="/register" className="font-semibold text-bridge-700 underline">{t("login.register")}</Link></p>
      </form>
      <section aria-labelledby="demo-h" className="mt-8 rounded-xl border border-dashed border-line bg-white p-4">
        <h2 id="demo-h" className="text-sm font-semibold">{t("login.demoTitle")}</h2>
        <p className="mt-1 text-xs text-ink-600">{t("login.demoHint")}</p>
        <ul className="mt-3 grid gap-2">
          {personas.map((p) => (
            <li key={p.email}>
              <button type="button" className={`${button("ghost")} w-full justify-between text-left`} onClick={() => { setEmail(p.email); setPassword(p.password); }}>
                <span>{t("login.fill", { name: p.name })}</span>
                <span className="rounded bg-paper px-1.5 py-0.5 text-xs">{tc(`roles.${p.role}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </AuthLayout>
  );
}
