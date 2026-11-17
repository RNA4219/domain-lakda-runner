import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
test("reusable workflow delegates parallel execution to CI", async () => {
  const yaml = await readFile(resolve(".github/workflows/e2e-reusable.yml"), "utf8");
  expect(yaml).toContain("workflow_call:");
  expect(yaml).toContain("isolation-verified:");
  expect(yaml).toContain("max-parallel:");
  expect(yaml).toContain("fail-fast: false");
  expect(yaml).toContain("manual-bb/e2e-export/v1");
  expect(yaml).toContain("real-target-attested:");
  expect(yaml).not.toMatch(/^\s+schedule:/m);
});
test("Linux CI proves Chromium rather than declaring Firefox", async () => {
  const yaml = await readFile(resolve(".github/workflows/linux-chromium.yml"), "utf8");
  expect(yaml).toContain("ubuntu-24.04");
  expect(yaml).toContain("npm test");
  expect(yaml).toContain("playwright install --with-deps chromium");
});
