"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { useAuth } from "./auth-provider";
import { Logo } from "./logo";
import { LocaleToggle } from "./locale-toggle";
import { MOCK } from "@/lib/config";
import type { Role } from "@/lib/types";

interface NavItem { href: "/" | "/agent" | "/documents" | "/payees" | "/approvals" | "/audit" | "/settings"; key: string; roles: Role[]; icon: string }
const ALL: Role[] = ["student", "family_approver", "admin"];
const NAV: NavItem[] = [
  { href: "/", key: "dashboard", roles: ALL, icon: "▦" },
  { href: "/agent", key: "agent", roles: ["student", "admin"], icon: "✦" },
  { href: "/documents", key: "documents", roles: ["student", "admin"], icon: "▤" },
  { href: "/payees", key: "payees", roles: ALL, icon: "⇄" },
  { href: "/approvals", key: "approvals", roles: ALL, icon: "✔" },
  { href: "/audit", key: "audit", roles: ALL, icon: "⛓" },
  { href: "/settings", key: "settings", roles: ALL, icon: "⚙" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (loading || !user) {
    return <div className="grid min-h-screen place-items-center text-ink-600" role="status">{t("common.loading")}</div>;
  }
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const nav = (
    <nav aria-label={t("nav.main")} className="flex flex-col gap-1 p-3">
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={isActive(n.href) ? "page" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${isActive(n.href) ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
        >
          <span aria-hidden="true" className="w-5 text-center">{n.icon}</span>
          {t(`nav.${n.key}`)}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-ink focus:shadow-card">{t("common.skipToContent")}</a>
      <aside className="hidden bg-ink text-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="px-5 py-5 text-white"><Logo /></div>
          {nav}
          <p className="mt-auto p-4 text-xs leading-relaxed text-white/70">{t("common.footer")}</p>
        </div>
      </aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
          <button type="button" aria-label={t("nav.closeMenu")} className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64 bg-ink text-white shadow-xl">
            <div className="flex items-center justify-between px-5 py-4"><Logo /><button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label={t("nav.closeMenu")}>✕</button></div>
            {nav}
          </div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col">
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-700" role="note">
          {t("common.syntheticBanner")}{MOCK ? " · MOCK MODE (in-browser fixtures)" : ""}
        </div>
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-2.5">
          <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600" aria-expanded={open} onClick={() => setOpen(true)}>☰ {t("nav.menu")}</button>
          <span className="text-ink lg:hidden"><Logo /></span>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <LocaleToggle />
            <span className="hidden text-sm text-ink-600 sm:inline" title={t("nav.signedInAs", { email: user.email })}>{user.email}</span>
            <span className="rounded-md border border-line bg-paper px-2 py-0.5 text-xs font-semibold text-ink-700">{t(`common.roles.${user.role}`)}</span>
            <button type="button" onClick={() => { logout(); router.replace("/login"); }} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600">{t("nav.logout")}</button>
          </div>
        </header>
        <main id="main" tabIndex={-1} lang={locale} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
