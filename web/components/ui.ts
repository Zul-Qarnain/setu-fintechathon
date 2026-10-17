// Shared Tailwind class strings for consistent controls.
export const btn = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
  primary: "bg-ink text-white hover:bg-ink-700",
  jade: "bg-jade-700 text-white hover:bg-jade-800",
  danger: "bg-cinnabar-600 text-white hover:bg-cinnabar-700",
  ghost: "border border-line bg-white text-ink hover:bg-slate-50",
};
export const button = (v: keyof Omit<typeof btn, "base"> = "primary") => `${btn.base} ${btn[v]}`;
export const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 disabled:bg-slate-100";
export const label = "mb-1 block text-sm font-medium text-ink-700";
