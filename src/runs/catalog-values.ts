import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { findSensitive } from "../core/redaction.js";
import type { RunSummary } from "./types.js";

const outcomes = new Set(["passed", "failed", "partial", "error"]);

export type JsonObject = Record<string, unknown>;
export type HateArtifact = {
  path: string;
  sha256: string;
  size_bytes: number;
  redaction_status: string;
  public_exposure: string;
  security_checks: { secrets_scan?: unknown; pii_scan?: unknown };
};
export function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(name + " must be an object");
  return value as JsonObject;
}

export function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(name + " must be a non-empty string");
  return value;
}

export function integerValue(value: unknown, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(name + " must be an integer >= " + minimum);
  return value as number;
}

export function dateValue(value: unknown, name: string): string {
  const current = stringValue(value, name);
  if (Number.isNaN(Date.parse(current))) throw new Error(name + " must be an ISO date-time");
  return current;
}

export function assertSafePublicValue(value: string, name: string): void {
  if (findSensitive(value).length > 0) throw new Error(name + " contains sensitive data");
  if (isAbsolute(value) || /^file:\/\//i.test(value)) throw new Error(name + " contains an absolute path");
}

export function ratioValue(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(name + " must be a ratio from 0 to 1");
  return value;
}

export function parseJson(bytes: Buffer, name: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(name + " is not valid JSON");
  }
}

export function isContained(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith(".." + sep) && value !== ".." && !isAbsolute(value));
}

export function assertPortableArtifactRef(ref: string): void {
  if (
    ref.length === 0
    || ref.includes("\\")
    || ref.includes("\0")
    || ref.startsWith("/")
    || /^[A-Za-z]:/.test(ref)
    || ref.split("/").some(segment => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("HATE artifact path is not portable: " + ref);
  }
}

export async function secureArtifactFile(root: string, ref: string): Promise<string> {
  assertPortableArtifactRef(ref);
  const candidate = resolve(root, ...ref.split("/"));
  if (!isContained(root, candidate)) throw new Error("HATE artifact path escapes run directory: " + ref);
  let actual: string;
  try {
    actual = await realpath(candidate);
  } catch {
    throw new Error("HATE artifact is missing: " + ref);
  }
  if (!isContained(root, actual)) throw new Error("HATE artifact symlink escapes run directory: " + ref);
  const current = await stat(actual);
  if (!current.isFile()) throw new Error("HATE artifact is not a file: " + ref);
  return actual;
}

export function hateArtifact(value: unknown, index: number): HateArtifact {
  const current = object(value, "HATE artifact[" + index + "]");
  const security = object(current.security_checks, "HATE artifact security_checks");
  const artifact: HateArtifact = {
    path: stringValue(current.path, "HATE artifact path"),
    sha256: stringValue(current.sha256, "HATE artifact sha256"),
    size_bytes: integerValue(current.size_bytes, "HATE artifact size_bytes"),
    redaction_status: stringValue(current.redaction_status, "HATE artifact redaction_status"),
    public_exposure: stringValue(current.public_exposure, "HATE artifact public_exposure"),
    security_checks: security,
  };
  if (!/^(sha256:)?[a-fA-F0-9]{64}$/.test(artifact.sha256)) throw new Error("HATE artifact sha256 is invalid: " + artifact.path);
  if (!["not_required", "redacted"].includes(artifact.redaction_status)) throw new Error("HATE artifact redaction is not complete: " + artifact.path);
  if (artifact.public_exposure !== "none") throw new Error("HATE artifact public exposure must be none: " + artifact.path);
  const acceptedScanStatuses = new Set(["pass", "not_applicable"]);
  if (!acceptedScanStatuses.has(String(security.secrets_scan)) || !acceptedScanStatuses.has(String(security.pii_scan))) throw new Error("HATE artifact security checks did not pass: " + artifact.path);
  return artifact;
}

export function parseRunSummary(value: unknown, runRef: string): RunSummary {
  if (!/^[A-Za-z0-9._-]+$/.test(runRef)) throw new Error("run directory name is not portable");
  const current = object(value, "run metadata");
  if (current.schemaVersion !== "lakda/run-metadata/v1") throw new Error("unsupported run metadata schemaVersion");
  const runId = stringValue(current.runId, "run metadata runId");
  const mode = stringValue(current.mode, "run metadata mode");
  const outcome = stringValue(current.outcome, "run metadata outcome");
  if (!outcomes.has(outcome)) throw new Error("run metadata outcome is unsupported");
  const terminationReason = stringValue(current.terminationReason, "run metadata terminationReason");
  const producerVersion = stringValue(current.producerVersion, "run metadata producerVersion");
  const commitSha = stringValue(current.commitSha, "run metadata commitSha");
  if (!/^[a-fA-F0-9]{7,64}$/.test(commitSha)) throw new Error("run metadata commitSha is invalid");
  for (const [name, publicValue] of [
    ["run metadata runId", runId],
    ["run metadata mode", mode],
    ["run metadata terminationReason", terminationReason],
    ["run metadata producerVersion", producerVersion],
    ["run metadata commitSha", commitSha],
  ] as const) assertSafePublicValue(publicValue, name);
  const seed = current.seed;
  if (!Number.isSafeInteger(seed)) throw new Error("run metadata seed must be an integer");
  return {
    runId,
    runRef,
    startedAt: dateValue(current.startedAt, "run metadata startedAt"),
    endedAt: dateValue(current.endedAt, "run metadata endedAt"),
    mode,
    outcome: outcome as RunSummary["outcome"],
    terminationReason,
    seed: seed as number,
    producerVersion,
    commitSha,
  };
}

export function sortedRecord<T extends string | number | boolean | null>(value: unknown, name: string, allowed?: Set<T>): Record<string, T> {
  const current = object(value, name);
  const result: Record<string, T> = {};
  for (const key of Object.keys(current).sort()) {
    const entry = current[key];
    if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error(name + " contains a non-finite number");
      if (allowed && !allowed.has(entry as T)) throw new Error(name + " contains an unsupported value");
      result[key] = entry as T;
      continue;
    }
    throw new Error(name + " values must be scalar");
  }
  return result;
}
