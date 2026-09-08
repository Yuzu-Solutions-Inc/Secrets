import { expect, test } from "@playwright/test";

test("landing presents the original game proposition", async ({ page }) => {
  await page.goto("/fr");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("secrets");
  await expect(page.getByRole("link", { name: "Créer une partie" })).toBeVisible();
  await expect(page.getByText("Pensé pour mobile")).toBeVisible();
});

test("login remains usable at every target viewport", async ({ page }) => {
  await page.goto("/en/login");
  await expect(page.getByRole("heading", { name: "Enter the house" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
});
