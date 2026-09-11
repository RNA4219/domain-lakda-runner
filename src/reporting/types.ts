import type { ReportProfile } from "./contracts.js";
import type { RunStartRecord } from "../core/run-start.js";

export type Classification = "public" | "internal" | "confidential" | "restricted";
export type GenerationStatus = "ready" | "degraded" | "error";
export type Outcome = "passed" | "failed" | "partial" | "error";
export type ReportIssue = { code: string; severity: "info" | "warning" | "error"; sourceId: string | null; message: string };
export type ReportSource = {
  id: string; kind: "run" | "session" | "batch"; status: "verified" | "unverified" | "restricted";
  manifestSha256: string | null; eventHeadDigest: string | null;
  indexSha256?: string;
  startRecordSha256?: string;
  producerRevision: string | null; targetRevision: string | null; classification: Classification;
};
export type ReportCoverage = {
  name: string; definition: string; scope: string; status: "recorded" | "not-applicable" | "unavailable";
  numerator: number | null; denominator: number | null; ratio: number | null;
};
export type ReportRun = {
  key: string; sourceId: string; runId: string; attempt: number; mode: string; platform: string | null;
  executionMode: string | null; outcome: Outcome; terminationReason: string;
  startedAt: string; endedAt: string; durationMs: number | null; seed: number;
  producerVersion: string; producerRevision: string; targetRevision: string | null;
  acceptanceStatus: string | null; actionCount: number | null; plannedActionCount: number | null; coverage: ReportCoverage[];
};
export type ReportRow = {
  id: string; sourceId: string; runKey: string | null;
  kind: "run" | "worker" | "failure" | "warning" | "finding" | "session" | "promotion";
  status: string; severity: string | null; title: string; message: string; at: string | null;
  ruleId: string | null; relatedIds: string[]; evidenceIds: string[];
  evidenceNotes?: Array<"unavailable" | "not-media">;
};
export type ReportSession = {
  key: string; sourceId: string; sessionId: string; status: "paused" | "completed" | "aborted";
  technicalOutcome: Outcome | null; terminationReason: string | null;
  startedAt: string; endedAt: string; durationMs: number | null; activeDurationMs: number | null;
  platform: string; executionMode: string; seed: number; producerVersion: string | null;
  producerRevision: string; targetRevision: string; acceptanceStatus: string | null;
  actionCount: number; runKeys: string[];
};
export type ReportTimeline = {
  id: string; sourceId: string; runKey: string | null; sequence: number; at: string | null;
  kind: string; label: string; relatedIds: string[]; evidenceIds: string[];
  step?: { operation: string | null; target: string | null; status: string | null; durationMs: number | null; message: string | null };
  evidenceNotes?: Array<"unavailable" | "not-media">;
};
export type ReportMediaProof = {
  decision: "no-sensitive-content" | "sanitized";
  attestationSha256: string; signedPayloadDigest: string; trustStoreSha256: string; keyIdDigest: string; policyDigest: string;
  targetManifestSha256s: string[];
} & ({ schemaVersion: "lakda/binary-artifact-attestation/v1" } | { schemaVersion: "lakda/binary-artifact-attestation/v2"; requestSha256: string; receiptSha256: string });
export type ReportMedia = {
  id: string; sourceId: string; runKey: string | null;
  kind: "screenshot" | "video" | "sampled-frame" | "trace" | "unsupported";
  sequence: number | null;
  path: string | null; classification: Classification; verification: "verified" | "pending" | "excluded";
  reason: string | null; scope: "run" | "record"; recordIds: string[];
  proof?: ReportMediaProof;
};
export type ReportCounts = {
  sources: number; duplicateSources: number; runs: number; workerIncomplete: number;
  failures: number; warnings: number; findings: number; actions: number; events: number; excludedMedia: number;
  plannedActions: number; unknownActionRuns: number;
  incompleteRuns?: number;
  outcomes: Record<Outcome, number>;
};
export type ReportIncompleteRun = Omit<RunStartRecord, "schemaVersion" | "classification"> & { key: string; sourceId: string; status: "unfinalized" };
export type ReportBatch = {
  sourceId: string; batchId: string; recordedAt: string; outcome: Outcome; exitCode: 0 | 1 | 2;
  requestedWorkers: number; completedWorkers: number;
  workers: Array<{ id: string; workerIndex: number; seed: number; status: "completed" | "error"; runKey: string | null; runUnavailable: boolean }>;
};
export type ReportView = {
  language?: "ja" | "en";
  schemaVersion: "lakda/report-view/v1"; reportId: string; generatedAt: string; producerVersion: string;
  profile: ReportProfile; generationStatus: GenerationStatus; classification: Classification; timeZone: "UTC";
  inputSourceIds: string[]; sources: ReportSource[]; runs: ReportRun[]; sessions: ReportSession[]; rows: ReportRow[]; timeline: ReportTimeline[];
  batches?: ReportBatch[];
  incompleteRuns?: ReportIncompleteRun[];
  media: ReportMedia[]; issues: ReportIssue[]; counts: ReportCounts;
};
export type ReportReceipt = {
  schemaVersion: "lakda/report-receipt/v1"; reportId: string; generationStatus: GenerationStatus;
  profile: ReportProfile; sourceIds: string[]; issues: ReportIssue[]; output: string | null;
  startedAt: string; endedAt: string; producerVersion: string; manifestSha256: string | null; workDir: string | null;
};
export type ReportBundleManifest = {
  schemaVersion: "lakda/report-bundle-manifest/v1"; reportId: string; producerVersion: string;
  rendererVersion: "lakda/report-renderer/v1"; policyVersion: "lakda/report-policy/v1";
  profile: ReportProfile; classification: Classification; generatedAt: string;
  verification: { scope: "report-bundle-files"; inputVerifiedAt: string };
  sources: ReportSource[]; excludedMedia: Array<{ id: string; reason: string }>;
  files: Array<{ path: string; size: number; sha256: string }>; viewSha256: string;
};
