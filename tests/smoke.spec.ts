import { expect, test } from "@playwright/test";

test("Chromium smoke is available", async ({ page }) => {
  await page.setContent("<main><h1>Lakda fixture</h1></main>");
  await expect(page.getByRole("heading", { name: "Lakda fixture" })).toBeVisible();
});
