import { test, expect } from "@playwright/test";

test("reviewed scenario (generated; do not hand-edit)", async ({ page }) => {
  await page.goto("http://127.0.0.1:18943/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("shipping-question").click();
  await expect(page.getByTestId("shipping-answer")).toBeVisible({ timeout: 5000 });
});
