import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  // Lakda自身がrunごとのtraceを制御する。テストharnessは二重開始しない。
  use: { browserName: "chromium", trace: "off", screenshot: "only-on-failure" }
});
