import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

test("V8 to LCOV keeps nested zero-count lines uncovered", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-v8-lcov-"));
  const input = join(root, "v8");
  await mkdir(input);
  const source = "function choose(value) {\n  if (value) return 1;\n  return 2;\n}\nchoose(true);\n";
  const sourcePath = join(root, "sample.mjs");
  await writeFile(sourcePath, source);
  const zeroStart = source.indexOf("  return 2;");
  const payload = {
    result: [{
      url: pathToFileURL(sourcePath).href,
      functions: [
        { ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
        { ranges: [
          { startOffset: 0, endOffset: source.length, count: 1 },
          { startOffset: zeroStart, endOffset: zeroStart + "  return 2;".length, count: 0 },
        ] },
      ],
    }],
  };
  await writeFile(join(input, "coverage.json"), JSON.stringify(payload));
  const output = join(root, "lcov.info");
  execFileSync(process.execPath, ["scripts/v8-coverage-to-lcov.mjs", "--input=" + input, "--out=" + output, "--root=" + root]);
  const lcov = await readFile(output, "utf8");
  expect(lcov).toContain("DA:2,1");
  expect(lcov).toContain("DA:3,0");
});