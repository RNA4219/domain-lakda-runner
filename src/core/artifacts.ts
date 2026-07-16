import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import type { ActionPlan, ArtifactExpectations, Failure, LakdaConfig, LlmEvidence, LlmStatus, RunOutcome, TerminationReason } from "./types.js";
import { redact } from "./redaction.js";
import { writeCanonicalJson, writeJsonAtomic, writeText } from "./artifact-store.js";

export type RunMetadata = {
  schemaVersion: "lakda/run-metadata/v1";
  runId: string;
  attempt: number;
  startedAt: string;
  endedAt?: string;
  mode: string;
  seed: number;
  persona: string;
  browser: "chromium";
  baseUrl: string;
  headed: boolean;
  producerVersion: string;
  commitSha: string;
  outcome?: RunOutcome;
  exitCode?: number;
  terminationReason?: TerminationReason;
  llmStatus: LlmStatus;
  artifactPolicy: { classification: LakdaConfig["artifacts"]["classification"]; maxRunBytes: number; expectations: ArtifactExpectations };
  workerIndex: number;
  batchId?: string;
};

type CollectorContext = { workerIndex?: number; batchId?: string; clock?: () => number };

function commitSha(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "0000000000000000000000000000000000000000"; }
}

function runFolderName(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/g, "-");
}

export class ArtifactCollector {
  readonly paths: { runDir: string; metadata: string; actionSequence: string; console: string; failures: string; trace: string; screenshot: string; networkHar: string; exports: string; manifest: string; llm: string };
  readonly metadata: RunMetadata;
  readonly failures: Failure[] = [];
  readonly consoleLines: string[] = [];
  readonly llmEvidence: LlmEvidence[] = [];
  artifactFailure = false;
  executorFailure = false;

  private constructor(paths: ArtifactCollector["paths"], metadata: RunMetadata, private readonly videoRequested: boolean, private readonly harRequested: boolean) { this.paths = paths; this.metadata = metadata; }

  private captureAvailable = false;

  markCaptureAvailable(): void {
    this.captureAvailable = true;
    this.metadata.artifactPolicy.expectations.video = this.videoRequested;
    this.metadata.artifactPolicy.expectations.har = this.harRequested;
  }

  recordDomSnapshot(): void { this.metadata.artifactPolicy.expectations.domSnapshots += 1; }

  setDomSnapshotCount(count: number): void {
    this.metadata.artifactPolicy.expectations.domSnapshots = count;
  }

  static async create(config: LakdaConfig, mode: string, context: CollectorContext = {}): Promise<ArtifactCollector> {
    const now = new Date((context.clock ?? Date.now)());
    const runId = `lakda:run-${now.toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
    const runDir = resolve(config.outputDir, runFolderName(runId));
    const exports = join(runDir, "exports");
    const artifacts = join(runDir, "artifacts");
    await mkdir(exports, { recursive: true });
    await mkdir(artifacts, { recursive: true });
    const metadata: RunMetadata = {
      schemaVersion: "lakda/run-metadata/v1", runId, attempt: 1, startedAt: now.toISOString(), mode,
      seed: config.seed, persona: config.persona, browser: "chromium", baseUrl: config.baseUrl ?? "", headed: config.headed,
      producerVersion: "0.3.0-rc.4", commitSha: commitSha(), llmStatus: "not_requested", artifactPolicy: { classification: config.artifacts.classification, maxRunBytes: config.artifacts.maxRunBytes, expectations: { trace: false, screenshot: false, video: false, har: false, domSnapshots: 0 } }, workerIndex: context.workerIndex ?? 0,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    };
    return new ArtifactCollector({ runDir, metadata: join(runDir, "run-metadata.json"), actionSequence: join(runDir, "action-sequence.json"), console: join(runDir, "console.jsonl"), failures: join(runDir, "failure-report.json"), trace: join(artifacts, "trace.zip"), screenshot: join(artifacts, "failure.png"), networkHar: join(artifacts, "network.har"), exports, manifest: join(exports, "artifact-manifest.json"), llm: join(artifacts, "llm-decisions.jsonl") }, metadata, config.artifacts.video, config.artifacts.har);
  }

  markArtifactFailure(): void { this.artifactFailure = true; }

  markExecutorFailure(): void { this.executorFailure = true; }

  addFailure(ruleId: Failure["ruleId"], message: string): void {
    if (this.failures.some(failure => failure.ruleId === ruleId && failure.message === message)) return;
    this.failures.push({ failureId: `lakda:failure-${this.failures.length + 1}`, ruleId, severity: "failure", message: redact(message) });
  }

  log(level: string, message: string, source = "browser"): void {
    this.consoleLines.push(JSON.stringify({ timestamp: new Date().toISOString(), level, source, message: redact(message) }));
  }

  addLlmEvidence(evidence: LlmEvidence): void { this.llmEvidence.push(JSON.parse(redact(JSON.stringify(evidence))) as LlmEvidence); }

  async finalize(plan: ActionPlan, outcome: RunOutcome, exitCode: number, llmStatus: LlmStatus, terminationReason: TerminationReason): Promise<{ manifestPath: string; runDir: string }> {
    this.metadata.endedAt = new Date().toISOString();
    this.metadata.outcome = outcome;
    this.metadata.exitCode = exitCode;
    this.metadata.terminationReason = terminationReason;
    this.metadata.llmStatus = llmStatus;
    this.metadata.artifactPolicy.expectations.trace = this.captureAvailable && outcome !== "passed";
    this.metadata.artifactPolicy.expectations.screenshot = this.captureAvailable && outcome !== "passed";
    await writeJsonAtomic(this.paths.metadata, this.metadata);
    await writeCanonicalJson(this.paths.actionSequence, plan);
    await writeText(this.paths.console, this.consoleLines.join("\n"));
    await writeJsonAtomic(this.paths.failures, { failures: this.failures });
    await writeText(this.paths.llm, this.llmEvidence.map(value => JSON.stringify(value)).join("\n"));
    return { manifestPath: this.paths.manifest, runDir: this.paths.runDir };
  }

  async updateOutcome(outcome: RunOutcome, exitCode: number, terminationReason: TerminationReason): Promise<void> {
    this.metadata.outcome = outcome;
    this.metadata.exitCode = exitCode;
    this.metadata.terminationReason = terminationReason;
    await writeJsonAtomic(this.paths.metadata, this.metadata);
    await writeJsonAtomic(this.paths.failures, { failures: this.failures });
  }
}
