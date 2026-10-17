"use client";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";

export function LocaleToggle({ dark = false }: { dark?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const opt = (value: "en" | "zh-CN", text: string, lang: string) => {
    const active = locale === value;
    return (
      <button
        type="button"
        lang={lang}
        aria-current={active ? "true" : undefined}
        onClick={() => { if (!active) router.replace(pathname, { locale: value }); }}
        className={`px-3 py-1 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 ${active ? (dark ? "bg-white text-ink" : "bg-ink text-white") : dark ? "text-white/80 hover:bg-white/10" : "text-ink hover:bg-slate-100"}`}
      >
        {text}
      </button>
    );
  };
  return (
    <div role="group" aria-label={t("language")} className={`inline-flex overflow-hidden rounded-lg border ${dark ? "border-white/30" : "border-line bg-white"}`}>
      {opt("en", "EN", "en")}
      {opt("zh-CN", "简体中文", "zh-CN")}
    </div>
  );
}
