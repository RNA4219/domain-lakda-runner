import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import type { ActionPlan, Failure, LakdaConfig, LlmEvidence, LlmStatus, RunOutcome } from "./types.js";
import { redact, sha256 } from "./redaction.js";
import { buildAndValidateManifest } from "./hate.js";
import { canonicalJson } from "./plan.js";

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
  llmStatus: LlmStatus;
};

function commitSha(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "0000000000000000000000000000000000000000"; }
}

function runFolderName(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/g, "-");
}

export class ArtifactCollector {
  readonly paths: { runDir: string; metadata: string; actionSequence: string; console: string; failures: string; trace: string; screenshot: string; exports: string; manifest: string; llm: string };
  readonly metadata: RunMetadata;
  readonly failures: Failure[] = [];
  readonly consoleLines: string[] = [];
  readonly llmEvidence: LlmEvidence[] = [];

  private constructor(paths: ArtifactCollector["paths"], metadata: RunMetadata) { this.paths = paths; this.metadata = metadata; }

  static async create(config: LakdaConfig, mode: string): Promise<ArtifactCollector> {
    const now = new Date();
    const runId = `lakda:run-${now.toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
    const runDir = resolve(config.outputDir, runFolderName(runId));
    const exports = join(runDir, "exports");
    const artifacts = join(runDir, "artifacts");
    await mkdir(exports, { recursive: true });
    await mkdir(artifacts, { recursive: true });
    const metadata: RunMetadata = {
      schemaVersion: "lakda/run-metadata/v1", runId, attempt: 1, startedAt: now.toISOString(), mode,
      seed: config.seed, persona: config.persona, browser: "chromium", baseUrl: config.baseUrl ?? "", headed: config.headed,
      producerVersion: "0.1.0", commitSha: commitSha(), llmStatus: "not_requested",
    };
    return new ArtifactCollector({ runDir, metadata: join(runDir, "run-metadata.json"), actionSequence: join(runDir, "action-sequence.json"), console: join(runDir, "console.jsonl"), failures: join(runDir, "failure-report.json"), trace: join(artifacts, "trace.zip"), screenshot: join(artifacts, "failure.png"), exports, manifest: join(exports, "artifact-manifest.json"), llm: join(artifacts, "llm-decisions.jsonl") }, metadata);
  }

  addFailure(ruleId: Failure["ruleId"], message: string): void {
    if (this.failures.some(failure => failure.ruleId === ruleId && failure.message === message)) return;
    this.failures.push({ failureId: `lakda:failure-${this.failures.length + 1}`, ruleId, severity: "failure", message: redact(message) });
  }

  log(level: string, message: string, source = "browser"): void {
    this.consoleLines.push(JSON.stringify({ timestamp: new Date().toISOString(), level, source, message: redact(message) }));
  }

  addLlmEvidence(evidence: LlmEvidence): void { this.llmEvidence.push(JSON.parse(redact(JSON.stringify(evidence))) as LlmEvidence); }

  async finalize(plan: ActionPlan, outcome: RunOutcome, exitCode: number, llmStatus: LlmStatus, maxRunBytes: number, classification: LakdaConfig["artifacts"]["classification"]): Promise<{ manifestPath: string; outcome: RunOutcome }> {
    this.metadata.endedAt = new Date().toISOString();
    this.metadata.outcome = outcome;
    this.metadata.exitCode = exitCode;
    this.metadata.llmStatus = llmStatus;
    await writeJson(this.paths.metadata, this.metadata);
    await writeCanonicalJson(this.paths.actionSequence, plan);
    await writeFile(this.paths.console, `${this.consoleLines.join("\n")}${this.consoleLines.length ? "\n" : ""}`, "utf8");
    await writeJson(this.paths.failures, { failures: this.failures });
    await writeFile(this.paths.llm, `${this.llmEvidence.map(value => JSON.stringify(value)).join("\n")}${this.llmEvidence.length ? "\n" : ""}`, "utf8");
    let manifest = await buildAndValidateManifest(this.paths.runDir, this.metadata.runId, this.metadata.attempt, this.metadata.commitSha, classification, { producerVersion: this.metadata.producerVersion, createdAt: this.metadata.endedAt! });
    await writeJson(this.paths.manifest, manifest);
    if (outcome !== "error" && await runSizeExceeds(this.paths.runDir, maxRunBytes)) {
      this.metadata.outcome = "partial";
      this.metadata.exitCode = 2;
      await writeJson(this.paths.metadata, this.metadata);
      manifest = await buildAndValidateManifest(this.paths.runDir, this.metadata.runId, this.metadata.attempt, this.metadata.commitSha, classification, { producerVersion: this.metadata.producerVersion, createdAt: this.metadata.endedAt! });
      await writeJson(this.paths.manifest, manifest);
      return { manifestPath: this.paths.manifest, outcome: "partial" };
    }
    return { manifestPath: this.paths.manifest, outcome };
  }
}

export async function writeCanonicalJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${canonicalJson(value)}\n`, "utf8");
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")); }

export async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

export async function fileDigest(path: string): Promise<{ size: number; sha256: string }> {
  const buffer = await readFile(path);
  return { size: (await stat(path)).size, sha256: sha256(buffer) };
}

export async function runSizeExceeds(runDir: string, maximum: number): Promise<boolean> {
  const sizes = await Promise.all((await listFiles(runDir)).map(async path => (await stat(path)).size));
  return sizes.reduce((total, size) => total + size, 0) > maximum;
}

export function isRunDirectory(path: string): boolean { return existsSync(join(path, "run-metadata.json")); }
export function portablePath(root: string, path: string): string { return relative(root, path).split(sep).join("/"); }
