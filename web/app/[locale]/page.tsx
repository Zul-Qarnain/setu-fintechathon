import { useTranslations } from "next-intl";
export default function Home() {
  const t = useTranslations("app");
  return <main className="p-8">{t("name")} — {t("tagline")}</main>;
}
