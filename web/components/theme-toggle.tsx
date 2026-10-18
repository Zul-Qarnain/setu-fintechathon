"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Theme = "light" | "dark" | "system";
export const THEME_KEY = "setu-theme";

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Inline, pre-hydration script (no flash): sets .dark from localStorage / system. */
export const THEME_INIT = `try{var t=localStorage.getItem("${THEME_KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`;

const ICON: Record<Theme, string> = { light: "☀", dark: "☾", system: "◐" };

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("nav");
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => { setTheme((localStorage.getItem(THEME_KEY) as Theme | null) ?? "system"); }, []);
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
  const pick = (v: Theme) => { setTheme(v); localStorage.setItem(THEME_KEY, v); applyTheme(v); };
  const names: Record<Theme, string> = { light: t("themeLight"), dark: t("themeDark"), system: t("themeSystem") };
  return (
    <div role="group" aria-label={t("theme")} className="inline-flex overflow-hidden rounded-lg border border-line bg-surface">
      {(["light", "dark", "system"] as Theme[]).map((v) => (
        <button
          key={v}
          type="button"
          data-testid={`theme-${v}`}
          aria-pressed={theme === v}
          aria-label={names[v]}
          title={names[v]}
          onClick={() => pick(v)}
          className={`flex h-9 items-center justify-center gap-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 ${compact ? "w-9" : "px-3"} ${theme === v ? "bg-primary text-white" : "text-ink hover:bg-sunken"}`}
        >
          <span aria-hidden="true">{ICON[v]}</span>
          {compact ? null : <span>{names[v]}</span>}
        </button>
      ))}
    </div>
  );
}
