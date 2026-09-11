import { LAKDA_VERSION } from "../index.js";
import { stringFlag, type Flags } from "../cli/parser.js";
import { verifyReportBundle } from "../reporting/bundle-verifier.js";
import { resolveReportConfig } from "../reporting/config.js";
import { ReportInputError } from "../reporting/contracts.js";
import { createReportReceipt, generateReport, rejectReport, type ReportGenerationResult } from "../reporting/generation.js";
import { writeReportReceipt } from "../reporting/receipt-writer.js";

function required(flags: Flags, key: string): string {
  const value = stringFlag(flags, key);
  if (!value) throw new ReportInputError("invalid-arguments", "--" + key + " を指定してください");
  return value;
}

export async function generateReportCommand(flags: Flags): Promise<number> {
  let result: ReportGenerationResult;
  let output: string | undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    output = required(flags, "out");
    const config = await resolveReportConfig({ ...flags, ...(flags.profile !== undefined ? { "report-profile": flags.profile } : {}) });
    timer = setTimeout(() => controller.abort(new Error("standalone report deadline")), config.timeoutMs);
    result = await generateReport({ ...(flags["run-dir"] !== undefined ? { runDir: required(flags, "run-dir") } : {}), ...(flags.session !== undefined ? { session: required(flags, "session") } : {}), ...(flags.sources !== undefined ? { sources: required(flags, "sources") } : {}) }, { output, producerVersion: LAKDA_VERSION, profile: config.profile, language: config.language, timeoutMs: config.timeoutMs, textOnly: flags["text-only"] === true, trustStorePath: config.trustStorePath, signal: controller.signal });
    if (controller.signal.aborted && result.receipt.generationStatus === "error") result.receipt.issues = [{ code: "generation-timeout", severity: "error", sourceId: null, message: "レポート生成が制限時間を超えました" }];
  } catch (error) { result = rejectReport(createReportReceipt(LAKDA_VERSION), error, true); }
  try {
    if (output && result.sourceRoots) {
      try { await writeReportReceipt(output, result.receipt, result.sourceRoots, controller.signal); }
      catch { console.error("生成receiptをfileへ保存できませんでした。stdoutのreceiptを確認してください。"); }
    }
    console.log(JSON.stringify(result.receipt, null, 2));
    return result.exitCode;
  } finally { if (timer) clearTimeout(timer); }
}

export async function verifyReportCommand(flags: Flags): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("report verification deadline")), 120_000);
  try {
    const result = await verifyReportBundle(required(flags, "report-dir"), controller.signal);
    console.log(JSON.stringify({ valid: true, scope: "report-bundle-files", reportId: result.manifest.reportId, manifestSha256: result.manifestSha256, fileCount: result.fileCount, totalBytes: result.totalBytes }, null, 2));
    return 0;
  } catch (error) {
    const input = error instanceof ReportInputError;
    console.log(JSON.stringify({ valid: false, scope: "report-bundle-files", issue: { code: controller.signal.aborted ? "verification-timeout" : input ? error.issueCode : "verification-error", message: input ? error.message : "レポート一式の検証を完了できませんでした" } }, null, 2));
    return input ? 2 : 1;
  } finally { clearTimeout(timer); }
}

/** Node argument parsing can fail before a flags object exists. Keep new-command output structured. */
export function rejectReportArguments(command: "generate" | "verify"): number {
  if (command === "generate") {
    const result = rejectReport(createReportReceipt(LAKDA_VERSION), new ReportInputError("invalid-arguments", "report generateの引数が不正です。optionの重複・未知option・値を確認してください"));
    console.log(JSON.stringify(result.receipt, null, 2));
  } else console.log(JSON.stringify({ valid: false, scope: "report-bundle-files", issue: { code: "invalid-arguments", message: "report verifyの引数が不正です" } }, null, 2));
  return 2;
}
