import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveReportSources } from "../src/reporting/source-index.js";
import { verifyReportSourceIndex } from "../src/reporting/source-verifier.js";

test("explicit source index resolves file-relative roots, deduplicates paths and never writes inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-sources-"));
  try {
    await mkdir(join(root, "runs/first"), { recursive: true });
    const input = join(root, "sources.json");
    const original = JSON.stringify({ schemaVersion: "lakda/report-sources/v1", root: "runs", entries: [{ kind: "run", path: "first" }, { kind: "run", path: "first" }] });
    await writeFile(input, original);
    const result = await resolveReportSources({ sources: input });
    expect(result.entries).toEqual([{ kind: "run", root: join(root, "runs/first") }]);
    expect(result.duplicatePaths).toBe(1);
    expect(await readFile(input, "utf8")).toBe(original);
    expect((await resolveReportSources({ runDir: join(root, "runs/first") })).entries).toEqual(result.entries);
    await expect(verifyReportSourceIndex(result)).resolves.toBeUndefined();
    await writeFile(input, original + " ");
    await expect(verifyReportSourceIndex(result)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("source selection rejects incompatible inputs, unknown versions and root escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-sources-"));
  try {
    await mkdir(join(root, "runs"));
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, "runs/link"), "junction");
    await expect(resolveReportSources({})).rejects.toThrow(/1つ/);
    await expect(resolveReportSources({ runDir: root, session: root })).rejects.toThrow(/1つ/);
    for (const path of ["../outside", "link", join(root, "outside")]) {
      await writeFile(join(root, "sources.json"), JSON.stringify({ schemaVersion: "lakda/report-sources/v1", root: "runs", entries: [{ kind: "run", path }] }));
      await expect(resolveReportSources({ sources: join(root, "sources.json") })).rejects.toThrow();
    }
    await writeFile(join(root, "sources.json"), JSON.stringify({ schemaVersion: "lakda/report-sources/v99", root: "runs", entries: [] }));
    await expect(resolveReportSources({ sources: join(root, "sources.json") })).rejects.toThrow(/schema/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
