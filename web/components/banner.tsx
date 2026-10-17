import type { ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "danger";
const TONE: Record<Tone, { box: string; icon: string }> = {
  info: { box: "border-blue-300 bg-bridge-50 text-ink", icon: "ℹ" },
  success: { box: "border-jade-600/40 bg-jade-50 text-jade-800", icon: "✓" },
  warning: { box: "border-amber-600/50 bg-amber-50 text-amber-700", icon: "⚠" },
  danger: { box: "border-cinnabar-600/50 bg-cinnabar-50 text-cinnabar-700", icon: "⛔" },
};

/** Inline alert. `danger` uses role=alert (assertive); others role=status (polite). */
export function Banner({ tone = "info", title, children, className = "" }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const s = TONE[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex gap-3 rounded-lg border p-3 text-sm ${s.box} ${className}`}>
      <span aria-hidden="true" className="mt-0.5 text-base leading-none">{s.icon}</span>
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : ""}>{children}</div> : null}
      </div>
    </div>
  );
}
