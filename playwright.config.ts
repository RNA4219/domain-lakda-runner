import { defineConfig } from "@playwright/test";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

// WindowsのTEMPは8.3形式の場合がある。正規pathを前提とするfixtureへ実パスを渡す。
if (process.platform === "win32") {
  const temporaryDirectory = realpathSync.native(tmpdir());
  process.env.TEMP = temporaryDirectory;
  process.env.TMP = temporaryDirectory;
}

export default defineConfig({
  testDir: "./tests",
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  // Lakda自身がrunごとのtraceを制御する。テストharnessは二重開始しない。
  use: { browserName: "chromium", trace: "off", screenshot: "only-on-failure" }
});
