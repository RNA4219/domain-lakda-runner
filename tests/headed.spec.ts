import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadConfig } from "../src/core/config.js";
import { runLakda } from "../src/core/runner.js";
import { startFixture } from "./fixtures/server.js";

test.skip(Boolean(process.env.CI), "headed browser confirmation is local-only");

test("runner executes a headed Chromium smoke run", async () => {
  const fixture = await startFixture(); const outputDir = await mkdtemp(join(tmpdir(), "lakda-headed-"));
  try {
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, headed: true }));
    expect(result.outcome, JSON.stringify(result)).toBe("passed");
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});