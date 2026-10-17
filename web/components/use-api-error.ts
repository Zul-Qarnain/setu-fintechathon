"use client";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { errorInfo } from "@/lib/errors";

/** Returns [message, setFromError, clear]. Message is friendly (translated) + server detail. */
export function useApiError() {
  const t = useTranslations("errors");
  const [msg, setMsg] = useState<string | null>(null);
  const fail = useCallback((e: unknown) => {
    const i = errorInfo(e);
    setMsg(t.has(i.key) ? `${t(i.key)}${i.message && i.key === "generic" ? ` (${i.message})` : ""}` : i.message);
  }, [t]);
  const clear = useCallback(() => setMsg(null), []);
  return [msg, fail, clear] as const;
}
