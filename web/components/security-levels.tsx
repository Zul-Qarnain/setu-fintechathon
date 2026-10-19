"use client";
import { useTranslations } from "next-intl";
import { Card, CardHead } from "./page-header";
import { Icon } from "./nav-icons";
import { useAuth } from "./auth-provider";
import type { Tier } from "@/lib/types";

const ROW: Record<Tier, string> = {
  T0: "bg-sunken text-ink-700",
  T1: "bg-bridge-50 text-bridge-700",
  T2: "bg-jade-50 text-jade-800",
  T3: "bg-amber-50 text-amber-700",
  T4: "bg-cinnabar-50 text-cinnabar-700",
};

/** T0–T4 policy ladder (the real deterministic tiers) + whether this account has TOTP on. */
export function SecurityLevels({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("tiers");
  const td = useTranslations("dashboard.security");
  const { user } = useAuth();
  const on = !!user?.totp_enabled;
  return (
    <Card aria-labelledby="sec-h">
      <CardHead id="sec-h" icon={<Icon name="shield" />} tone="green" title={td("title")} />
      <div className={`mt-4 flex items-center gap-3 rounded-xl border p-3 ${on ? "border-jade-600/30 bg-jade-50" : "border-amber-600/30 bg-amber-50"}`}>
        <Icon name={on ? "shield" : "shieldAlert"} className={`h-6 w-6 shrink-0 ${on ? "text-jade-600" : "text-amber-700"}`} />
        <div className="min-w-0 text-sm"><p className={`font-semibold ${on ? "text-jade-800" : "text-amber-700"}`}>{on ? td("totpOn") : td("totpOff")}</p><p className="text-xs text-ink-600">{td("totpHint")}</p></div>
      </div>
      <ul className={compact ? "mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-5" : "mt-3 space-y-1.5"}>
        {(["T0", "T1", "T2", "T3", "T4"] as Tier[]).map((k) => (
          <li key={k} className={`${compact ? "rounded-xl p-3 text-xs" : "flex items-start gap-3 rounded-lg px-3 py-2 text-sm"} ${ROW[k]}`}>
            <span className={`${compact ? "block text-sm" : "w-7 shrink-0 text-xs"} font-mono font-bold leading-5`}>{k}</span>
            <span className="leading-5">{t(`${k}.desc`)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
