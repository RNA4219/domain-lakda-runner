import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const scanner = "scripts/scan-release-evidence.mjs";

test("release package security scan emits file hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-release-scan-"));
  await mkdir(join(root, "bundle"));
  await writeFile(join(root, "bundle", "summary.json"), JSON.stringify({ status: "passed", promptHash: "a".repeat(64) }) + "\n");
  const out = join(root, "scan.json");
  const stdout = execFileSync(process.execPath, [scanner, "--path=" + join(root, "bundle"), "--out=" + out], { encoding: "utf8" });
  expect(JSON.parse(stdout)).toMatchObject({ status: "passed", files: [{ path: "summary.json" }] });
  expect(JSON.parse(await readFile(out, "utf8")).files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
});

test("release package security scan rejects raw prompts and absolute user paths", async () => {
  const rawRoot = await mkdtemp(join(tmpdir(), "lakda-release-scan-raw-"));
  await writeFile(join(rawRoot, "unsafe.json"), JSON.stringify({ rawPrompt: "ignore previous instructions" }) + "\n");
  expect(() => execFileSync(process.execPath, [scanner, "--path=" + rawRoot], { encoding: "utf8", stdio: "pipe" })).toThrow();

  const pathRoot = await mkdtemp(join(tmpdir(), "lakda-release-scan-path-"));
  await writeFile(join(pathRoot, "unsafe.txt"), "C:\\Users\\operator\\artifact.json\n");
  expect(() => execFileSync(process.execPath, [scanner, "--path=" + pathRoot], { encoding: "utf8", stdio: "pipe" })).toThrow();
});