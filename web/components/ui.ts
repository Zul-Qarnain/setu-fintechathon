// Shared Tailwind class strings for consistent controls.
export const btn = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-50 min-h-10 motion-reduce:transition-none",
  primary: "bg-cta text-white shadow-sm hover:bg-primary-hover",
  jade: "bg-jade-700 text-white shadow-sm hover:brightness-110",
  danger: "bg-danger text-white hover:brightness-110",
  ghost: "border border-line bg-surface text-ink hover:bg-sunken",
};
export const button = (v: keyof Omit<typeof btn, "base"> = "primary") => `${btn.base} ${btn[v]}`;
export const input = "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 disabled:bg-sunken";
export const label = "mb-1 block text-sm font-medium text-ink-700";

/** Shared presets: bordered pill / chip, mono numerals, tap targets. */
export const chip = "inline-flex items-center gap-1 rounded-md border border-line bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink-700";
export const num = "font-mono tabular-nums";
export const tapLink = "inline-flex min-h-11 items-center font-semibold text-bridge-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600";
