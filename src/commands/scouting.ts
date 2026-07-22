import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildScoutContext,
  groupLeadsRuleOnly,
  scoutWithLoopback,
  signalsFromTrace,
  writeScoutEvidence,
  type ExplorationLead,
  type ScoutLlmClient,
} from "../adaptive/scouting.js";
import { readJson, writeCanonicalJson } from "../core/artifact-store.js";
import { findSensitive } from "../core/redaction.js";
import { loadConfig } from "../core/config.js";
import { LocalLlmClient } from "../core/llm.js";
import type { LakdaConfig } from "../core/types.js";
import { stringFlag, type Flags } from "../cli/parser.js";

export type ScoutCommandRuntime = {
  createClient(config: LakdaConfig): ScoutLlmClient;
};
const defaultScoutCommandRuntime: ScoutCommandRuntime = {
  createClient: config => new LocalLlmClient(config),
};

const sensitiveRevision = /(?:authorization|bearer|credential|password|passwd|secret|token|api[-_]?key)/i;

function safeRunRevision(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const revision = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(revision)) return undefined;
  if (sensitiveRevision.test(revision) || findSensitive(revision).length > 0) return undefined;
  return revision;
}

export async function scoutCommand(flags: Flags, runtime: ScoutCommandRuntime = defaultScoutCommandRuntime): Promise<number> {
  const suitePath = stringFlag(flags, "suite", true)!;
  const config = loadConfig(stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"));
  const input = await readJson(suitePath);
  const trace = input && typeof input === "object" && Array.isArray((input as Record<string, unknown>).trace)
    ? (input as Record<string, unknown>).trace
    : [input];
  const runId = input
    && typeof input === "object"
    && typeof (input as Record<string, unknown>).runId === "string"
    ? (input as Record<string, string>).runId
    : "scout-" + config.seed;
  const inputRecord = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const runRevision = ["commitSha", "runnerRevision", "revision"]
    .map(key => safeRunRevision(inputRecord[key]))
    .find((value): value is string => value !== undefined) ?? "unavailable";
  const signals = signalsFromTrace(trace, runId);
  const leadCap = config.extensions?.scouting?.leadCap ?? 3;
  const leads = groupLeadsRuleOnly(signals, leadCap);
  const context = buildScoutContext(
    leads,
    ["trace", "oracle", "timeout", "topology", "coverage", "safety"],
    leadCap,
  );
  const requestedMode = stringFlag(flags, "scout-mode") ?? stringFlag(flags, "mode");
  const configuredMode = config.extensions?.scouting?.mode;
  const mode = requestedMode === "loopback" || (!requestedMode && configuredMode === "loopback")
    ? "llm"
    : requestedMode ?? configuredMode ?? "rule-only";
  let selectedLeads = leads;
  let response: unknown;
  let rejectionReason: string | undefined;
  let scoutStatus: "completed" | "partial" = "completed";
  let effectiveMode: "rule-only" | "llm" | "none" = mode === "llm" ? "llm" : "rule-only";
  let exitCode = 0;
  if (mode === "llm") {
    try {
      if (!config.llm.enabled || !config.llm.modelPath || !config.llm.modelSha256) {
        throw new Error("LLM scoutは明示的なloopback設定とmodel証跡が必要です");
      }
      const client = runtime.createClient(config);
      await client.preflight();
      const capturingClient: Pick<ScoutLlmClient, "scout"> = {
        scout: async (scoutContext, summary) => {
          response = await client.scout(scoutContext, summary);
          return response;
        },
      };
      const acceptedResponse = await scoutWithLoopback(capturingClient, context, leads, { signalCount: signals.length });
      selectedLeads = leads
        .map(lead => lead.leadId === acceptedResponse.leadId
          ? { ...lead, priority: acceptedResponse.priority }
          : lead)
        .sort((left, right) => right.priority - left.priority || left.leadId.localeCompare(right.leadId))
        .slice(0, leadCap);
    } catch (error) {
      rejectionReason = error instanceof Error ? error.message : "LLM scout rejection";
      scoutStatus = "partial";
      exitCode = 2;
      effectiveMode = requestedMode && configuredMode === "rule-only" ? "rule-only" : "none";
      selectedLeads = leads;
    }
  } else if (mode !== "rule-only") {
    throw new Error("scout modeはrule-onlyまたはllmだけを許可します");
  }
  const result = {
    schemaVersion: "lakda/lead-report-index/v1",
    runId,
    leadCount: selectedLeads.length,
    leads: selectedLeads.map(lead => lead.leadId),
    generatedAt: new Date().toISOString(),
    scoutStatus,
    requestedMode: mode,
    effectiveMode,
    signals,
    leadObjects: selectedLeads,
    context,
  };
  const out = stringFlag(flags, "out")
    ?? resolve(stringFlag(flags, "out-dir") ?? config.outputDir, "leads.json");
  await writeCanonicalJson(out, result);
  await writeScoutEvidence(resolve(out, "..", "scout-evidence.jsonl"), {
    context,
    ...(response !== undefined ? { response } : {}),
    accepted: scoutStatus === "completed",
    ...(rejectionReason ? { rejectionReason } : {}),
    modelAttestation: {
      expectedModelId: config.llm.expectedModelId,
      modelSha256: config.llm.modelSha256 ?? "unavailable",
      runtimeEvidence: config.llm.runtimeEvidence,
    },
    runRevision,
  });
  console.log(JSON.stringify({ command: "scout", mode, effectiveMode, scoutStatus, out, leadCount: selectedLeads.length }, null, 2));
  return exitCode;
}

export async function reportLeadsCommand(flags: Flags): Promise<number> {
  const runDir = stringFlag(flags, "run-dir", true)!;
  const format = stringFlag(flags, "format", true);
  if (format !== "json" && format !== "html") throw new Error("--formatはjsonまたはhtmlです");
  const candidates = [
    resolve(runDir, "adaptive", "leads.json"),
    resolve(runDir, "leads.json"),
  ];
  const source = candidates.find(path => existsSync(path));
  if (!source) throw new Error("leads.jsonがありません");
  const report = await readJson(source);
  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  const escape = (value: string) => value.replace(
    /[&<>"]/g,
    character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character),
  );
  const leads = report
    && typeof report === "object"
    && Array.isArray((report as Record<string, unknown>).leadObjects)
    ? (report as Record<string, unknown>).leadObjects as ExplorationLead[]
    : [];
  const html = "<!doctype html><meta charset=\"utf-8\"><title>Lakda Leads</title><h1>Lakda Leads</h1><ul>"
    + leads.map(lead => "<li>" + escape(lead.leadId) + " priority=" + String(lead.priority)
      + " status=" + escape(lead.status) + "</li>").join("")
    + "</ul>";
  const out = stringFlag(flags, "out");
  if (out) await writeTextArtifact(out, html);
  else console.log(html);
  return 0;
}

async function writeTextArtifact(path: string, text: string): Promise<void> {
  const { writeText } = await import("../core/artifact-store.js");
  await writeText(path, text);
}
