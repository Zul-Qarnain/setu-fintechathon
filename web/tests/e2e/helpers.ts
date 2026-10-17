import { expect, type Page } from "@playwright/test";

export async function login(page: Page, who: "aisha" | "father" | "rafi", locale = "en") {
  await page.goto(`/${locale}/login`);
  await page.evaluate(() => { window.localStorage.removeItem("setu.token"); });
  await page.reload();
  const name = { aisha: /Aisha \(BD/, father: /Aisha's father/, rafi: /Rafi/ }[who];
  await page.getByRole("button", { name }).click();
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/?$`));
  await expect(page.getByRole("main")).toBeVisible();
}

export async function resetMock(page: Page) {
  await page.goto("/en/login");
  await page.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
}
