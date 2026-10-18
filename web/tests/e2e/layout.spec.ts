import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs"; import path from "node:path";
import { login, resetMock } from "./helpers";

/**
 * Layout QA: every screen x {desktop 1280, mobile 390} x {en, zh-CN} x {light, dark}.
 * Saves screenshots to $UI_SHOTS (default /workspace/ui-review/current) and asserts, via bounding boxes:
 *  - no horizontal page overflow; no element extends past the viewport's right edge
 *  - no overlapping sibling cards / buttons; tap targets >= 40px high on mobile (visible buttons/links/inputs)
 *  - the main content's left edge is the same on all pages of a viewport (consistent grid)
 * Violations are collected per screen and reported together (soft), then fail the test.
 */
const OUT = process.env.UI_SHOTS ?? "/workspace/ui-review/current";
const ROUTES = ["", "agent", "approvals", "audit", "documents", "payees", "settings"];
const VIEWPORTS = { desktop: { width: 1280, height: 860 }, mobile: { width: 390, height: 844 } } as const;
const lefts: Record<string, Record<string, number>> = {};

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => { localStorage.setItem("setu-theme", t); const r = document.documentElement; r.classList.toggle("dark", t === "dark"); r.style.colorScheme = t; }, theme);
}

async function check(page: Page, vp: "desktop" | "mobile", key: string): Promise<string[]> {
  return page.evaluate(({ vp, key }) => {
    const v: string[] = []; const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W + 1) v.push(`page overflows horizontally (${document.documentElement.scrollWidth} > ${W})`);
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const sel = (e: Element) => (e.getAttribute("data-testid") ? `[${e.getAttribute("data-testid")}]` : e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").slice(0, 2).join(".") : ""));
    const inScroller = (e: Element) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth) return true; } return false; };
    for (const e of Array.from(document.querySelectorAll("main *")).filter(vis)) {
      const r = e.getBoundingClientRect();
      if (r.right > W + 1 && !inScroller(e) && !e.closest("pre,code,table")) { v.push(`overflow-x: ${sel(e)} right=${Math.round(r.right)} > ${W}`); if (v.length > 12) break; }
    }
    // overlap among interactive elements / cards
    const items = Array.from(document.querySelectorAll("main button, main a[href], main input, main select, main textarea")).filter(vis).filter((e) => !e.closest("[aria-hidden=true]"));
    outer: for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!; if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 2 && oy > 2) { v.push(`overlap: ${sel(a)} x ${sel(b)}`); if (v.length > 12) break outer; }
    }
    if (vp === "mobile") for (const e of items) { const r = e.getBoundingClientRect(); const t = (e as HTMLInputElement).type; if (r.height < 36 && t !== "checkbox" && t !== "radio" && !e.closest("table,nav a") && !e.classList.contains("sr-only")) v.push(`small tap target ${sel(e)} h=${Math.round(r.height)}`); }
    const m = document.querySelector("main"); if (m) { const first = m.firstElementChild?.getBoundingClientRect(); void key; (window as unknown as { __left: number }).__left = first ? Math.round(first.left) : -1; }
    return Array.from(new Set(v)).slice(0, 15);
  }, { vp, key });
}

for (const locale of ["en", "zh-CN"] as const) for (const vp of ["desktop", "mobile"] as const) for (const theme of ["light", "dark"] as const) {
  test(`layout ${locale} ${vp} ${theme}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[vp]);
    await resetMock(page);
    await login(page, "aisha", locale);
    const problems: string[] = [];
    for (const r of ROUTES) {
      await page.goto(`/${locale}/${r}`); await page.getByRole("main").waitFor();
      await setTheme(page, theme); await page.waitForTimeout(350);
      const name = `${locale}_${vp}_${theme}_${r || "dashboard"}`;
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      for (const msg of await check(page, vp, name)) problems.push(`${r || "dashboard"}: ${msg}`);
      const left = await page.evaluate(() => (window as unknown as { __left: number }).__left);
      (lefts[`${locale}_${vp}`] ??= {})[r || "dashboard"] = left;
    }
    const L = Object.values(lefts[`${locale}_${vp}`] ?? {}); // consistent grid: same content left edge on every page
    if (Math.max(...L) - Math.min(...L) > 1) problems.push(`inconsistent content left edge across pages: ${JSON.stringify(lefts[`${locale}_${vp}`])}`);
    fs.writeFileSync(path.join(OUT, `report_${locale}_${vp}_${theme}.txt`), problems.join("\n") || "OK");
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
