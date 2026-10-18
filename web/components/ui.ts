// Shared Tailwind class strings for consistent controls.
export const btn = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
  primary: "bg-primary text-white hover:bg-primary-hover",
  jade: "bg-jade-700 text-white hover:brightness-110",
  danger: "bg-danger text-white hover:brightness-110",
  ghost: "border border-line bg-surface text-ink hover:bg-sunken",
};
export const button = (v: keyof Omit<typeof btn, "base"> = "primary") => `${btn.base} ${btn[v]}`;
export const input = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 disabled:bg-sunken";
export const label = "mb-1 block text-sm font-medium text-ink-700";
