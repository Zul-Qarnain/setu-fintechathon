import { ApiError } from "./api";

const KNOWN = ["TOTP_INVALID", "TOTP_LOCKED", "COOLING_OFF_ACTIVE", "POLICY_BLOCKED", "AMOUNT_MISMATCH", "RATE_LIMITED", "NETWORK", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "NOT_APPROVER", "validation_error"];

/** Map any thrown value to a translation key under `errors.*` plus the server message as fallback detail. */
export function errorInfo(e: unknown): { key: string; message: string; code: string } {
  if (e instanceof ApiError) {
    const code = KNOWN.includes(e.code) ? e.code : "generic";
    return { key: code, message: e.message, code: e.code };
  }
  return { key: "generic", message: e instanceof Error ? e.message : String(e), code: "UNKNOWN" };
}
