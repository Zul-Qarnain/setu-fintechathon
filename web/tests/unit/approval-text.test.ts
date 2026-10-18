import { describe, expect, it } from "vitest";
import { waitingSubKey } from "@/lib/approval-text";
import en from "@/messages/en/agent.json";
import zh from "@/messages/zh-CN/agent.json";

describe("tier-aware waiting text", () => {
  it("T2 (TOTP only) never mentions the family approver", () => {
    expect(waitingSubKey("T2", ["totp"])).toBe("waitingSubTotp");
    expect(waitingSubKey("T2")).toBe("waitingSubTotp");
    expect(en.trace.waitingSubTotp).not.toMatch(/family/i);
    expect(zh.trace.waitingSubTotp).not.toContain("家人");
  });
  it("T3 needs TOTP + family approver", () => {
    expect(waitingSubKey("T3", ["totp", "family_approver"])).toBe("waitingSubFamily");
    expect(waitingSubKey("T3")).toBe("waitingSubFamily");
    expect(en.trace.waitingSubFamily).toMatch(/TOTP and the family approver/);
  });
  it("after the student's TOTP only the family approver remains", () => {
    expect(waitingSubKey("T3", ["family_approver"])).toBe("waitingSubFamily");
  });
});
