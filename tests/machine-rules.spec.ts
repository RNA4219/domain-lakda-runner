import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadConfig } from "../src/core/config.js";
import { runLakda } from "../src/core/runner.js";
import { startFixture } from "./fixtures/server.js";

async function expectRule(ruleId: string, configOverrides: Parameters<typeof loadConfig>[1], handler: Parameters<typeof startFixture>[0]) {
  const fixture = await startFixture(handler); const outputDir = await mkdtemp(join(tmpdir(), `lakda-${ruleId}-`));
  try {
    const result = await runLakda(loadConfig(undefined, { baseUrl: fixture.baseUrl, outputDir, ...configOverrides }));
    expect(result.outcome, JSON.stringify(result)).toBe("failed");
    expect(result.failures.some(failure => failure.ruleId === ruleId)).toBeTruthy();
  } finally { await fixture.close(); await rm(outputDir, { recursive: true, force: true }); }
}

test("UI-001 classifies a pageerror fixture", async () => {
  await expectRule("UI-001", { actionCatalog: [{ id: "page-error", kind: "navigate", path: "/page-error" }] }, () => ({ body: "<script>throw new Error('fixture pageerror')</script>" }));
});

test("UI-003 classifies an unsuppressed console.error fixture", async () => {
  await expectRule("UI-003", { actionCatalog: [{ id: "console-error", kind: "navigate", path: "/console-error" }] }, () => ({ body: "<script>console.error('fixture console error')</script>" }));
});

test("UI-005 classifies an allowlisted authorization response", async () => {
  await expectRule("UI-005", { actionCatalog: [{ id: "unauthorized", kind: "navigate", path: "/unauthorized" }] }, () => ({ status: 401, body: "unauthorized", contentType: "text/html" }));
});

test("UI-006 classifies an action timeout", async () => {
  await expectRule("UI-006", { durationMs: 50, actionCatalog: [{ id: "missing", kind: "click", locator: { testId: "missing" } }] }, () => ({ body: "<main>fixture</main>" }));
});