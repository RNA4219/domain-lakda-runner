import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { runExternalSmoke } from "../src/external-smoke.js";
import { startFixture } from "./fixtures/server.js";

test("optional external smoke executes only against the explicitly supplied base URL", async () => {
  const fixture = await startFixture(); const outputDir = await mkdtemp(join(tmpdir(), "lakda-external-"));
  try {
    const result = await runExternalSmoke(fixture.baseUrl, outputDir);
    expect("outcome" in result && result.outcome).toBe("passed");
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
});