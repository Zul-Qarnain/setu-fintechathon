"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { useAuth } from "./auth-provider";
import { Logo } from "./logo";
import { LocaleToggle } from "./locale-toggle";
import { ThemeToggle } from "./theme-toggle";
import { NavIcon } from "./nav-icons";
import { MOCK } from "@/lib/config";
import type { Role } from "@/lib/types";

type Href = "/" | "/agent" | "/documents" | "/payees" | "/approvals" | "/audit" | "/settings";
interface NavItem { href: Href; key: string; roles: Role[] }
const ALL: Role[] = ["student", "family_approver", "admin"];
const NAV: NavItem[] = [
  { href: "/", key: "dashboard", roles: ALL },
  { href: "/agent", key: "agent", roles: ["student", "admin"] },
  { href: "/documents", key: "documents", roles: ["student", "admin"] },
  { href: "/payees", key: "payees", roles: ALL },
  { href: "/approvals", key: "approvals", roles: ALL },
  { href: "/audit", key: "audit", roles: ALL },
  { href: "/settings", key: "settings", roles: ALL },
];
/** Bottom tab bar (< lg): the four most-used pages; everything else lives under "More". */
const TABS: Href[] = ["/", "/agent", "/approvals", "/audit"];

/** Decorative line-art skyline (Shanghai towers + temple roof), purely ornamental. */
function Skyline() {
  return (
    <svg viewBox="0 0 200 80" aria-hidden="true" focusable="false" className="absolute inset-x-0 bottom-0 h-20 w-full text-sky-300/60">
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M0 78h200" />
        <path d="M14 78V58h22v20M10 58h30l-4-6H14zM16 52l9-8 9 8M25 44v-4" />
        <path d="M58 78V40h8v38M62 40V26M55 50h14M55 62h14" />
        <path d="M84 78V30l5-6 5 6v48M89 24V12M86 40h6M86 54h6" />
        <circle cx="89" cy="36" r="3" />
        <path d="M108 78V46h10v32M113 46V36M122 78V54h12v24M140 78V34l4-4 4 4v44M144 30V20" />
        <path d="M160 78V60h28v18M156 60h36l-5-7h-26zM163 53l11-9 11 9M174 44v-5" />
      </g>
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
  const [more, setMore] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  useEffect(() => { setMore(false); setMenu(false); }, [pathname]);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [more]);

  if (loading || !user) {
    return <div className="grid min-h-screen place-items-center text-ink-600" role="status">{t("common.loading")}</div>;
  }
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const tabs = items.filter((n) => TABS.includes(n.href));
  const rest = items.filter((n) => !TABS.includes(n.href));
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const moreActive = rest.some((n) => isActive(n.href));
  const doLogout = () => { logout(); router.replace("/login"); };

  const initial = (user.email[0] ?? "?").toUpperCase();
  const account = (
    <div className="relative">
      <button type="button" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-haspopup="menu" aria-label={t("nav.account")} data-testid="account-menu"
        className="flex h-11 items-center gap-2.5 rounded-xl px-1.5 text-left hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-chrome text-sm font-semibold text-white dark:bg-cta">{initial}</span>
        <span className="hidden min-w-0 leading-tight xl:block">
          <span className="block max-w-[13rem] truncate text-sm font-semibold text-ink" title={t("nav.signedInAs", { email: user.email })}>{user.email}</span>
          <span className="block text-xs text-ink-600">{t(`common.roles.${user.role}`)}</span>
        </span>
        <span className="hidden text-ink-600 sm:block"><NavIcon name="chevronDown" className="h-4 w-4" /></span>
      </button>
      {menu ? <button type="button" tabIndex={-1} aria-hidden="true" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenu(false)} /> : null}
      {menu ? (
        <div role="menu" className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-line bg-surface p-2 shadow-card">
          <p className="truncate px-3 py-2 text-xs text-ink-600">{t("nav.signedInAs", { email: user.email })} · {t(`common.roles.${user.role}`)}</p>
          <Link role="menuitem" href="/settings" className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-ink hover:bg-sunken"><NavIcon name="settings" className="h-4 w-4" />{t("nav.settings")}</Link>
          <button role="menuitem" type="button" onClick={doLogout} className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-cinnabar-700 hover:bg-cinnabar-50">{t("nav.logout")}</button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-ink focus:shadow-card">{t("common.skipToContent")}</a>

      {/* Desktop sidebar */}
      <aside className="bg-sidebar hidden text-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="px-5 pb-6 pt-6"><Logo tagline={t("nav.tagline")} /></div>
          <nav aria-label={t("nav.main")} className="flex flex-col gap-1.5 px-3">
            {items.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined}
                className={`flex h-11 items-center gap-3 rounded-xl px-3.5 text-[15px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${isActive(n.href) ? "bg-cta text-white shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>
                <NavIcon name={n.key} />
                {t(`nav.${n.key}`)}
              </Link>
            ))}
          </nav>
          <div className="mt-auto p-4">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 pb-20">
              <p className="relative z-10 text-sm leading-snug text-white/90">{t("nav.sideNote")}</p>
              <Skyline />
            </div>
            <p className="mt-3 px-1 text-[11px] leading-relaxed text-white/60">{t("common.footer")}</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Mobile top bar */}
        <div className="bg-sidebar flex h-16 items-center gap-2 px-4 text-white lg:hidden">
          <Logo />
          <div className="ml-auto flex items-center gap-1"><LocaleToggle dark /></div>
        </div>
        <div className="flex items-center gap-2 border-b border-amber-600/30 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700 sm:px-6 lg:px-8" role="note">
          <NavIcon name="info" className="h-4 w-4 shrink-0" />
          <span>{t("common.syntheticBanner")}{MOCK ? " · MOCK MODE (in-browser fixtures)" : ""}</span>
        </div>
        <header className="sticky top-0 z-30 hidden h-16 items-center gap-3 border-b border-line bg-surface/95 px-6 backdrop-blur lg:flex lg:px-8">
          <div className="ml-auto flex items-center gap-3">
            <LocaleToggle />
            <span aria-hidden="true" className="h-6 w-px bg-line" />
            <ThemeToggle />
            <span aria-hidden="true" className="h-6 w-px bg-line" />
            {account}
          </div>
        </header>
        <main id="main" tabIndex={-1} lang={locale} className="mx-auto w-full max-w-[84rem] flex-1 px-4 pb-28 pt-6 focus:outline-none sm:px-6 lg:px-8 lg:pb-10">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav aria-label={t("nav.bottom")} className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {tabs.map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={isActive(n.href) ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bridge-600 ${isActive(n.href) ? "text-cta" : "text-ink-600"}`}>
                <NavIcon name={n.key} className="h-[22px] w-[22px]" strokeWidth={isActive(n.href) ? 2.2 : 1.75} />
                <span className="max-w-full truncate px-1">{t(`nav.${n.key}`)}</span>
              </Link>
            </li>
          ))}
          <li>
            <button type="button" aria-expanded={more} aria-haspopup="dialog" onClick={() => setMore(true)} data-testid="nav-more"
              className={`flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bridge-600 ${moreActive ? "text-cta" : "text-ink-600"}`}>
              <NavIcon name="more" className="h-[22px] w-[22px]" />
              <span>{t("nav.more")}</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* "More" bottom sheet */}
      {more ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.moreMenu")}>
          <button type="button" aria-label={t("nav.closeMenu")} className="absolute inset-0 bg-black/50" onClick={() => setMore(false)} />
          <div className="pb-safe absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface p-4 shadow-xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />
            <ul className="space-y-1">
              {rest.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} aria-current={isActive(n.href) ? "page" : undefined}
                    className={`flex h-12 items-center gap-3 rounded-lg px-3 text-base font-medium ${isActive(n.href) ? "bg-bridge-50 text-bridge-700" : "text-ink hover:bg-sunken"}`}>
                    <NavIcon name={n.key} />{t(`nav.${n.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
              <ThemeToggle />
              <button type="button" onClick={doLogout} className="h-11 rounded-lg border border-line px-4 text-sm font-medium text-ink hover:bg-sunken">{t("nav.logout")}</button>
            </div>
            <p className="mt-3 truncate text-xs text-ink-600">{t("nav.signedInAs", { email: user.email })} · {t(`common.roles.${user.role}`)}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
