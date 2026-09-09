import { expect, test } from "@playwright/test";

// Runs under every configured project (phone, laptop, tv-1080p), so each
// assertion below is really checked at all three target viewports.

test("the root path lands the visitor on a supported locale", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(fr|en)(\/|$|\?)/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the English landing page renders its hero and login entry point", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
});

test("an unknown locale is a 404", async ({ page }) => {
  const response = await page.goto("/zz");
  expect(response?.status()).toBe(404);
});

for (const path of ["/fr", "/en/login"]) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
