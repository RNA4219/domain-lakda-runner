import { execFile } from "node:child_process";
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const runner = resolve("scripts/run-lakda-extension-real-acceptance.mjs");
const verifier = resolve("scripts/verify-lakda-extension-real-acceptance.mjs");
function run(script: string, env: NodeJS.ProcessEnv = {}): Promise<{ code: number; output: string }> {
  return new Promise(resolvePromise => execFile(process.execPath, [script], { cwd: process.cwd(), env: { ...process.env, ...env } }, (error, stdout, stderr) => resolvePromise({ code: typeof error?.code === "number" ? error.code : 0, output: stdout + stderr })));
}
test("P11 runner remains pending_external and non-zero without approved environment", async () => {
  const result = await run(runner);
  expect(result.code).toBe(2);
  expect(result.output).toContain("pending_external");
});
test("P11 verifier fails closed without a report and never creates a QEG verdict", async () => {
  const result = await run(verifier, { LAKDA_EXTENSION_REAL_REPORT: "" });
  expect(result.code).toBe(2);
  expect(result.output).toContain("pending_external");
  expect(result.output).not.toMatch(/"verdict"\s*:\s*"go"/);
});