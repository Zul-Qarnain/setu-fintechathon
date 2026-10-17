"use client";
import { useTranslations } from "next-intl";
import { pad2, timeRemaining } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/** Live countdown to an ISO timestamp (cooling-off timers). Announced politely only on completion. */
export function Countdown({ until, className = "" }: { until: string; className?: string }) {
  const t = useTranslations("common");
  const now = useNow(1000);
  const r = timeRemaining(until, now);
  if (r.done) return <span className={`font-semibold text-jade-800 ${className}`}>{t("coolingOffDone")}</span>;
  return (
    <span className={`tabular-nums font-semibold ${className}`} role="timer" aria-label={t("timeRemaining", { h: r.hours, m: r.minutes, s: r.seconds })}>
      {pad2(r.hours)}:{pad2(r.minutes)}:{pad2(r.seconds)}
    </span>
  );
}
