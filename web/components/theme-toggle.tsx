"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "./nav-icons";

type Theme = "light" | "dark" | "system";
export const THEME_KEY = "setu-theme";

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Inline, pre-hydration script (no flash): sets .dark from localStorage / system. */
export const THEME_INIT = `try{var t=localStorage.getItem("${THEME_KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`;

/** Sun · switch · moon. Follows the OS until the user flips it. */
export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const t = useTranslations("nav");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY) as Theme | null;
    setDark(document.documentElement.classList.contains("dark"));
    if (stored && stored !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => { applyTheme("system"); setDark(mq.matches); };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const pick = (v: "light" | "dark") => { setDark(v === "dark"); localStorage.setItem(THEME_KEY, v); applyTheme(v); };
  const muted = onDark ? "text-white/70" : "text-ink-600";
  return (
    <div className="inline-flex items-center gap-1.5">
      <button type="button" data-testid="theme-light" aria-label={t("themeLight")} title={t("themeLight")} aria-pressed={!dark} onClick={() => pick("light")} className={`grid h-9 w-9 place-items-center rounded-lg ${muted} hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600`}><Icon name="sun" className="h-[18px] w-[18px]" /></button>
      <button type="button" role="switch" aria-checked={dark} aria-label={t("theme")} onClick={() => pick(dark ? "light" : "dark")} data-testid="theme-switch"
        className={`relative h-6 w-11 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 ${dark ? "bg-cta" : "bg-chrome"}`}>
        <span aria-hidden="true" className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${dark ? "left-[1.375rem]" : "left-0.5"}`} />
      </button>
      <button type="button" data-testid="theme-dark" aria-label={t("themeDark")} title={t("themeDark")} aria-pressed={dark} onClick={() => pick("dark")} className={`grid h-9 w-9 place-items-center rounded-lg ${muted} hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600`}><Icon name="moon" className="h-[18px] w-[18px]" /></button>
    </div>
  );
}
