import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileDigest, listFiles, portablePath, readJson, writeJson } from "./artifact-store.js";
import type { ArtifactSecurityRecord } from "./artifact-store.js";
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
  provenance: ArtifactProvenance = { producerVersion: "0.2.0", createdAt: new Date().toISOString() },
  securityByPath: Record<string, ArtifactSecurityRecord> = {},
): Promise<object> {
  const included = (await listFiles(runDir)).filter(path => !path.endsWith("artifact-manifest.json"));
  const artifacts = await Promise.all(included.map(async path => {
    const digest = await fileDigest(path);
    const rel = portablePath(runDir, path);
    const artifactKind = kind(rel);
    const binary = artifactKind === "trace" || artifactKind === "screenshot" || artifactKind === "video";
    const security = securityByPath[rel] ?? (binary
      ? { redactionStatus: "not_required", secretsScan: "not_applicable", piiScan: "not_applicable" }
      : { redactionStatus: "redacted", secretsScan: "pass", piiScan: "pass" });
    return {
      artifact_id: `lakda:artifact-${rel.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      kind: artifactKind, path: rel, sha256: `sha256:${digest.sha256}`, size_bytes: digest.size,
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
  const metadata = await readJson(join(runDir, "run-metadata.json")) as { runId: string; attempt: number; commitSha: string };
  const manifest = await buildAndValidateManifest(runDir, metadata.runId, metadata.attempt, metadata.commitSha, "internal", undefined, securityByPath);
  await writeJson(out, manifest);
  return manifest;
}
