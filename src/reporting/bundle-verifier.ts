import { lstat, opendir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { assertReportSchema, REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { REPORT_FILES, renderReportDocument } from "./bundle-format.js";
import { serializeReportData } from "./projection-values.js";
import { reportTimestamp } from "./source-values.js";
import { assertReportViewSemantics } from "./view-validation.js";
import type { ReportBundleManifest, ReportView } from "./types.js";

const invalid = () => new ReportInputError("invalid-bundle", "レポート一式のschema・参照・bytesが一致しません");
const decode = (bytes: Buffer) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

async function inventory(root: string, expected: Set<string>, signal?: AbortSignal): Promise<void> {
  const seen = new Set<string>();
  const visit = async (prefix: string): Promise<void> => {
    signal?.throwIfAborted();
    const directory = await opendir(join(root, prefix));
    for await (const entry of directory) {
      signal?.throwIfAborted();
      const ref = prefix + entry.name;
      const path = join(root, ref);
      if (entry.isSymbolicLink() || await realpath(path) !== path) throw invalid();
      if (entry.isDirectory() && ref === "assets") { await visit("assets/"); continue; }
      if (!entry.isFile() || !expected.has(ref) || seen.has(ref)) throw invalid();
      seen.add(ref);
    }
  };
  await visit("");
  if (seen.size !== expected.size) throw invalid();
}

export type VerifiedReportBundle = { view: ReportView; manifest: ReportBundleManifest; manifestSha256: string; fileCount: number; totalBytes: number };

/** Checks the portable bundle, not current input artifacts, signatures or an external gate. */
export async function verifyReportBundle(reportDir: string, signal?: AbortSignal): Promise<VerifiedReportBundle> {
  signal?.throwIfAborted();
  try {
    const requested = resolve(reportDir);
    const before = await lstat(requested);
    if (!before.isDirectory() || before.isSymbolicLink()) throw invalid();
    const root = await realpath(requested);
    const manifestSnapshot = await readArtifactSnapshot(root, REPORT_FILES.manifest, { retain: true, maxBytes: REPORT_LIMITS.textBytes, signal });
    const parsed: unknown = JSON.parse(decode(manifestSnapshot.bytes!));
    assertReportSchema("bundle-manifest", parsed);
    const manifest = parsed as ReportBundleManifest;
    if (reportTimestamp(manifest.generatedAt) !== manifest.generatedAt || reportTimestamp(manifest.verification.inputVerifiedAt) !== manifest.verification.inputVerifiedAt) throw invalid();
    const files = new Map(manifest.files.map(file => [file.path, file]));
    const core: string[] = [REPORT_FILES.html, REPORT_FILES.data, REPORT_FILES.css, REPORT_FILES.js];
    if (files.size !== manifest.files.length || core.some(ref => !files.has(ref)) || files.has(REPORT_FILES.manifest)) throw invalid();
    let totalBytes = manifestSnapshot.size;
    for (const file of files.values()) {
      if (!core.includes(file.path) && !/^assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|webm|mp4|zip)$/.test(file.path)) throw invalid();
      const limit = file.path.startsWith("assets/") ? REPORT_LIMITS.mediaBytes : file.path === REPORT_FILES.data ? REPORT_LIMITS.viewBytes : REPORT_LIMITS.textBytes;
      totalBytes += file.size;
      if (!Number.isSafeInteger(file.size) || file.size > limit || totalBytes > REPORT_LIMITS.bundleBytes) throw invalid();
    }
    const expected = new Set([...files.keys(), REPORT_FILES.manifest]);
    await inventory(root, expected, signal);
    const text = new Map<string, string>();
    for (const file of files.values()) {
      const retain = file.path === REPORT_FILES.html || file.path === REPORT_FILES.data;
      const snapshot = await readArtifactSnapshot(root, file.path, { retain, expected: file, maxBytes: file.size, signal });
      if (retain) text.set(file.path, decode(snapshot.bytes!));
    }
    const data = text.get(REPORT_FILES.data)!;
    const view: unknown = JSON.parse(data);
    assertReportViewSemantics(view);
    if (data !== serializeReportData(view) || text.get(REPORT_FILES.html) !== renderReportDocument(view) || manifest.viewSha256 !== files.get(REPORT_FILES.data)!.sha256) throw invalid();
    for (const key of ["reportId", "producerVersion", "profile", "classification", "generatedAt"] as const) if (manifest[key] !== view[key]) throw invalid();
    if (serializeReportData(manifest.sources) !== serializeReportData(view.sources)) throw invalid();
    const excluded = view.media.filter(item => item.verification === "excluded").map(item => ({ id: item.id, reason: item.reason! }));
    if (serializeReportData(manifest.excludedMedia) !== serializeReportData(excluded)) throw invalid();
    const assets = new Set(view.media.filter(item => item.path !== null).map(item => item.path!));
    if ([...assets].some(ref => !files.has(ref)) || [...files.keys()].some(ref => !core.includes(ref) && !assets.has(ref))) throw invalid();
    await readArtifactSnapshot(root, REPORT_FILES.manifest, { expected: manifestSnapshot, maxBytes: manifestSnapshot.size, signal });
    await inventory(root, expected, signal);
    const after = await lstat(requested);
    if (after.dev !== before.dev || after.ino !== before.ino || after.isSymbolicLink() || await realpath(requested) !== root) throw invalid();
    signal?.throwIfAborted();
    return { view, manifest, manifestSha256: manifestSnapshot.sha256, fileCount: expected.size, totalBytes };
  } catch (error) {
    signal?.throwIfAborted();
    const code = (error as NodeJS.ErrnoException).code;
    if (code && ["EACCES", "EPERM", "EIO", "EMFILE", "ENFILE", "ENOMEM"].includes(code)) throw error;
    throw invalid();
  }
}
