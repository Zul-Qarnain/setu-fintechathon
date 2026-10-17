import { describe, expect, it } from "vitest";
import { formatBdt, formatCny, formatDate, timeRemaining } from "./format";
import { add, cmp, mul, sub } from "./decimal";

describe("format", () => {
  it("formats CNY with zh-CN convention", () => {
    expect(formatCny("18500.00")).toBe("¥18,500.00");
    expect(formatCny("18,500.00")).toBe("¥18,500.00");
  });
  it("formats BDT via en-BD", () => {
    expect(formatBdt("319742.00")).toContain("319,742.00");
    expect(formatBdt("319742.00")).toMatch(/৳|BDT/);
  });
  it("formats dates per locale", () => {
    expect(formatDate("2027-03-01", "zh-CN")).toContain("2027");
    expect(formatDate("2027-03-01", "en")).toContain("2027");
    expect(formatDate(null, "en")).toBe("—");
  });
  it("computes remaining time", () => {
    const r = timeRemaining("2026-01-01T01:00:00Z", Date.parse("2026-01-01T00:00:00Z"));
    expect(r.done).toBe(false);
    expect(r.hours).toBe(1);
    expect(timeRemaining("2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:01Z")).done).toBe(true);
  });
});

describe("decimal", () => {
  it("is exact", () => {
    expect(add("0.10", "0.20")).toBe("0.30");
    expect(sub("3500.00", "1240.50")).toBe("2259.50");
    expect(mul("2259.50", "17.2000")).toBe("38863.40");
    expect(mul("18500.00", "17.2")).toBe("318200.00");
    expect(cmp("2000.00", "2000.01")).toBe(-1);
    expect(sub("1.00", "2.50")).toBe("-1.50");
  });
});
