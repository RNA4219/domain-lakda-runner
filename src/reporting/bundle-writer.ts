import { open } from "node:fs/promises";
import { basename, join } from "node:path";
import { sha256 } from "../core/redaction.js";
import { REPORT_FILES, renderReportDocument } from "./bundle-format.js";
import { verifyReportBundle } from "./bundle-verifier.js";
import { assertReportSchema, REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { copyReportMedia } from "./media-copy.js";
import type { MediaCopy } from "./media-policy.js";
import { reserveReportOutput } from "./output-transaction.js";
import { serializeReportData } from "./projection-values.js";
import { reportTimestamp } from "./source-values.js";
import { assertReportViewSemantics } from "./view-validation.js";
import type { ReportBundleManifest, ReportView } from "./types.js";

type WriteOptions = {
  output: string; view: ReportView; renderer: { css: string; js: string }; copies: MediaCopy[];
  sourceRoots: string[]; verifyInputs: () => Promise<void>; inputVerifiedAt: string; signal?: AbortSignal;
};

async function writeText(root: string, path: string, text: string, signal?: AbortSignal): Promise<ReportBundleManifest["files"][number]> {
  signal?.throwIfAborted();
  const bytes = Buffer.from(text);
  if (bytes.length > REPORT_LIMITS.textBytes) throw new ReportInputError("output-byte-limit", "レポートtextの容量上限を超えています");
  const file = await open(join(root, path), "wx");
  try {
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const { bytesWritten } = await file.write(bytes, offset, Math.min(65_536, bytes.length - offset), null);
      if (!bytesWritten) throw new Error("レポートを完全に保存できません");
      offset += bytesWritten;
    }
    signal?.throwIfAborted();
  } finally { await file.close(); }
  return { path, size: bytes.length, sha256: "sha256:" + sha256(bytes) };
}

/** Publishes only a verified staging bundle; all in-flight I/O settles before cleanup. */
export async function writeReportBundle(options: WriteOptions) {
  const { view, signal } = options;
  signal?.throwIfAborted();
  assertReportViewSemantics(view);
  const inputVerifiedAt = reportTimestamp(options.inputVerifiedAt);
  const reservation = await reserveReportOutput(options.output, [...options.sourceRoots, ...options.copies.map(copy => copy.candidate.root)], signal);
  const failure = (error: unknown) => Object.assign(error instanceof ReportInputError ? new ReportInputError(error.issueCode, error.message) : new Error(error instanceof Error ? error.message : "レポート保存に失敗しました", { cause: error }), { reportWorkDir: basename(reservation.stage) });
  try {
    const files = await copyReportMedia(options.copies, reservation.stage, signal);
    const text = new Map([[REPORT_FILES.html, renderReportDocument(view)], [REPORT_FILES.data, serializeReportData(view)], [REPORT_FILES.css, options.renderer.css], [REPORT_FILES.js, options.renderer.js]]);
    for (const [path, content] of text) files.push(await writeText(reservation.stage, path, content, signal));
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const manifest: ReportBundleManifest = {
      schemaVersion: "lakda/report-bundle-manifest/v1", reportId: view.reportId, producerVersion: view.producerVersion,
      rendererVersion: "lakda/report-renderer/v1", policyVersion: "lakda/report-policy/v1", profile: view.profile,
      classification: view.classification, generatedAt: view.generatedAt, verification: { scope: "report-bundle-files", inputVerifiedAt },
      sources: view.sources, excludedMedia: view.media.filter(item => item.verification === "excluded").map(item => ({ id: item.id, reason: item.reason! })),
      files, viewSha256: files.find(file => file.path === REPORT_FILES.data)!.sha256,
    };
    assertReportSchema("bundle-manifest", manifest);
    const manifestText = serializeReportData(manifest);
    if (files.reduce((sum, file) => sum + file.size, Buffer.byteLength(manifestText)) > REPORT_LIMITS.bundleBytes) throw new ReportInputError("bundle-byte-limit", "レポート一式の容量上限を超えています");
    await writeText(reservation.stage, REPORT_FILES.manifest, manifestText, signal);
    await options.verifyInputs();
    signal?.throwIfAborted();
    const verified = await verifyReportBundle(reservation.stage, signal);
    await reservation.publish();
    return { ...verified, output: reservation.output };
  } catch (error) { throw failure(error); }
  finally { await reservation.dispose().catch(error => { throw failure(error); }); }
}
