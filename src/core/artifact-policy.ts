import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LakdaConfig, RunOutcome } from "./types.js";
import { findSensitive } from "./redaction.js";
import { listFiles, portablePath } from "./artifact-store.js";
import type { ArtifactSecurityRecord } from "./artifact-store.js";

export type ArtifactPolicyReport = {
  securityByPath: Record<string, ArtifactSecurityRecord>;
  residualSensitivePaths: string[];
  missingPaths: string[];
  profileMissingPaths: string[];
  sizeExceeded: boolean;
};

function binary(path: string): boolean {
  return /\.(zip|png|jpg|jpeg|webm)$/i.test(path);
}

function textArtifact(path: string): boolean {
  return /\.(json|jsonl|html|txt)$/i.test(path);
}

function hasPath(files: string[], suffix: string): boolean {
  return files.some(path => path.endsWith(suffix));
}

export async function inspectArtifactPolicy(
  runDir: string,
  config: LakdaConfig,
  outcome: RunOutcome,
  expectedDomSnapshots: number,
): Promise<ArtifactPolicyReport> {
  const files = await listFiles(runDir);
  const relativeFiles = files.map(path => portablePath(runDir, path));
  const required = ["run-metadata.json", "action-sequence.json", "console.jsonl", "failure-report.json", "exports/artifact-manifest.json"];
  const missingPaths = required.filter(path => !relativeFiles.includes(path));
  const profileMissingPaths: string[] = [];
  if (outcome !== "passed") {
    if (!hasPath(relativeFiles, "artifacts/trace.zip")) profileMissingPaths.push("artifacts/trace.zip");
    if (!hasPath(relativeFiles, "artifacts/failure.png")) profileMissingPaths.push("artifacts/failure.png");
  }
  if (config.artifacts.video && !relativeFiles.some(path => path.startsWith("artifacts/video/") && path.endsWith(".webm"))) profileMissingPaths.push("artifacts/video/*.webm");
  if (config.artifacts.har && !hasPath(relativeFiles, "artifacts/network.har")) profileMissingPaths.push("artifacts/network.har");
  if (config.artifacts.domSnapshots && expectedDomSnapshots > 0 && !relativeFiles.some(path => path.startsWith("artifacts/dom/") && path.endsWith(".html"))) profileMissingPaths.push("artifacts/dom/*.html");

  const securityByPath: Record<string, ArtifactSecurityRecord> = {};
  const residualSensitivePaths: string[] = [];
  for (const path of files) {
    const rel = portablePath(runDir, path);
    if (binary(rel)) {
      securityByPath[rel] = { redactionStatus: "not_required", secretsScan: "not_applicable", piiScan: "not_applicable" };
      continue;
    }
    if (!textArtifact(rel)) continue;
    const findings = findSensitive(await readFile(path, "utf8"));
    const secrets = findings.includes("secret") ? "fail" : "pass";
    const pii = findings.includes("pii") ? "fail" : "pass";
    securityByPath[rel] = { redactionStatus: findings.length ? "failed" : "redacted", secretsScan: secrets, piiScan: pii };
    if (findings.length) residualSensitivePaths.push(rel);
  }
  const size = (await Promise.all(files.map(async path => (await stat(path)).size))).reduce((total, value) => total + value, 0);
  return { securityByPath, residualSensitivePaths, missingPaths, profileMissingPaths, sizeExceeded: size > config.artifacts.maxRunBytes };
}

export async function removeSensitiveArtifacts(runDir: string, relativePaths: string[]): Promise<void> {
  await Promise.all(relativePaths.map(path => rm(join(runDir, path), { force: true })));
}