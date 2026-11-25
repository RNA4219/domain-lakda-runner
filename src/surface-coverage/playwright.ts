import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "playwright";
import { currentExecutionRevision } from "../core/artifacts.js";
import { buildAndValidateManifest } from "../core/hate.js";
import { fileDigest, writeJsonAtomic, writeVerifiedText } from "../core/artifact-store.js";
import { findSensitive, sha256 } from "../core/redaction.js";
import { check, id, lane, loadCatalog, type Lane } from "./catalog.js";
import { SurfaceObserver } from "./observer.js";
import { serializeMeasurement } from "./serialization.js";

export interface SurfaceCoverageOptions {
  catalogPath: string; outputDir: string; testId: string; testRevision: string; lane?: Lane; attempt?: number; producerRevision?: string;
}
export type SurfaceTestOutcome = "passed" | "failed" | "partial" | "error";
export interface SurfaceRunRecord {
  target: { product: string; version: string; environment: string };
  complete: boolean; runDirectory: string; measurementPath: string; manifestPath: string;
  entry: { id: string; caseRevision: string; environment: string; runId: string; runRef: string; attempt: number;
    outcome: SurfaceTestOutcome; reason: string; manifestSha256: string };
}
export interface SurfaceCoverageSession {
  checkpoint(): Promise<void>;
  finish(outcome: SurfaceTestOutcome): Promise<SurfaceRunRecord>;
}

/** Attach to the caller's existing context; never run actions or close that context. */
export async function startSurfaceCoverage(context: BrowserContext, options: SurfaceCoverageOptions): Promise<SurfaceCoverageSession> {
  check(typeof options.outputDir === "string" && options.outputDir.trim().length > 0);
  const catalog = await loadCatalog(options.catalogPath), testId = id(options.testId), classification = lane(options.lane ?? "unknown");
  check(/^[A-Za-z0-9._-]{1,80}$/.test(options.testRevision));
  const attempt = options.attempt ?? 1, producerRevision = options.producerRevision ?? currentExecutionRevision();
  check(Number.isSafeInteger(attempt) && attempt > 0 && typeof producerRevision === "string" && /^[a-f0-9]{40}$/.test(producerRevision));
  const startedAt = new Date().toISOString(), runId = "lakda:run-" + startedAt.replace(/[:.]/g, "-") + "-" + randomUUID();
  const runRef = runId.replaceAll(":", "-"), root = resolve(options.outputDir); await mkdir(root, { recursive: true });
  const runDirectory = join(root, runRef); await mkdir(runDirectory);
  const observer = new SurfaceObserver(context, { catalog, testId, testRevision: options.testRevision, lane: classification });
  try { await observer.ready(); } catch (error) { await observer.finish(runId, attempt, false); throw error; }
  const target = { product: catalog.product, version: catalog.version, environment: catalog.environment };
  let finished = false;
  return {
    async checkpoint() { check(!finished); await observer.checkpoint(); },
    async finish(outcome) {
      check(!finished && ["passed", "failed", "partial", "error"].includes(outcome)); finished = true;
      let open = context.pages().some(page => !page.isClosed());
      try { await observer.checkpoint(); } catch { open = false; }
      const measurement = await observer.finish(runId, attempt, open);
      const measurementPath = join(runDirectory, "surface-observations.json"), metadataPath = join(runDirectory, "run-metadata.json");
      const measurementSecurity = await writeVerifiedText(measurementPath, serializeMeasurement(measurement));
      const endedAt = new Date().toISOString(), reason = outcome === "passed" ? "completed" : "external-test-" + outcome;
      const metadata = { schemaVersion: "lakda/external-surface-run/v1", runId, attempt, startedAt, endedAt, mode: "external-playwright", producerVersion: "0.5.0-rc.2",
        commitSha: producerRevision, outcome, terminationReason: reason, surfaceCoverage: { schema: "lakda/surface-observations/v1", source: "external-playwright", target } };
      const metadataSecurity = await writeVerifiedText(metadataPath, JSON.stringify(metadata));
      // Validate final bytes and size before building the same digest-verified HATE contract.
      const bytes = [await readFile(measurementPath), await readFile(metadataPath)];
      check(bytes.reduce((sum, value) => sum + value.length, 0) <= 8 * 1024 * 1024 && bytes.every(value => !findSensitive(value.toString("utf8")).length));
      const savedTarget = JSON.parse(bytes[1].toString("utf8")).surfaceCoverage.target;
      check(savedTarget.product === target.product && savedTarget.version === target.version && savedTarget.environment === target.environment);
      const paths = ["surface-observations.json", "run-metadata.json"], security = [measurementSecurity, metadataSecurity];
      const verified = bytes.map((value, n) => ({ path: paths[n], size: value.length, sha256: sha256(value), security: security[n] }));
      const manifestPath = join(runDirectory, "exports", "artifact-manifest.json");
      const manifest = await buildAndValidateManifest(runDirectory, runId, attempt, producerRevision, "internal", { producerVersion: "0.5.0-rc.2", createdAt: endedAt },
        { "surface-observations.json": measurementSecurity, "run-metadata.json": metadataSecurity }, [], verified);
      await writeJsonAtomic(manifestPath, manifest);
      return { target, complete: measurement.complete, runDirectory, measurementPath, manifestPath, entry: { id: testId, caseRevision: options.testRevision, environment: catalog.environment,
        runId, runRef, attempt, outcome, reason, manifestSha256: "sha256:" + (await fileDigest(manifestPath)).sha256 } };
    },
  };
}

/** An external test is an observation source, never a fabricated replay plan. */
export function surfaceRunIndex(records: readonly SurfaceRunRecord[], series: { id: string; attempt: number } = { id: "external", attempt: 1 }) {
  check(records.length > 0 && records.length <= 20_000); const target = records[0].target;
  check(Number.isSafeInteger(series.attempt) && series.attempt > 0);
  check(records.every(record => record.target.product === target.product && record.target.version === target.version && record.target.environment === target.environment));
  check(new Set(records.map(record => record.entry.id)).size === records.length);
  return { schemaVersion: "lakda/surface-run-index/v1", callerSha: target.version, executionOrigin: "local", localRunId: id(series.id), localRunAttempt: series.attempt,
    cases: records.map(record => ({ ...record.entry })) };
}
