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

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const locale = useLocale();
  const [more, setMore] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  useEffect(() => { setMore(false); }, [pathname]);
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

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-ink focus:shadow-card">{t("common.skipToContent")}</a>

      {/* Desktop sidebar */}
      <aside className="hidden bg-chrome text-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="px-5 py-5"><Logo /></div>
          <nav aria-label={t("nav.main")} className="flex flex-col gap-1 px-3">
            {items.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined}
                className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${isActive(n.href) ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>
                <NavIcon name={n.key} />
                {t(`nav.${n.key}`)}
              </Link>
            ))}
          </nav>
          <p className="mt-auto p-4 text-xs leading-relaxed text-white/70">{t("common.footer")}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-700" role="note">
          {t("common.syntheticBanner")}{MOCK ? " · MOCK MODE (in-browser fixtures)" : ""}
        </div>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <span className="text-ink lg:hidden"><Logo /></span>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <LocaleToggle />
            <span className="hidden lg:block"><ThemeToggle /></span>
            <span className="hidden max-w-[14rem] truncate text-sm text-ink-600 xl:inline" title={t("nav.signedInAs", { email: user.email })}>{user.email}</span>
            <span className="hidden rounded-md border border-line bg-paper px-2 py-0.5 text-xs font-semibold text-ink-700 sm:inline">{t(`common.roles.${user.role}`)}</span>
            <button type="button" onClick={doLogout} className="hidden h-9 rounded-lg border border-line px-3 text-sm font-medium hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 lg:inline-flex lg:items-center">{t("nav.logout")}</button>
          </div>
        </header>
        <main id="main" tabIndex={-1} lang={locale} className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 focus:outline-none sm:px-6 lg:px-8 lg:pb-10">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav aria-label={t("nav.bottom")} className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {tabs.map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={isActive(n.href) ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bridge-600 ${isActive(n.href) ? "text-bridge-700" : "text-ink-600"}`}>
                <NavIcon name={n.key} className="h-[22px] w-[22px]" />
                <span className="max-w-full truncate px-1">{t(`nav.${n.key}`)}</span>
              </Link>
            </li>
          ))}
          <li>
            <button type="button" aria-expanded={more} aria-haspopup="dialog" onClick={() => setMore(true)} data-testid="nav-more"
              className={`flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bridge-600 ${moreActive ? "text-bridge-700" : "text-ink-600"}`}>
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
