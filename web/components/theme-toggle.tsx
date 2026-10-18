"use client";

import { useState, useEffect } from "react";
import { useLocale } from "next-intl";

type Theme = "light" | "dark" | "system";

const THEME_KEY = "setu-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);
  const locale = useLocale();

  useEffect(() => {
    // Check for saved theme or system preference
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    if (saved) {
      setTheme(saved);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    
    const root = document.documentElement;
    
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      // System - check media query
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
    
    localStorage.setItem(THEME_KEY, theme);
  }, [theme, mounted]);

  if (!mounted) {
    return (
      <button
        type="button"
        className="w-7 h-7 rounded-full bg-surface-variant/20 text-ink flex items-center justify-center hover:bg-surface-variant/30 transition-all"
        title="Theme"
      >
        <span className="material-symbols-outlined text-[17px]">brightness_4</span>
      </button>
    );
  }

  const icons: Record<Theme, string> = {
    light: "light_mode",
    dark: "dark_mode",
    system: "computer",
  };

  const label: Record<Theme, string> = {
    light: "Light",
    dark: "Dark",
    system: "System",
  };

  return (
    <div className="flex items-center gap-1">
      {(["light", "dark", "system"] as Theme[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setTheme(t)}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
            theme === t
              ? "bg-jade text-white shadow-sm"
              : "bg-surface-variant/20 text-ink hover:bg-surface-variant/30"
          }`}
          title={`${label[t]} theme`}
          aria-label={`${label[t]} theme`}
        >
          <span className="material-symbols-outlined text-[16px]">{icons[t]}</span>
        </button>
      ))}
    </div>
  );
}
