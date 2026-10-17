import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { login, resetMock } from "./helpers";

// Produces deck/video screenshots in web/screenshots/{en,zh-CN}/. Run: npm run screenshots (mock mode).
const OUT = path.resolve(__dirname, "../../screenshots");

for (const locale of ["en", "zh-CN"] as const) {
  test(`screenshots ${locale}`, async ({ page }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(path.join(OUT, locale), { recursive: true });
    const shot = (name: string) => page.screenshot({ path: path.join(OUT, locale, `${name}.png`), fullPage: true });
    await resetMock(page);
    await page.goto(`/${locale}/login`);
    await shot("01-login");
    await login(page, "aisha", locale);
    await page.waitForTimeout(500);
    await shot("02-dashboard");

    await page.goto(`/${locale}/agent`);
    await page.getByTestId("prompt-save").click();
    await page.getByTestId("t4-block").waitFor();
    await shot("03-agent-t4-block");

    await page.getByTestId("prompt-sms").click();
    await page.getByTestId("cooling-off").waitFor();
    await shot("04-agent-cooling-off");

    await page.getByTestId("prompt-pay").click();
    await page.getByTestId("step-policy").waitFor();
    await page.waitForTimeout(400);
    await shot("05-agent-t3-plan");

    for (const [name, p] of [["06-documents", "documents"], ["07-payees", "payees"], ["08-approvals-student", "approvals"], ["10-settings", "settings"]] as const) {
      await page.goto(`/${locale}/${p}`);
      await page.waitForTimeout(500);
      await shot(name);
    }

    await page.goto(`/${locale}/audit`);
    await page.getByTestId("verify-chain").click();
    await page.getByTestId("chain-ok").waitFor();
    await shot("11-audit-verified");
    await page.locator("details summary").click();
    await page.getByTestId("tamper").click();
    await page.getByTestId("verify-chain").click();
    await page.getByTestId("chain-broken").waitFor();
    await shot("12-audit-broken");

    await login(page, "father", locale);
    await page.goto(`/${locale}/approvals`);
    await page.waitForTimeout(500);
    await shot("09-approvals-family");
  });
}
