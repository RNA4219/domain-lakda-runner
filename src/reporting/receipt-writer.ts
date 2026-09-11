import { open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { findSensitive } from "../core/redaction.js";
import { assertReportSchema, REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { reserveReportOutput } from "./output-transaction.js";
import { serializeReportData } from "./projection-values.js";
import type { ReportReceipt } from "./types.js";

/** Receipts live beside the output directory; a failed output cannot authorize writes inside inputs. */
export async function writeReportReceipt(outputDirectory: string, receipt: ReportReceipt, sourceRoots: string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  assertReportSchema("receipt", receipt);
  if (!/^report-[a-f0-9-]{36}$/.test(receipt.reportId)) throw new ReportInputError("invalid-receipt", "receipt IDが不正です");
  const text = serializeReportData(receipt) + "\n";
  if (Buffer.byteLength(text) > REPORT_LIMITS.textBytes || findSensitive(text).length) throw new ReportInputError("invalid-receipt", "receiptの容量または秘密値検査に失敗しました");
  const output = join(dirname(resolve(outputDirectory)), receipt.reportId + ".receipt.json");
  const transaction = await reserveReportOutput(output, sourceRoots, signal);
  try {
    const file = await open(join(transaction.stage, "receipt.json"), "wx");
    try { await file.writeFile(text, { encoding: "utf8", signal }); }
    finally { await file.close(); }
    await transaction.publishFile("receipt.json");
  } finally { await transaction.dispose(); }
}
