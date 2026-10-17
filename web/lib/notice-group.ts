import type { DemoNotice } from "./types";

export const GROUPS = ["clean", "injection", "payee_change", "homoglyph", "amount_mismatch", "scam_urgency", "other"] as const;
export type Group = (typeof GROUPS)[number];
export function noticeGroup(n: DemoNotice): Group {
  const m = /\(([a-z_]+),/i.exec(n.label);
  const g = m?.[1].toLowerCase() as Group | undefined;
  return g && (GROUPS as readonly string[]).includes(g) ? g : "other";
}
