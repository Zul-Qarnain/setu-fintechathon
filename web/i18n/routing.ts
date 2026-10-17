import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  locales: ["en", "zh-CN"],
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365 },
});
export type Locale = (typeof routing.locales)[number];
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);
