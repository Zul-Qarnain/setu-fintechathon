import { expect, test } from "@playwright/test";
import { login, resetMock, uploadAndConfirmTuition } from "./helpers";

test.beforeEach(async ({ page }) => { await resetMock(page); });

test("login lands on dashboard with synthetic banner and SAMPLE rate label", async ({ page }) => {
  await login(page, "aisha");
  await expect(page.getByRole("note").first()).toContainText("SYNTHETIC");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("SAMPLE rate — not live").first()).toBeVisible();
  await expect(page.getByText(/¥[\d,]+\.\d{2}/).first()).toBeVisible();
});

test("documents: injected notice is blocked by the guardian (red state)", async ({ page }) => {
  await login(page, "aisha");
  await page.goto("/en/documents");
  await page.getByTestId("load-injected").click();
  await page.getByTestId("analyse").click();
  await expect(page.getByTestId("doc-blocked")).toBeVisible();
  await expect(page.getByTestId("confirm-doc")).toBeDisabled();
});

test("inject-block demo: injected document + agent shows red T4 block with audit event", async ({ page }) => {
  await login(page, "aisha");
  await page.goto("/en/documents");
  await page.getByTestId("load-injected").click();
  await page.getByTestId("analyse").click();
  await expect(page.getByTestId("doc-blocked")).toBeVisible();
  await page.goto("/en/agent");
  await page.getByTestId("prompt-pay").click();
  await expect(page.getByTestId("t4-block")).toBeVisible();
  await expect(page.getByTestId("t4-block")).toContainText("INJECTION_DETECTED");
});

test("'pay new account to save 3%' shows red T4 block", async ({ page }) => {
  await login(page, "aisha");
  await page.goto("/en/agent");
  await page.getByTestId("prompt-save").click();
  const block = page.getByTestId("t4-block");
  await expect(block).toBeVisible();
  await expect(block).toContainText("BLOCKED");
  await expect(page.getByTestId("step-policy")).toHaveAttribute("data-status", "blocked");
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
  await uploadAndConfirmTuition(page);
  await page.goto("/en/agent");
  await page.getByTestId("prompt-pay").click();
  await expect(page.getByText("Waiting for approval").first()).toBeVisible();
  // student approval inside the chat action card (demo helper fetches a fresh code and submits)
  const card = page.getByRole("article").first();
  await card.getByRole("button", { name: /Demo: fill code/ }).click();
  await expect(card.getByText(/You have already approved/)).toBeVisible();
  // approver as a second user
  await login(page, "father");
  await page.goto("/en/approvals");
  const pending = page.getByRole("article").first();
  await expect(pending).toContainText("T3");
  await pending.getByRole("button", { name: /Demo: fill code/ }).click();
  await expect(page.getByText(/Executed in the sandbox bank/).first()).toBeVisible();
});

test("audit: verify chain OK, then tamper -> broken at seq N", async ({ page }) => {
  await login(page, "aisha");
  await page.goto("/en/audit");
  await page.getByTestId("verify-chain").click();
  await expect(page.getByTestId("chain-ok")).toContainText("Chain verified ✓");
  // tamper with the 2nd visible row (the chain is global, a user only sees their own rows)
  const seq = (await page.locator('[data-testid^="audit-row-"] th').nth(1).innerText()).replace(/\D/g, "");
  await page.getByText("Demo tools").click();
  await page.getByLabel("Entry #").fill(seq);
  await page.getByTestId("tamper").click();
  await page.getByTestId("verify-chain").click();
  await expect(page.getByTestId("chain-broken")).toContainText("Chain broken at seq");
  await expect(page.getByTestId(`audit-row-${seq}`)).toHaveAttribute("aria-current", "true");
});

test("language toggle switches to zh-CN, saves cookie, and formats ¥", async ({ page, context }) => {
  await login(page, "aisha");
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh-CN/);
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await expect(page.getByText(/¥(1,350|18,500)\.00/).first()).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "NEXT_LOCALE")?.value).toBe("zh-CN");
  await page.goto("/zh-CN/audit");
  await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
});
