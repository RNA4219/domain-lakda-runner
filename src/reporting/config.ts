import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Flags } from "../cli/parser.js";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { assertReportConfig, ReportInputError, REPORT_LIMITS, type ReportConfig } from "./contracts.js";

export async function resolveReportConfig(flags: Flags, cwd = process.cwd()): Promise<ReportConfig> {
  const explicit = flags["report-config"];
  if (explicit !== undefined && (typeof explicit !== "string" || !explicit)) throw new ReportInputError("invalid-config", "レポート設定fileを指定してください");
  const path = resolve(cwd, explicit ?? "lakda.report.json");
  let input: Partial<ReportConfig> = {};
  let found = false;
  try {
    await lstat(path);
    found = true;
    const actual = await realpath(path);
    const snapshot = await readArtifactSnapshot(dirname(actual), basename(actual), { retain: true, maxBytes: REPORT_LIMITS.textBytes });
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes!));
    assertReportConfig(value);
    input = value;
  } catch (error) {
    if (explicit !== undefined || found || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof ReportInputError) throw error;
      throw new ReportInputError("invalid-config", "レポート設定fileを読み取れません");
    }
  }
  const config: ReportConfig = {
    schemaVersion: "lakda/report-config/v1",
    auto: input.auto ?? "html",
    outputRoot: input.outputRoot ? resolve(dirname(path), input.outputRoot) : resolve(cwd, ".lakda/reports"),
    profile: input.profile ?? "local",
    language: input.language ?? "ja",
    timeoutMs: input.timeoutMs ?? 120_000,
    ...(input.trustStorePath ? { trustStorePath: resolve(dirname(path), input.trustStorePath) } : {}),
  };
  if (flags.report !== undefined) {
    if (flags.report !== "html" && flags.report !== "off") throw new ReportInputError("invalid-config", "レポート設定 --report はhtmlまたはoffで指定してください");
    config.auto = flags.report;
  }
  if (flags["report-dir"] !== undefined) {
    if (typeof flags["report-dir"] !== "string" || !flags["report-dir"]) throw new ReportInputError("invalid-config", "レポート設定 --report-dir に出力rootを指定してください");
    config.outputRoot = resolve(cwd, flags["report-dir"]);
  }
  if (flags["report-profile"] !== undefined) {
    if (flags["report-profile"] !== "local" && flags["report-profile"] !== "share") throw new ReportInputError("invalid-config", "レポート設定 --report-profile はlocalまたはshareで指定してください");
    config.profile = flags["report-profile"];
  }
  if (flags["report-language"] !== undefined) {
    const language = flags["report-language"];
    if (language !== "ja" && language !== "en") throw new ReportInputError("invalid-config", "レポート設定 --report-language はjaまたはenで指定してください");
    config.language = language;
  }
  assertReportConfig(config);
  for (const path of [config.outputRoot, config.trustStorePath]) {
    if (path?.includes("\0")) throw new ReportInputError("invalid-config", "レポート設定pathが不正です");
  }
  return config;
}
