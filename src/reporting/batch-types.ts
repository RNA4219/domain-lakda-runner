import type { ArtifactSnapshot } from "../runs/artifact-snapshot.js";
import type { Classification, Outcome } from "./types.js";

export type BatchRunReference = {
  runId: string; attempt: number; path: string; manifestSha256: string | null;
  outcome: Outcome; exitCode: 0 | 1 | 2; terminationReason: string;
};
export type BatchWorker =
  | { workerIndex: number; seed: number; status: "completed"; run: BatchRunReference }
  | { workerIndex: number; seed: number; status: "error"; error: { name: string; message: string } };
export type BatchSourcesDocument = {
  schemaVersion: "lakda/report-batch-sources/v1"; batchId: string; recordedAt: string; root: string;
  classification: Classification; outcome: Outcome; exitCode: 0 | 1 | 2;
  requestedWorkers: number; completedWorkers: number; workers: BatchWorker[];
};
export type BatchIndexInput = {
  document: BatchSourcesDocument; snapshot: ArtifactSnapshot; directories: Map<number, string>;
  unfinalized: Array<{ root: string; dev: number; ino: number }>;
};
