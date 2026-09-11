import { lstat, open } from "node:fs/promises";
import { extname } from "node:path";
import { secureArtifactFile } from "../runs/catalog-values.js";
import { ReportInputError } from "./contracts.js";
import type { ReportMediaCandidate } from "./run-source.js";
import type { ReportMedia } from "./types.js";

type MediaFormat = { kind: ReportMedia["kind"]; extension: string | null; sequence: number | null };

export function mediaFormatHint(path: string): MediaFormat {
  const extension = extname(path).toLowerCase().slice(1);
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) {
    const frame = /^artifacts\/frames\/frame-(\d+)\.(?:png|jpe?g)$/i.exec(path);
    const sequence = frame ? Number(frame[1]) : null;
    if (sequence !== null && !Number.isSafeInteger(sequence)) return { kind: "unsupported", extension: null, sequence: null };
    return { kind: frame ? "sampled-frame" : "screenshot", extension: extension === "jpeg" ? "jpg" : extension, sequence };
  }
  if (["webm", "mp4"].includes(extension)) return { kind: "video", extension, sequence: null };
  if (extension === "zip") return { kind: "trace", extension, sequence: null };
  return { kind: "unsupported", extension: null, sequence: null };
}

/** Container signature only; browser decode errors remain visible in the viewer. */
export async function inspectMediaFormat(candidate: ReportMediaCandidate, signal?: AbortSignal): Promise<MediaFormat> {
  signal?.throwIfAborted();
  const hint = mediaFormatHint(candidate.artifact.path);
  if (!hint.extension) return hint;
  const path = await secureArtifactFile(candidate.root, candidate.artifact.path);
  const changed = () => new ReportInputError("source-not-finalized", "媒体の更新を検出しました");
  if (path !== candidate.snapshot.path) throw changed();
  const file = await open(path, "r");
  let header: Buffer;
  try {
    const before = await file.stat();
    if (before.size !== candidate.snapshot.size || !before.isFile()) throw changed();
    header = Buffer.alloc(Math.min(before.size, 512));
    let offset = 0;
    while (offset < header.length) {
      signal?.throwIfAborted();
      const result = await file.read(header, offset, header.length - offset, offset);
      if (!result.bytesRead) throw changed();
      offset += result.bytesRead;
    }
    const after = await file.stat();
    const current = await lstat(path);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || await secureArtifactFile(candidate.root, candidate.artifact.path) !== path) throw changed();
  } finally { await file.close(); }
  signal?.throwIfAborted();
  const starts = (...bytes: number[]) => bytes.every((byte, index) => header[index] === byte);
  const ascii = (start: number, end: number) => header.toString("ascii", start, end);
  const supported = hint.extension === "png" ? starts(137, 80, 78, 71, 13, 10, 26, 10)
    : hint.extension === "jpg" ? starts(255, 216, 255)
      : hint.extension === "gif" ? ["GIF87a", "GIF89a"].includes(ascii(0, 6))
        : hint.extension === "webp" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
          : hint.extension === "webm" ? starts(0x1a, 0x45, 0xdf, 0xa3) && header.includes(Buffer.from("webm"))
            : hint.extension === "mp4" ? ascii(4, 8) === "ftyp" && /(?:isom|iso[2-9]|avc1|mp4[12]|M4V |dash)/.test(ascii(8, 64))
              : hint.extension === "zip" && (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06));
  return supported ? hint : { kind: "unsupported", extension: null, sequence: null };
}
