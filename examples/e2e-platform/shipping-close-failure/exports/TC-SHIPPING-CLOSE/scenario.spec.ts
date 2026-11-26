import { test, expect } from "@playwright/test";

test("reviewed scenario (generated; do not hand-edit)", async ({ page }, testInfo) => {
  type Observation = {
    index: number;
    acceptanceRef?: string;
    actionId?: string;
    before?: number | null;
    observed?: number | null;
    result: string;
  };
  const observations: Observation[] = [];
  try {
  await page.goto("http://127.0.0.1:18943/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("shipping-question").click();
    {
      const record: Observation = { index: 1, acceptanceRef: "AC-SHIPPING-OPEN", actionId: "open", result: 'failed' };
      observations.push(record);
  await expect(page.getByTestId("shipping-answer")).toBeVisible({ timeout: 5000 });
      record.result = 'passed';
    }
  await page.getByTestId("shipping-question").click();
    {
      const record: Observation = { index: 2, acceptanceRef: "AC-SHIPPING-CLOSE", actionId: "close", result: 'failed' };
      observations.push(record);
  await expect(page.getByTestId("shipping-answer")).toBeHidden({ timeout: 5000 });
      record.result = 'passed';
    }
  } finally {
    await testInfo.attach('reviewed-observations.json', {
      body: JSON.stringify(observations),
      contentType: 'application/json',
    });
  }
});
