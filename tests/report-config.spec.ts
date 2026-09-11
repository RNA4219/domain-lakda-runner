import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveReportConfig } from "../src/reporting/config.js";
import { parseCliArgs } from "../src/cli/parser.js";

test("report output language defaults to Japanese and CLI overrides saved language", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lakda-report-language-"));
  try {
    expect(await resolveReportConfig({}, cwd)).toHaveProperty("language", "ja");
    await writeFile(join(cwd, "lakda.report.json"), JSON.stringify({ schemaVersion: "lakda/report-config/v1", language: "en" }));
    expect(await resolveReportConfig({}, cwd)).toHaveProperty("language", "en");
    expect(await resolveReportConfig({ "report-language": "ja" }, cwd)).toHaveProperty("language", "ja");
    for (const language of ["", "fr", "EN", true]) {
      await expect(resolveReportConfig({ "report-language": language }, cwd)).rejects.toMatchObject({ issueCode: "invalid-config" });
      await writeFile(join(cwd, "lakda.report.json"), JSON.stringify({ schemaVersion: "lakda/report-config/v1", language }));
      await expect(resolveReportConfig({}, cwd)).rejects.toMatchObject({ issueCode: "invalid-config" });
      await writeFile(join(cwd, "lakda.report.json"), JSON.stringify({ schemaVersion: "lakda/report-config/v1", language: "en" }));
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("report language is accepted once for generation and each automatic command", () => {
  for (const command of [["report", "generate"], ["run"], ["replay"], ["explore", "run"], ["explore", "resume"]]) {
    expect(parseCliArgs([...command, "--report-language", "en"]).flags["report-language"]).toBe("en");
    expect(() => parseCliArgs([...command, "--report-language", "en", "--report-language", "ja"])).toThrow();
  }
  expect(() => parseCliArgs(["report", "verify", "--report-language", "en"])).toThrow();
});

test("report config defaults and CLI precedence leave target config independent", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lakda-report-config-"));
  try {
    expect(await resolveReportConfig({}, cwd)).toEqual({ schemaVersion: "lakda/report-config/v1", auto: "html", outputRoot: join(cwd, ".lakda/reports"), profile: "local", language: "ja", timeoutMs: 120_000 });
    await writeFile(join(cwd, "lakda.config.json"), '{"reporting":"target config is not read"}');
    await mkdir(join(cwd, "settings"));
    await writeFile(join(cwd, "settings/report.json"), JSON.stringify({ schemaVersion: "lakda/report-config/v1", auto: "off", outputRoot: "./reports", profile: "share", timeoutMs: 10_000, trustStorePath: "trust.json" }));
    const config = await resolveReportConfig({ "report-config": "settings/report.json", report: "html", "report-dir": "./cli-output", "report-profile": "local" }, cwd);
    expect(config).toMatchObject({ auto: "html", outputRoot: join(cwd, "cli-output"), profile: "local", timeoutMs: 10_000, trustStorePath: join(cwd, "settings/trust.json") });
    expect((await resolveReportConfig({ "report-config": "settings/report.json" }, cwd)).outputRoot).toBe(join(cwd, "settings/reports"));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("explicit missing config, unknown fields and invalid timeout/profile fail before execution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lakda-report-config-"));
  try {
    await expect(resolveReportConfig({ "report-config": "absent.json" }, cwd)).rejects.toThrow(/設定/);
    for (const extra of [{ timeoutMs: 9_999 }, { timeoutMs: 600_001 }, { timeoutMs: "120000" }, { auto: "yes" }, { profile: "public" }, { unknown: true }]) {
      await writeFile(join(cwd, "lakda.report.json"), JSON.stringify({ schemaVersion: "lakda/report-config/v1", ...extra }));
      await expect(resolveReportConfig({}, cwd)).rejects.toThrow(/設定/);
    }
    await writeFile(join(cwd, "lakda.report.json"), JSON.stringify({ schemaVersion: "lakda/report-config/v1", timeoutMs: 600_000 }));
    expect((await resolveReportConfig({}, cwd)).timeoutMs).toBe(600_000);
    await expect(resolveReportConfig({ report: "yes" }, cwd)).rejects.toThrow(/設定/);
    await expect(resolveReportConfig({ "report-profile": "public" }, cwd)).rejects.toThrow(/設定/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("invalid UTF-8 and a dangling default configuration reference are not treated as defaults", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lakda-report-config-"));
  try {
    const path = join(cwd, "lakda.report.json");
    await writeFile(path, Buffer.concat([Buffer.from('{"schemaVersion":"lakda/report-config/v1","outputRoot":"'), Buffer.from([255]), Buffer.from('"}')]));
    await expect(resolveReportConfig({}, cwd)).rejects.toMatchObject({ issueCode: "invalid-config" });
    await rm(path);
    await symlink(join(cwd, "missing"), path, "junction");
    await expect(resolveReportConfig({}, cwd)).rejects.toMatchObject({ issueCode: "invalid-config" });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
