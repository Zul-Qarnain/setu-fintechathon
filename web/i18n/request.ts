import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";
import en from "../messages/en.json";

type Msgs = Record<string, unknown>;
function merge(base: Msgs, over: Msgs): Msgs {
  const out: Msgs = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = v && typeof v === "object" && b && typeof b === "object" ? merge(b as Msgs, v as Msgs) : v;
  }
  return out;
}

// English is the official language; zh-CN keys that are missing fall back to English.
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !(routing.locales as readonly string[]).includes(locale)) locale = routing.defaultLocale;
  if (locale === "en") return { locale, messages: en };
  const zh = (await import("../messages/zh-CN.json")).default;
  return { locale, messages: merge(en as Msgs, zh as Msgs) as typeof en };
});
