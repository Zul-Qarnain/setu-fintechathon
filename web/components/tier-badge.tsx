import { useTranslations } from "next-intl";
import type { Tier } from "@/lib/types";

const STYLE: Record<Tier, string> = {
  T0: "bg-slate-100 text-ink-700 border-slate-300",
  T1: "bg-bridge-50 text-bridge-700 border-blue-300",
  T2: "bg-jade-50 text-jade-800 border-jade-600/40",
  T3: "bg-amber-50 text-amber-700 border-amber-600/50",
  T4: "bg-cinnabar-50 text-cinnabar-700 border-cinnabar-600/50",
};
const ICON: Record<Tier, string> = { T0: "○", T1: "✎", T2: "✓", T3: "◆", T4: "⛔" };

/** Tier badge: colour + icon + text (never colour alone). */
export function TierBadge({ tier, className = "" }: { tier: Tier; className?: string }) {
  const t = useTranslations("tiers");
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${STYLE[tier]} ${className}`} title={t(`${tier}.desc`)}>
      <span aria-hidden="true">{ICON[tier]}</span>
      <span>{t(`${tier}.label`)}</span>
    </span>
  );
}
