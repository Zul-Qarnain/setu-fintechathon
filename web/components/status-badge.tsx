import { useTranslations } from "next-intl";

type Tone = "ok" | "warn" | "bad" | "info" | "neutral";
const TONE: Record<Tone, string> = {
  ok: "bg-jade-50 text-jade-800 border-jade-600/40",
  warn: "bg-amber-50 text-amber-700 border-amber-600/50",
  bad: "bg-cinnabar-50 text-cinnabar-700 border-cinnabar-600/50",
  info: "bg-bridge-50 text-bridge-700 border-bridge-600/30",
  neutral: "bg-sunken text-ink-700 border-line-strong",
};
const ICON: Record<Tone, string> = { ok: "✓", warn: "⏳", bad: "✕", info: "ℹ", neutral: "•" };
const MAP: Record<string, Tone> = {
  executed: "ok", approved: "ok", confirmed: "ok", verified: "ok", clean: "ok", paid: "ok", open: "info", draft: "neutral",
  awaiting_approval: "warn", cooling_off: "warn", pending_confirmation: "warn", suspicious: "warn", unverified: "warn",
  blocked: "bad", rejected: "bad", failed: "bad",
};

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const t = useTranslations("common.status");
  const tone = MAP[status] ?? "neutral";
  const label = t.has(status) ? t(status) : status.replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${TONE[tone]} ${className}`}>
      <span aria-hidden="true">{ICON[tone]}</span>
      {label}
    </span>
  );
}
