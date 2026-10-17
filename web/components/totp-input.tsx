"use client";
import { useId } from "react";
import { useTranslations } from "next-intl";

/** 6-digit one-time code field. Numeric keypad on mobile; autocomplete=one-time-code. */
export function TotpInput({ value, onChange, label, disabled, hint, id }: { value: string; onChange: (v: string) => void; label?: string; disabled?: boolean; hint?: string; id?: string }) {
  const t = useTranslations("common");
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-ink-700">{label ?? t("totpCode")}</label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        pattern="[0-9]{6}"
        autoComplete="one-time-code"
        maxLength={6}
        disabled={disabled}
        aria-describedby={hint ? `${inputId}-hint` : undefined}
        placeholder="••••••"
        className="w-40 rounded-lg border border-line bg-white px-3 py-2 text-center font-mono text-lg tracking-[0.35em] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 disabled:bg-slate-100"
      />
      {hint ? <p id={`${inputId}-hint`} className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}
