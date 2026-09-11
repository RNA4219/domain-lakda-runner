import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { isContained, secureArtifactFile } from "../runs/catalog-values.js";
import { REPORT_LIMITS, ReportInputError } from "./contracts.js";
import type { MediaCopy } from "./media-policy.js";
import type { ReportBundleManifest } from "./types.js";

type BundleFile = ReportBundleManifest["files"][number];

async function copyOne(copy: MediaCopy, outputRoot: string, signal?: AbortSignal): Promise<BundleFile> {
  signal?.throwIfAborted();
  const { candidate } = copy;
  const root = await realpath(candidate.root);
  if (isContained(root, outputRoot) || isContained(outputRoot, root)) throw new ReportInputError("output-overlap", "媒体の出力先が入力と重なっています");
  if (!/^assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|webm|mp4|zip)$/.test(copy.path)) throw new ReportInputError("invalid-output-path", "媒体の出力参照が不正です");
  if (candidate.snapshot.size > REPORT_LIMITS.mediaBytes) throw new ReportInputError("media-byte-limit", "媒体の容量上限を超えています");
  const sourcePath = await secureArtifactFile(root, candidate.artifact.path);
  const changed = () => new ReportInputError("source-not-finalized", "コピー中に媒体の更新または不一致を検出しました");
  if (sourcePath !== candidate.snapshot.path) throw changed();
  const assets = join(outputRoot, "assets");
  try { await mkdir(assets); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const parent = await lstat(assets);
  if (!parent.isDirectory() || parent.isSymbolicLink() || await realpath(assets) !== assets) throw new ReportInputError("output-escape", "媒体出力directoryが変更されています");
  signal?.throwIfAborted();
  const source = await open(sourcePath, "r");
  try {
    const before = await source.stat();
    if (!before.isFile() || before.size !== candidate.snapshot.size) throw changed();
    signal?.throwIfAborted();
    const destination = await open(join(outputRoot, copy.path), "wx");
    const hash = createHash("sha256");
    let size = 0;
    try {
      const buffer = Buffer.allocUnsafe(65_536);
      while (true) {
        signal?.throwIfAborted();
        const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > candidate.snapshot.size || size > REPORT_LIMITS.mediaBytes) throw changed();
        hash.update(buffer.subarray(0, bytesRead));
        let offset = 0;
        while (offset < bytesRead) {
          signal?.throwIfAborted();
          const { bytesWritten } = await destination.write(buffer, offset, bytesRead - offset, null);
          if (!bytesWritten) throw new Error("媒体を完全に保存できません");
          offset += bytesWritten;
        }
      }
      signal?.throwIfAborted();
    } finally { await destination.close(); }
    const digest = "sha256:" + hash.digest("hex");
    const after = await source.stat();
    const current = await lstat(sourcePath);
    if (size !== candidate.snapshot.size || digest !== candidate.snapshot.sha256 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.dev !== before.dev || current.ino !== before.ino || await secureArtifactFile(root, candidate.artifact.path) !== sourcePath) throw changed();
    return { path: copy.path, size, sha256: digest };
  } finally { await source.close(); }
}

/** Writes only caller-owned staging files and awaits every read/write/close before returning. */
export async function copyReportMedia(copies: MediaCopy[], outputDirectory: string, signal?: AbortSignal): Promise<BundleFile[]> {
  signal?.throwIfAborted();
  const outputRoot = await realpath(outputDirectory);
  const files: BundleFile[] = [];
  let size = 0;
  const destinations = new Set<string>();
  // Check every source before the first write; a later source may contain the output root.
  for (const copy of copies) {
    signal?.throwIfAborted();
    const sourceRoot = await realpath(copy.candidate.root);
    if (isContained(sourceRoot, outputRoot) || isContained(outputRoot, sourceRoot)) throw new ReportInputError("output-overlap", "媒体の出力先が入力と重なっています");
    if (destinations.has(copy.path)) throw new ReportInputError("duplicate-media", "媒体の出力参照が重複しています");
    destinations.add(copy.path);
    size += copy.candidate.snapshot.size;
    if (size > REPORT_LIMITS.bundleBytes) throw new ReportInputError("bundle-byte-limit", "媒体合計の容量上限を超えています");
  }
  for (const copy of copies) {
    const file = await copyOne(copy, outputRoot, signal);
    await readArtifactSnapshot(outputRoot, file.path, { expected: file, maxBytes: file.size, signal });
    files.push(file);
  }
  signal?.throwIfAborted();
  return files;
}
