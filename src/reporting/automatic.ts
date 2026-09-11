import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { LAKDA_VERSION } from "../index.js";
import type { ReportConfig } from "./contracts.js";
import { createReportReceipt, generateReport, rejectReport } from "./generation.js";
import { writeReportReceipt } from "./receipt-writer.js";
import type { ReportSourceSelector } from "./source-index.js";

/** CLI post-processing only. Every failure is reported independently of the execution result. */
export async function generateAutomaticReport(config: ReportConfig, input: ReportSourceSelector | ((signal: AbortSignal) => Promise<ReportSourceSelector>)): Promise<void> {
  if (config.auto === "off") return;
  const output = join(config.outputRoot, "report-" + randomUUID());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("automatic report deadline")), config.timeoutMs);
  let receipt = createReportReceipt(LAKDA_VERSION, config.profile);
  let receiptPath: string | null = null;
  let selector: ReportSourceSelector | undefined;
  try {
    selector = typeof input === "function" ? await input(controller.signal) : input;
    const result = await generateReport(selector, { output, producerVersion: LAKDA_VERSION, profile: config.profile, language: config.language, timeoutMs: config.timeoutMs, signal: controller.signal, trustStorePath: config.trustStorePath });
    receipt = result.receipt;
    if (controller.signal.aborted && receipt.generationStatus === "error") receipt.issues = [{ code: "generation-timeout", severity: "error", sourceId: null, message: "レポート生成が制限時間を超えました" }];
    if (result.sourceRoots) {
      try {
        await writeReportReceipt(output, receipt, result.sourceRoots, controller.signal);
        receiptPath = join(config.outputRoot, receipt.reportId + ".receipt.json");
      } catch { console.error("生成receiptをfileへ保存できませんでした。stderrのreceiptを確認してください。"); }
    }
  } catch (error) {
    receipt = rejectReport(receipt, error).receipt;
    if (controller.signal.aborted) receipt.issues = [{ code: "generation-timeout", severity: "error", sourceId: null, message: "レポート生成が制限時間を超えました" }];
  }
  finally { clearTimeout(timer); }
  console.error(JSON.stringify({ report: receipt, directory: receipt.output ? output : null, receiptPath, sourcesPath: selector?.sources ?? null }));
}
