import { createRequire } from "node:module";
import { inspectArtifactPolicy, isGeneratedExportPath } from "./artifact-policy.js";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileDigest, listFiles, portablePath, readJson, writeJsonAtomic } from "./artifact-store.js";
import type { ArtifactSecurityRecord } from "./artifact-store.js";
import type { VerifiedArtifact } from "./artifact-policy.js";
export type { ArtifactSecurityRecord };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schema = JSON.parse(await readFile(resolve(root, "vendor/hate/v1/artifact-manifest.schema.json"), "utf8")) as object;
type Validator = ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> };
type AjvConstructor = new (options: object) => { compile(value: object): Validator };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

function kind(path: string): "trace" | "screenshot" | "video" | "log" | "report" | "static" | "other" {
  if (path.endsWith(".zip")) return "trace";
  if (/\.(png|jpg|jpeg)$/i.test(path)) return "screenshot";
  if (path.endsWith(".webm")) return "video";
  if (path.endsWith(".jsonl")) return "log";
  if (path.endsWith(".json")) return "report";
  if (path.endsWith(".html")) return "static";
  return "other";
}


export type ArtifactProvenance = { producerVersion: string; createdAt: string };

export async function buildAndValidateManifest(
  runDir: string,
  runId: string,
  runAttempt: number,
  commitSha: string,
  classification: "public" | "internal" | "confidential" | "restricted" = "internal",
  provenance: ArtifactProvenance = { producerVersion: "0.3.0-rc.3", createdAt: "1970-01-01T00:00:00.000Z" },
  securityByPath: Record<string, ArtifactSecurityRecord> = {},
  excludePaths: string[] = [],
  verifiedArtifacts: VerifiedArtifact[] = [],
): Promise<object> {
  const included = (await listFiles(runDir)).filter(path => !isGeneratedExportPath(runDir, path) && !excludePaths.includes(path));
  const verifiedByPath = new Map(verifiedArtifacts.map(artifact => [artifact.path, artifact]));
  const artifacts = await Promise.all(included.map(async path => {
    const rel = portablePath(runDir, path);
    const verified = verifiedByPath.get(rel);
    const current = await fileDigest(path);
    if (verified && (current.size !== verified.size || current.sha256 !== verified.sha256)) throw new Error("検査済みartifactのbytesが変更されています: " + rel);
    const digest = verified ? { size: verified.size, sha256: verified.sha256 } : current;
    const artifactKind = kind(rel);
    const binary = artifactKind === "trace" || artifactKind === "screenshot" || artifactKind === "video";
    const security = securityByPath[rel] ?? verified?.security;
    if (!security) throw new Error("検査済みsecurity recordがありません: " + rel);
    return {
      artifact_id: "lakda:artifact-" + rel.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, ""),
      kind: artifactKind, path: rel, sha256: "sha256:" + digest.sha256, size_bytes: digest.size,
      classification, redaction_status: security.redactionStatus, redaction_rule_version: "lakda-redact-v1",
      safe_for_summary: !binary && security.secretsScan === "pass" && security.piiScan === "pass", public_exposure: "none",
      retention: { class: "default", days: 14 },
      security_checks: { secrets_scan: security.secretsScan, pii_scan: security.piiScan },
      lakda: { runId, runAttempt, commitSha, producerVersion: provenance.producerVersion, createdAt: provenance.createdAt },
    };
  }));
  const manifest = { schema_version: "HATE/v1", run_id: runId, run_attempt: runAttempt, commit_sha: commitSha, artifacts };
  assertHateManifest(manifest);
  return manifest;
}

export function assertHateManifest(value: unknown): void {
  if (!validate(value)) throw new Error(`HATE/v1 schema不適合: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
}

export async function exportHate(runDir: string, out: string, securityByPath: Record<string, ArtifactSecurityRecord> = {}): Promise<object> {
  void securityByPath;
  const metadata = await readJson(join(runDir, "run-metadata.json")) as { runId: string; attempt: number; commitSha: string; startedAt?: string; endedAt?: string; producerVersion?: string; outcome?: import("./types.js").RunOutcome; artifactPolicy?: { classification: "public" | "internal" | "confidential" | "restricted"; maxRunBytes: number; expectations: import("./types.js").ArtifactExpectations } };
  const excluded = [resolve(out)];
  const policy = await inspectArtifactPolicy(runDir, { artifacts: { maxRunBytes: metadata.artifactPolicy?.maxRunBytes ?? 1_073_741_824, classification: metadata.artifactPolicy?.classification ?? "internal" } } as import("./types.js").LakdaConfig, metadata.outcome ?? "passed", metadata.artifactPolicy?.expectations ?? { trace: false, screenshot: false, video: false, har: false, domSnapshots: 0 }, excluded);
  if (policy.residualSensitivePaths.length || policy.missingPaths.length || policy.profileMissingPaths.length || policy.unsupportedPaths.length || (metadata.outcome === "passed" && policy.sizeExceeded)) throw new Error("artifact policy検査に失敗しました");
  const manifest = await buildAndValidateManifest(runDir, metadata.runId, metadata.attempt, metadata.commitSha, metadata.artifactPolicy?.classification ?? "internal", { producerVersion: metadata.producerVersion ?? "0.3.0-rc.3", createdAt: metadata.endedAt ?? metadata.startedAt ?? "1970-01-01T00:00:00.000Z" }, policy.securityByPath, excluded, policy.verifiedArtifacts);
  await writeJsonAtomic(out, manifest);
  return manifest;
}
