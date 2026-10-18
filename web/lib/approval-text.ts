/** Tier-aware wording for "waiting for approval": T2 needs the student's TOTP only; T3 needs TOTP + family approver. */
export type WaitingKey = "waitingSubTotp" | "waitingSubFamily";

export function waitingSubKey(tier: string, required?: readonly string[] | null): WaitingKey {
  if (required && required.length > 0) return required.includes("family_approver") ? "waitingSubFamily" : "waitingSubTotp";
  return tier === "T2" ? "waitingSubTotp" : "waitingSubFamily";
}
