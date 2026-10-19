"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";

/** 6-box one-time-code field. One real <input> (numeric keypad, autocomplete=one-time-code) drawn as six segmented boxes. */
export function TotpInput({ value, onChange, label, disabled, hint, id }: { value: string; onChange: (v: string) => void; label?: string; disabled?: boolean; hint?: string; id?: string }) {
  const t = useTranslations("common");
  const auto = useId();
  const inputId = id ?? auto;
  const [focus, setFocus] = useState(false);
  const cells = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  const active = Math.min(value.length, 5);
  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-ink">{label ?? t("totpCode")}</label>
      <div className="relative inline-flex gap-2">
        {cells.map((c, i) => (
          <span key={i} aria-hidden="true"
            className={`grid h-12 w-10 place-items-center rounded-lg border bg-surface font-mono text-xl font-semibold text-ink transition sm:h-14 sm:w-12 ${focus && i === active ? "border-cta ring-2 ring-cta/30" : c ? "border-line-strong" : "border-line"} ${disabled ? "bg-sunken opacity-60" : ""}`}>
            {c || (focus && i === active ? <span className="h-6 w-px animate-pulse bg-ink" /> : "")}
          </span>
        ))}
        <input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          inputMode="numeric"
          pattern="[0-9]{6}"
          autoComplete="one-time-code"
          maxLength={6}
          disabled={disabled}
          aria-describedby={hint ? `${inputId}-hint` : undefined}
          className="absolute inset-0 h-full w-full cursor-text rounded-lg bg-transparent text-transparent caret-transparent opacity-[0.01] focus:outline-none"
        />
      </div>
      {hint ? <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-ink-600">{hint}</p> : null}
    </div>
  );
}
