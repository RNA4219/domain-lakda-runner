import { existsSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { assertLeadForReplay, type ExplorationLead } from "../adaptive/scouting.js";
import {
  assertInvestigation,
  assertPromotionReady,
  createInvestigation,
  promoteInvestigation,
  runStrictReplay,
  type Investigation,
} from "../adaptive/investigation.js";
import {
  buildReplaySteps,
  replayDetails,
  stableOracleRefs,
  validateAdaptiveReplayTrace,
  validateReplayScope,
  type AdaptiveReplayTrace,
} from "../adaptive/replay.js";
import type { ExecutionResult, OracleResult } from "../adaptive/contracts.js";
import { readJson, writeCanonicalJson } from "../core/artifact-store.js";
import { loadConfig } from "../core/config.js";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { runLakda } from "../core/runner.js";
import { stringFlag, type Flags } from "../cli/parser.js";

type LeadInput = { lead: ExplorationLead; runId?: string };
type ReplayRecord = {
  candidateId: string;
  execution: ExecutionResult | undefined;
  oracles: OracleResult[];
};
type CompletedReplayRecord = {
  candidateId: string;
  execution: ExecutionResult;
  oracles: OracleResult[];
};

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(name + " must be an object");
  }
  return value as Record<string, unknown>;
}

function leadInput(value: unknown): LeadInput {
  const current = record(value, "lead");
  if (current.schemaVersion === "lakda/exploration-lead/v1") {
    return { lead: current as unknown as ExplorationLead };
  }
  if (current.schemaVersion !== "lakda/lead-report-index/v1") {
    throw new Error("unknown lead schemaVersion");
  }
  const allowed = [
    "schemaVersion",
    "runId",
    "leadCount",
    "leads",
    "generatedAt",
    "scoutStatus",
    "requestedMode",
    "effectiveMode",
    "signals",
    "leadObjects",
    "context",
  ];
  const extra = Object.keys(current).filter(key => !allowed.includes(key));
  if (extra.length) throw new Error("lead report has unknown keys: " + extra.join(","));
  if (!Array.isArray(current.leads)
    || !Array.isArray(current.leadObjects)
    || current.leadObjects.length === 0) {
    throw new Error("lead report has no leadObjects");
  }
  const selectedId = typeof current.leads[0] === "string" ? current.leads[0] : undefined;
  const selected = current.leadObjects.find(value => value
    && typeof value === "object"
    && (selectedId
      ? (value as Record<string, unknown>).leadId === selectedId
      : true));
  if (!selected) throw new Error("lead report selected lead is missing");
  return {
    lead: selected as ExplorationLead,
    ...(typeof current.runId === "string" ? { runId: current.runId } : {}),
  };
}

function replayRecords(trace: AdaptiveReplayTrace): CompletedReplayRecord[] {
  const records: ReplayRecord[] = [];
  let current: ReplayRecord | undefined;
  for (const entry of trace.trace) {
    if (entry.type === "candidate" && entry.candidate) {
      const next: ReplayRecord = {
        candidateId: entry.candidate.candidateId,
        execution: undefined,
        oracles: [],
      };
      current = next;
      records.push(next);
    } else if (entry.type === "execution"
      && current
      && current.execution === undefined
      && entry.executionResult) {
      current.execution = entry.executionResult;
    } else if (entry.type === "oracle" && current?.execution && entry.result) {
      current.oracles.push(entry.result);
    }
  }
  return records.filter((record): record is CompletedReplayRecord => record.execution !== undefined);
}

function expectedFailure(steps: ReturnType<typeof buildReplaySteps>): boolean {
  return steps.some(step => step.execution?.status !== "executed"
    || step.oracles.some(oracle => ["fail", "confirmed", "candidate"].includes(oracle.verdict)));
}

function actualFailure(records: CompletedReplayRecord[]): boolean {
  return records.some(record => record.execution.status !== "executed"
    || record.oracles.some(oracle => ["fail", "confirmed", "candidate"].includes(oracle.verdict)));
}

function portableRelativeRef(root: string, path: string): string {
  const value = relative(root, path).split("\\").join("/");
  if (!value || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error("artifact ref is not portable");
  }
  return value;
}

function runEvidenceRefs(runDir: string | undefined, outputPath: string): string[] {
  if (!runDir) return [];
  const root = dirname(outputPath);
  const required = [
    "adaptive/trace.json",
    "adaptive/oracle-results.jsonl",
    "exports/artifact-manifest.json",
  ].map(ref => resolve(runDir, ref));
  if (required.some(path => !existsSync(path))) return [];
  return required.map(path => portableRelativeRef(root, path));
}

