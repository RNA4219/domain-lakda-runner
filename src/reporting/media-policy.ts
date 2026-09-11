import { sha256 } from "../core/redaction.js";
import { REPORT_LIMITS, ReportInputError, type ReportProfile } from "./contracts.js";
import { inspectMediaFormat, mediaFormatHint } from "./media-format.js";
import type { ReportMediaCandidate } from "./run-source.js";
import type { Classification, ReportMedia, ReportMediaProof } from "./types.js";

export type MediaCopy = { candidate: ReportMediaCandidate; path: string };
type MediaOptions = {
  profile: ReportProfile; textOnly?: boolean; signal?: AbortSignal;
  /** Only IDs returned by the trusted attestation verifier; HATE scan flags alone do not qualify. */
  verifiedIds?: ReadonlySet<string>;
  proofs?: ReadonlyMap<string, ReportMediaProof>;
};

export async function selectReportMedia(candidates: ReportMediaCandidate[], options: MediaOptions): Promise<{ media: ReportMedia[]; copies: MediaCopy[] }> {
  const media: ReportMedia[] = [];
  const copies: MediaCopy[] = [];
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new ReportInputError("duplicate-media", "媒体IDが重複しています");
  let copyBytes = 0;
  for (const candidate of candidates) {
    options.signal?.throwIfAborted();
    const artifact = candidate.artifact;
    const hint = mediaFormatHint(artifact.path);
    const record: ReportMedia = { id: candidate.id, sourceId: candidate.sourceId, runKey: candidate.runKey, kind: hint.kind, sequence: hint.sequence, path: null, classification: artifact.classification as Classification, verification: "excluded", reason: null, scope: "run", recordIds: [] };
    media.push(record);
    const exclude = (reason: string) => { record.reason = reason; };
    if (artifact.classification === "restricted") { record.sequence = null; exclude("restricted-media"); continue; }
    const scans = [artifact.security_checks.secrets_scan, artifact.security_checks.pii_scan];
    if (artifact.public_exposure !== "none" || !["pending", "redacted", "not_required"].includes(artifact.redaction_status) || scans.some(status => !["pass", "not_applicable"].includes(String(status)))) { exclude("artifact-policy-denied"); continue; }
    if (options.textOnly) { exclude("text-only"); continue; }
    if (hint.kind === "trace" && options.profile === "share") { exclude("local-trace-only"); continue; }
    const verified = options.verifiedIds?.has(candidate.id) === true && artifact.redaction_status !== "pending" && scans.every(status => status === "pass");
    if (!verified && options.profile === "share") { exclude("unverified-media"); continue; }
    const format = await inspectMediaFormat(candidate, options.signal);
    record.kind = format.kind;
    record.sequence = format.sequence;
    if (!format.extension) { exclude("unsupported-media"); continue; }
    if (candidate.snapshot.size > REPORT_LIMITS.mediaBytes) throw new ReportInputError("media-byte-limit", "媒体の容量上限を超えています。text-onlyで再生成できます");
    copyBytes += candidate.snapshot.size;
    if (copyBytes > REPORT_LIMITS.bundleBytes) throw new ReportInputError("bundle-byte-limit", "媒体合計の容量上限を超えています。text-onlyで再生成できます");
    record.path = "assets/" + sha256(candidate.id) + "." + format.extension;
    record.verification = verified ? "verified" : "pending";
    if (verified && options.proofs?.has(candidate.id)) record.proof = options.proofs.get(candidate.id);
    record.reason = verified ? null : "unverified-media";
    copies.push({ candidate, path: record.path });
  }
  return { media, copies };
}
