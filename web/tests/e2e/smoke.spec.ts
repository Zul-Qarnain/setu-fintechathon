import { expect, test } from "@playwright/test";
import { login, resetMock } from "./helpers";

test.beforeEach(async ({ page }) => { await resetMock(page); });

test("login lands on dashboard with synthetic banner and SAMPLE rate label", async ({ page }) => {
  await login(page, "aisha");
  await expect(page.getByRole("note").first()).toContainText("SYNTHETIC");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("SAMPLE rate — not live").first()).toBeVisible();
  await expect(page.getByText("¥18,500.00").first()).toBeVisible();
});

test("inject-block demo: 'pay new account to save 3%' shows red T4 block", async ({ page }) => {
  await login(page, "aisha");
  await page.goto("/en/agent");
  await page.getByTestId("prompt-save").click();
  const block = page.getByTestId("t4-block");
  await expect(block).toBeVisible();
  await expect(block).toContainText("BLOCKED");
  await expect(page.getByTestId("step-guardian")).toHaveAttribute("data-status", "blocked");
});

test("payee-change SMS shows amber cooling-off with live timer", async ({ page }) => {
  await login(page, "aisha");
  await page.goto("/en/agent");
  await page.getByTestId("prompt-sms").click();
  const box = page.getByTestId("cooling-off");
  await expect(box).toBeVisible();
  await expect(box.getByRole("timer")).toBeVisible();
});

test("T3 tuition: student TOTP then family approver TOTP executes in sandbox", async ({ page }) => {
  await login(page, "aisha");
  await page.goto("/en/agent");
  await page.getByTestId("prompt-pay").click();
  await expect(page.getByText("Waiting for approval").first()).toBeVisible();
  // student approval inside the chat action card
  const card = page.getByRole("article").first();
  await card.getByLabel(/Your TOTP code/).fill("123456");
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(card.getByText(/You have already approved/)).toBeVisible();
  // approver as a second user
  await login(page, "father");
  await page.goto("/en/approvals");
  const pending = page.getByRole("article").first();
  await expect(pending).toContainText("T3");
  await pending.getByLabel(/Your TOTP code/).fill("123456");
  await pending.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Executed in the sandbox bank/).first()).toBeVisible();
});

test("audit: verify chain OK, then tamper -> broken at seq N", async ({ page }) => {
  await login(page, "aisha");
  await page.goto("/en/audit");
  await page.getByTestId("verify-chain").click();
  await expect(page.getByTestId("chain-ok")).toContainText("Chain verified ✓");
  await page.getByText("Demo tools").click();
  await page.getByLabel("Entry #").fill("2");
  await page.getByTestId("tamper").click();
  await page.getByTestId("verify-chain").click();
  await expect(page.getByTestId("chain-broken")).toContainText("Chain broken at seq 2");
  await expect(page.getByTestId("audit-row-2")).toHaveAttribute("aria-current", "true");
});

test("language toggle switches to zh-CN, saves cookie, and formats ¥", async ({ page, context }) => {
  await login(page, "aisha");
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh-CN/);
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await expect(page.getByText("¥18,500.00").first()).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "NEXT_LOCALE")?.value).toBe("zh-CN");
  await page.goto("/zh-CN/audit");
  await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
});