export async function investigateCommand(flags: Flags): Promise<number> {
  const leadPath = stringFlag(flags, "lead", true)!;
  const tracePath = stringFlag(flags, "trace", true)!;
  const configPath = stringFlag(flags, "config", true)!;
  const reviewer = stringFlag(flags, "reviewer", true)!;
  if (!existsSync(tracePath)) throw new Error("trace artifact is missing");
  if (!existsSync(configPath)) throw new Error("config artifact is missing");
  const input = leadInput(await readJson(leadPath));
  const traceInput = await readJson(tracePath);
  validateAdaptiveReplayTrace(traceInput);
  const rawConfig = record(await readJson(configPath), "config");
  const config = loadConfig(configPath);
  if (config.mode !== "adaptive-explore" || !config.adaptive) {
    throw new Error("investigate requires mode=adaptive-explore and adaptive config");
  }
  if (!config.baseUrl) throw new Error("investigate requires baseUrl");
  if (traceInput.seed !== config.seed) throw new Error("trace seed does not match config seed");
  assertLeadForReplay(input.lead, traceInput, input.runId);
  validateReplayScope(
    traceInput,
    config.baseUrl,
    config.safety.allowHosts,
    config.adaptive.safety.allowTargetKinds,
  );
  const investigation = createInvestigation(input.lead, reviewer);
  const out = resolve(
    stringFlag(flags, "out")
      ?? resolve(dirname(leadPath), investigation.investigationId + ".json"),
  );
  const configDigest = "sha256:" + sha256(canonicalJson(rawConfig));
  const result = await runStrictReplay(investigation, async () => {
    const run = await runLakda(config, tracePath);
    const runDir = run.actionSequencePath ? dirname(run.actionSequencePath) : undefined;
    const evidenceRefs = runEvidenceRefs(runDir, out);
    const evidenceComplete = evidenceRefs.length === 3;
    let actualTrace: AdaptiveReplayTrace | undefined;
    let records: CompletedReplayRecord[];
    try {
      const traceArtifact = runDir ? resolve(runDir, "adaptive", "trace.json") : undefined;
      if (!traceArtifact || !existsSync(traceArtifact)) {
        throw new Error("replay trace artifact is missing");
      }
      const parsed = await readJson(traceArtifact);
      validateAdaptiveReplayTrace(parsed, { requireReplayable: false });
      actualTrace = parsed;
      records = replayRecords(parsed);
    } catch {
      return {
        reproduced: false,
        inconclusive: true,
        evidenceRefs,
        traceRef: evidenceRefs[0],
        configDigest,
        terminationReason: run.terminationReason,
        details: {
          artifactFailure: true,
          outcome: run.outcome,
          terminationReason: run.terminationReason,
        },
      };
    }
    const divergenceEntry = actualTrace.trace.find(entry => entry.type === "replay-divergence");
    const divergence = typeof divergenceEntry?.reason === "string"
      ? divergenceEntry.reason
      : undefined;
    const expected = expectedFailure(buildReplaySteps(traceInput));
    const actual = actualFailure(records);
    const inconclusive = !evidenceComplete
      || run.outcome === "error"
      || run.outcome === "partial"
      || (!divergence
        && run.terminationReason !== "completed"
        && run.outcome !== "failed");
    const effectiveDivergence = divergence
      ?? (!inconclusive && !expected && actual ? "unexpected-failure" : undefined);
    return {
      reproduced: !inconclusive && !effectiveDivergence && expected && actual,
      inconclusive,
      ...(effectiveDivergence ? { divergence: effectiveDivergence } : {}),
      oracleRefs: stableOracleRefs(records.flatMap(record => record.oracles)),
      evidenceRefs,
      traceRef: evidenceRefs[0],
      configDigest,
      terminationReason: run.terminationReason,
      details: replayDetails(buildReplaySteps(traceInput), records, effectiveDivergence),
    };
  });
  assertInvestigation(result);
  await writeCanonicalJson(out, result);
  console.log(JSON.stringify({
    command: "investigate",
    out,
    status: result.status,
    replayCount: result.replayCount,
  }, null, 2));
  return result.status === "reproduced" ? 0 : 2;
}

export async function promoteCommand(flags: Flags): Promise<number> {
  const investigationPath = stringFlag(flags, "investigation", true)!;
  const kind = stringFlag(flags, "kind", true);
  if (kind !== "trace" && kind !== "suite") {
    throw new Error("--kind must be trace or suite");
  }
  const investigation = await readJson(investigationPath) as Investigation;
  assertInvestigation(investigation);
  const refs = investigation.evidenceRefs ?? [];
  const root = dirname(resolve(investigationPath));
  assertPromotionReady(investigation, kind, refs, ref => {
    try {
      return statSync(resolve(root, ref)).isFile();
    } catch {
      return false;
    }
  });
  const promotion = promoteInvestigation(investigation, kind, refs);
  const out = resolve(
    stringFlag(flags, "out")
      ?? resolve(dirname(investigationPath), promotion.promotionId + ".json"),
  );
  await writeCanonicalJson(out, promotion);
  console.log(JSON.stringify({
    command: "promote",
    out,
    promotionId: promotion.promotionId,
  }, null, 2));
  return 0;
}
