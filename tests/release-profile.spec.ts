import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

const validator = resolve("scripts/validate-release-profile.mjs");

function run(profilePath: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [validator, "--profile=" + profilePath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return { status: result.status, output: (result.stdout ?? "") + (result.stderr ?? "") };
}

test("release profile validator rejects stale version, unsafe or missing paths, and unknown checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lakda-release-profile-negative-"));
  try {
    const current = JSON.parse(await readFile(resolve("release-profiles/current.json"), "utf8")) as Record<string, unknown>;
    const valid = run(resolve("release-profiles/current.json"));
    expect(valid.status).toBe(0);

    const mutations: Array<{ name: string; value: Record<string, unknown>; pattern: RegExp }> = [
      {
        name: "stale-version",
        value: { ...current, releaseVersion: "9.9.9-rc.1" },
        pattern: /does not match package version/,
      },
      {
        name: "path-traversal",
        value: {
          ...current,
          designInputs: {
            ...(current.designInputs as Record<string, unknown>),
            featureSpec: "../outside.json",
          },
        },
        pattern: /schema validation failed|not portable/,
      },
      {
        name: "missing-reference",
        value: {
          ...current,
          designInputs: {
            ...(current.designInputs as Record<string, unknown>),
            featureSpec: "release-profiles/0.4.0-rc.2/missing.json",
          },
        },
        pattern: /does not exist/,
      },
      {
        name: "unknown-check",
        value: {
          ...current,
          requiredChecks: [...(current.requiredChecks as string[]), "unknown:check"],
        },
        pattern: /schema validation failed/,
      },
    ];

    for (const mutation of mutations) {
      const path = join(directory, mutation.name + ".json");
      await writeFile(path, JSON.stringify(mutation.value), "utf8");
      const result = run(path);
      expect(result.status, mutation.name).not.toBe(0);
      expect(result.output, mutation.name).toMatch(mutation.pattern);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
