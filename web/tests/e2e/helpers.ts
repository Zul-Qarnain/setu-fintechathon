import { expect, type Page } from "@playwright/test";

const EMAIL = { aisha: "aisha@demo.setu.test", father: "father.rahman@demo.setu.test", rafi: "rafi@demo.setu.test" } as const;

/** Works in mock mode and against the real backend (demo personas share one demo password). */
export async function login(page: Page, who: keyof typeof EMAIL, locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.evaluate(() => { window.localStorage.removeItem("setu.token"); });
  await page.reload();
  await page.getByLabel("Email").fill(EMAIL[who]);
  await page.getByLabel("Password").fill("demo-password-123");
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/?$`));
  await expect(page.getByRole("main")).toBeVisible();
}

export async function resetMock(page: Page) {
  await page.goto("/en/login");
  await page.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
}

/** Upload the clean synthetic tuition notice and confirm it; leaves it selected for the agent. */
export async function uploadAndConfirmTuition(page: Page, locale = "en") {
  await page.goto(`/${locale}/documents`);
  await page.getByTestId("load-clean").click();
  await page.getByTestId("analyse").click();
  await expect(page.getByRole("heading", { name: "Confirm the parsed fields" })).toBeVisible();
  await page.getByLabel("I checked these values against the original notice.").check();
  await page.getByTestId("confirm-doc").click();
  await expect(page.getByText("Obligation created")).toBeVisible();
}
