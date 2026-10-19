/** "aisha@…" → "Aisha", "father.rahman@…" → "Father Rahman" (from the account email; no invented names). */
export function displayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.split(/[._-]+/).filter(Boolean).map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ");
}

export type Kind = "tuition" | "rent" | "insurance" | "fee";
/** Category derived from the obligation's real title (tuition / dorm-rent / insurance / other fee). */
export function obligationKind(title: string | null | undefined): Kind {
  const s = (title ?? "").toLowerCase();
  if (/tuition|学费/.test(s)) return "tuition";
  if (/dorm|rent|residence|宿舍|房租/.test(s)) return "rent";
  if (/insurance|保险/.test(s)) return "insurance";
  return "fee";
}
export const KIND_ICON: Record<Kind, string> = { tuition: "school", rent: "building", insurance: "shield", fee: "file" };
export const KIND_TONE: Record<Kind, string> = {
  tuition: "bg-violet-50 text-violet-600",
  rent: "bg-bridge-50 text-bridge-600",
  insurance: "bg-amber-50 text-amber-700",
  fee: "bg-jade-50 text-jade-800",
};
