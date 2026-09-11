import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { writeReportBundle } from "./bundle-writer.js";
import { assertReportSchema, REPORT_LIMITS, ReportInputError, type ReportProfile, type ReportLanguage } from "./contracts.js";
import { selectReportMedia } from "./media-policy.js";
import { verifyReportMediaProofs } from "./media-proof.js";
import { prepareReportEvidenceLinks } from "./evidence-links.js";
import { cleanReportText } from "./projection-values.js";
import { getReportRenderer } from "./renderer.js";
import { loadReportSourceCollection } from "./source-collection.js";
import { resolveReportSources, type ReportSourceSelector } from "./source-index.js";
import { verifyReportSourceIndex, verifyReportSourcesUnchanged } from "./source-verifier.js";
import { buildReportView } from "./view-builder.js";
import { loadReportTrustStore, verifyReportTrustStoreUnchanged } from "./trust-store.js";
import type { ReportReceipt } from "./types.js";

export type ReportGenerationOptions = { output: string; producerVersion: string; profile: ReportProfile; language?: ReportLanguage; timeoutMs: number; textOnly?: boolean; signal?: AbortSignal; trustStorePath?: string };
export type ReportGenerationResult = { receipt: ReportReceipt; exitCode: 0 | 1 | 2; sourceRoots?: string[] };

export function createReportReceipt(producerVersion: string, profile: ReportProfile = "local"): ReportReceipt {
  const at = new Date().toISOString();
  return { schemaVersion: "lakda/report-receipt/v1", reportId: "report-" + randomUUID(), generationStatus: "error", profile, sourceIds: [], issues: [], output: null, startedAt: at, endedAt: at, producerVersion, manifestSha256: null, workDir: null };
}

export function rejectReport(receipt: ReportReceipt, error: unknown, input = false): ReportGenerationResult {
  receipt.generationStatus = "error"; receipt.output = null; receipt.manifestSha256 = null; receipt.endedAt = new Date().toISOString();
  const known = error instanceof ReportInputError;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  const io = code && ["EACCES", "EPERM", "EIO", "EMFILE", "ENFILE", "ENOMEM", "ENOSPC", "EROFS"].includes(code);
  receipt.issues = [{ code: known ? error.issueCode : input && !io ? "invalid-source" : "generation-error", severity: "error", sourceId: null, message: known ? cleanReportText(error.message) : input && !io ? "入力のschema・参照・保存内容を検証できません" : "レポート生成を完了できませんでした" }];
  assertReportSchema("receipt", receipt);
  return { receipt, exitCode: known || input && !io ? 2 : 1 };
}

/** Shared by standalone and post-run commands; it never calls a target or changes inputs. */
export async function generateReport(selector: ReportSourceSelector, options: ReportGenerationOptions): Promise<ReportGenerationResult> {
  const receipt = createReportReceipt(options.producerVersion, options.profile);
  const timeout = new AbortController();
  const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let phase: "input" | "output" = "input";
  let sourceRoots: string[] | undefined;
  try {
    if (options.language !== undefined && options.language !== "ja" && options.language !== "en") throw new ReportInputError("invalid-config", "レポート言語はjaまたはenで指定してください");
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10_000 || options.timeoutMs > 600_000) throw new ReportInputError("invalid-config", "生成timeoutは10,000〜600,000msで指定してください");
    if (!options.output || cleanReportText(basename(options.output)) !== basename(options.output)) throw new ReportInputError("invalid-output", "出力directory名が不正です");
    timer = setTimeout(() => timeout.abort(new Error("report generation deadline")), options.timeoutMs);
    signal.throwIfAborted();
    const selection = await resolveReportSources(selector, signal);
    sourceRoots = [...new Set([...(selection.protectedRoots ?? []), ...selection.entries.map(entry => entry.root)])];
    const trust = options.trustStorePath ? await loadReportTrustStore(options.trustStorePath, signal) : undefined;
    if (trust) sourceRoots.push(trust.snapshot.path, trust.requestedPath);
    const collection = await loadReportSourceCollection(selection, signal, trust);
    if (trust) { collection.textBytes += trust.snapshot.size; collection.artifactBytes += trust.snapshot.size; }
    if (collection.textBytes > REPORT_LIMITS.textBytes || collection.artifactBytes > REPORT_LIMITS.artifactBytes) throw new ReportInputError("input-byte-limit", "鍵一覧を含む入力集合の容量上限を超えています");
    sourceRoots = [...new Set([...sourceRoots, ...collection.snapshots.map(snapshot => snapshot.root)])];
    receipt.sourceIds = collection.explicitSourceIds;
    const proof = await verifyReportMediaProofs(collection, trust, signal);
    const evidence = prepareReportEvidenceLinks(collection, proof.replacements);
    const inputVerifiedAt = new Date().toISOString();
    const candidates = [...collection.runs, ...collection.sessions].flatMap(input => input.mediaCandidates).map(candidate => ({ ...candidate, artifact: { ...candidate.artifact, classification: evidence.classifications.get(candidate.id) ?? candidate.artifact.classification } }));
    const selected = await selectReportMedia(candidates, { profile: options.profile, textOnly: options.textOnly, signal, verifiedIds: proof.verifiedIds, proofs: proof.proofs });
    const view = buildReportView(collection, { reportId: receipt.reportId, generatedAt: new Date().toISOString(), producerVersion: options.producerVersion, profile: options.profile, media: selected.media, issues: proof.issues, evidence });
    view.language = options.language ?? "ja";
    phase = "output";
    const result = await writeReportBundle({ output: options.output, view, copies: selected.copies, renderer: getReportRenderer(), sourceRoots, inputVerifiedAt, signal,
      verifyInputs: async () => { await verifyReportSourceIndex(selection, signal); await verifyReportSourcesUnchanged(collection, signal); if (trust) await verifyReportTrustStoreUnchanged(trust, signal); } });
    receipt.generationStatus = view.generationStatus; receipt.issues = view.issues; receipt.output = basename(result.output) + "/index.html"; receipt.manifestSha256 = result.manifestSha256; receipt.endedAt = new Date().toISOString();
    assertReportSchema("receipt", receipt);
    return { receipt, exitCode: view.generationStatus === "ready" ? 0 : 2, sourceRoots };
  } catch (error) {
    const result = rejectReport(receipt, signal.aborted ? new Error("generation stopped") : error, !signal.aborted && phase === "input");
    const workDir = (error as { reportWorkDir?: unknown } | null)?.reportWorkDir;
    if (typeof workDir === "string" && /^\.lakda-report-stage-[a-zA-Z0-9]+$/.test(workDir)) result.receipt.workDir = workDir;
    if (signal.aborted) result.receipt.issues[0] = { code: timeout.signal.aborted ? "generation-timeout" : "generation-aborted", severity: "error", sourceId: null, message: timeout.signal.aborted ? "レポート生成が制限時間を超えました" : "レポート生成を中止しました" };
    return { ...result, ...(sourceRoots ? { sourceRoots } : {}) };
  } finally { if (timer) clearTimeout(timer); }
}
