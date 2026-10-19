"use client";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";

/** "EN | 简体中文" text switch (mockup style). */
export function LocaleToggle({ dark = false }: { dark?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const opt = (value: "en" | "zh-CN", text: string, lang: string) => {
    const active = locale === value;
    const tone = active ? (dark ? "text-white font-bold" : "text-ink font-bold") : dark ? "text-white/70 hover:text-white" : "text-ink-600 hover:text-ink";
    return (
      <button type="button" lang={lang} aria-current={active ? "true" : undefined} onClick={() => { if (!active) router.replace(pathname, { locale: value }); }}
        className={`h-9 rounded-md px-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 ${tone}`}>{text}</button>
    );
  };
  return (
    <div role="group" aria-label={t("language")} className="inline-flex items-center">
      {opt("en", "EN", "en")}
      <span aria-hidden="true" className={dark ? "text-white/40" : "text-line-strong"}>|</span>
      {opt("zh-CN", "简体中文", "zh-CN")}
    </div>
  );
}
