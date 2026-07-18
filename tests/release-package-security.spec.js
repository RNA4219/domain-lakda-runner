import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const scanner = "scripts/scan-release-package.mjs";

test("release package scanner verifies metadata, required files, hashes, and sensitive paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-package-scan-"));
  try {
    await mkdir(join(root, "dist"));
    await mkdir(join(root, "schemas"));
    await mkdir(join(root, "vendor", "hate", "v1"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "domain-lakda-runner", version: "0.4.0-rc.1", private: true, main: "./dist/index.js", types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    }));
    for (const [path, value] of [
      ["CHANGELOG.md", "# Changes\n"], ["LICENSE", "RNA-TPSAL-1.0\n"], ["LICENSE.ja.md", "# 参考訳\n"],
      ["NOTICE", "Original developer: RNA4219\n"], ["LICENSING.md", "# Licensing\n"],
      ["COMMERCIAL-LICENSE.md", "# Attribution-Free Commercial Licensing\n\nApplication and contact portal: https://licensing.rna4219.com/\n"], ["THIRD_PARTY_NOTICES.md", "# Third party\n"],
      ["README.md", "# Lakda\n\n現在の候補版は `0.4.0-rc.1` です。\n"], ["RUNBOOK.md", "# Runbook\n"],
      ["dist/index.js", "export const version = '0.4.0-rc.1';\n"], ["dist/index.d.ts", "export declare const version: string;\n"],
      ["schemas/adaptive-contracts-v1.schema.json", "{}\n"], ["schemas/lakda-config-v1.schema.json", "{}\n"],
      ["vendor/hate/LICENSE", "MIT License\n"], ["vendor/hate/v1/artifact-manifest.schema.json", "{}\n"],
    ]) await writeFile(join(root, path), value);
    const output = join(root, "scan.json");
    const stdout = execFileSync(process.execPath, [scanner, "--path=" + root, "--out=" + output], { encoding: "utf8" });
    expect(JSON.parse(stdout)).toMatchObject({ status: "passed", packageVersion: "0.4.0-rc.1", fileCount: 16 });
    expect(JSON.parse(await readFile(output, "utf8")).files.every(entry => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);

    await writeFile(join(root, "COMMERCIAL-LICENSE.md"), "Contact: [COMMERCIAL_CONTACT]\n");
    expect(() => execFileSync(process.execPath, [scanner, "--path=" + root], { encoding: "utf8", stdio: "pipe" })).toThrow();
    await writeFile(join(root, "COMMERCIAL-LICENSE.md"), "Application and contact portal: https://licensing.rna4219.com/\n");

    await writeFile(join(root, "README.md"), "現在の候補版は `9.9.9` です。\n");
    expect(() => execFileSync(process.execPath, [scanner, "--path=" + root], { encoding: "utf8", stdio: "pipe" })).toThrow();

    await writeFile(join(root, "README.md"), "C:\\Users\\operator\\private.txt\n");
    expect(() => execFileSync(process.execPath, [scanner, "--path=" + root], { encoding: "utf8", stdio: "pipe" })).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
