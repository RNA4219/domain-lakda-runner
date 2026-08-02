import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import type { ActionCandidate, CandidateDiscoveryResult, CoverageDebt, ExecutionResult, Observation, OracleResult } from "./contracts.js";

export type VisualRegion = { x: number; y: number; width: number; height: number };
export type VisualIdentity = { resolution: string; orientation: "portrait" | "landscape" | "unknown"; surface: string };
export type VisualCandidate = NonNullable<ActionCandidate["visual"]>;
export type VisualCandidateInput = { source: VisualCandidate["source"]; confidence: number; region: VisualRegion; requiredCapabilities: string[]; identity: VisualIdentity };

export function normalizeVisualRegion(region: { x: number; y: number; width: number; height: number }, display: { width: number; height: number }): VisualRegion {
  if (![display.width, display.height].every(value => Number.isFinite(value) && value > 0)) throw new Error("visual display dimensions must be positive");
  const normalized = { x: region.x / display.width, y: region.y / display.height, width: region.width / display.width, height: region.height / display.height };
  if (normalized.x < 0 || normalized.y < 0 || normalized.width <= 0 || normalized.height <= 0 || normalized.x + normalized.width > 1 || normalized.y + normalized.height > 1) throw new Error("visual region is outside normalized display bounds");
  return normalized;
}

export function visualCandidateId(input: { sourceFingerprint: string; actionKind: string; region: VisualRegion; identity: VisualIdentity }): string {
  return `visual-${sha256(canonicalJson(input)).slice(0, 24)}`;
}

export function assertVisualCandidate(candidate: ActionCandidate, availableCapabilities: string[] = []): void {
  const visual = candidate.visual;
  const visualAction = candidate.adapterId === "airtest-poco" && ["tap", "click", "poco-tap"].includes(candidate.actionKind);
  if (!visual) {
    if (visualAction) throw new Error("Airtest/Poco tap candidateにはvisual provenanceが必要です");
    return;
  }
  if (!Number.isFinite(visual.confidence) || visual.confidence < 0 || visual.confidence > 1) throw new Error("visual candidate confidence must be between 0 and 1");
  const region = visual.region;
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite)) throw new Error("visual candidate region must be finite");
  if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1) throw new Error("visual candidate region is outside normalized bounds");
  if (!visual.source || !visual.identity?.resolution || !visual.identity?.surface) throw new Error("visual candidate provenance is incomplete");
  if (visual.requiredCapabilities.some(capability => !availableCapabilities.includes(capability))) throw new Error("visual candidate requires an unavailable capability");
  if (["coordinate", "point", "xy"].includes(candidate.locatorRecipe.strategy)) throw new Error("visual candidate cannot use raw coordinate locator");
}

export function unknownScreenDebt(observation: Observation, targetFingerprint: string): CoverageDebt {
  return { schemaVersion: "lakda-coverage-debt/v1", debtId: `unknown-screen-${observation.observationId}`, reason: "unknown-screen", actionKind: "visual-observation", scope: "unavailable", targetFingerprint };
}

export function unknownScreenOracle(observation: Observation, targetFingerprint: string): OracleResult {
  return {
    schemaVersion: "lakda/adaptive-contracts/v1" as const, oracleId: `exploration:unknown-screen:${observation.observationId}`, oracleClass: "generic" as const,
    verdict: "inconclusive" as const, severity: "warning" as const, sourceRefs: [observation.observationId, targetFingerprint], requirementRefs: ["REQ-AX-008", "REQ-AX-013"], evidenceRefs: [],
    message: "安全なvisual candidateを解決できない画面をunknown-screenとして記録しました",
  };
}

export type ExplorationOracleKind = "crash" | "freeze" | "no-visual-change" | "unknown-screen" | "visual-anomaly";

function visualStateRef(observation: Observation): string | undefined {
  if (typeof observation.adapterDataRef === "string" && observation.adapterDataRef.trim()) return observation.adapterDataRef;
  for (const key of ["visualDigest", "screenDigest", "perceptualDigest", "imageDigest"]) {
    const value = observation.ui[key];
    if (typeof value === "string" && value.trim()) return `${key}:${value}`;
  }
  const screen = observation.ui.screen;
  if (typeof screen === "string" && screen.trim() && screen !== "unknown") return `screen:${screen}`;
  if (screen && typeof screen === "object") {
    const digest = (screen as Record<string, unknown>).digest;
    if (typeof digest === "string" && digest.trim()) return `screen-digest:${digest}`;
  }
  return undefined;
}

/** 探索lane専用の5種類のmachine oracle。既存adaptiveのgeneric/product oracle契約には混ぜない。 */
export function explorationOracleResults(input: { candidate: ActionCandidate; before: Observation; after?: Observation; execution: ExecutionResult }): OracleResult[] {
  const results: OracleResult[] = [];
  const evidenceRefs = input.execution.evidenceRefs;
  const sourceRefs = [...new Set([input.candidate.candidateId, input.execution.executionId, input.before.observationId, ...(input.after ? [input.after.observationId] : [])])];
  const seenKinds = new Set<ExplorationOracleKind>();
  const add = (kind: ExplorationOracleKind, verdict: OracleResult["verdict"], severity: OracleResult["severity"], message: string, requirementRefsForKind: string[]) => {
    // A single action can expose the same signal through multiple adapter fields.
    // Keep one machine oracle per classification and retain all provenance refs.
    if (seenKinds.has(kind)) return;
    seenKinds.add(kind);
    const requirementRefs = [...new Set([...requirementRefsForKind, ...(input.candidate.contract?.requirementRefs ?? [])])];
    results.push({
      schemaVersion: "lakda/adaptive-contracts/v1", oracleId: `exploration:${kind}:${sha256(`${sourceRefs.join(":")}:${message}`).slice(0, 20)}`, oracleClass: "generic", verdict, severity, sourceRefs, requirementRefs, evidenceRefs, message,
    });
  };
  const afterEvents = input.after?.ui.events;
  const events = [...(Array.isArray(input.before.ui.events) ? input.before.ui.events : []), ...(Array.isArray(afterEvents) ? afterEvents : [])];
  const hasCrash = ["target_lost", "infrastructure_error"].includes(input.execution.status)
    || input.execution.settleResult.status === "target_lost"
    || events.some(event => event && typeof event === "object" && ["crash", "pageerror", "target_lost"].includes(String((event as Record<string, unknown>).kind)));
  const hasFreeze = input.execution.status === "timeout"
    || input.execution.settleResult.status === "timed_out"
    || (input.execution.settleResult.status === "aborted" && input.execution.settleResult.reasons.some(reason => /timeout|freeze|unresponsive/i.test(reason)));
  const visualOracleRequirements = ["REQ-AX-013", "REQ-GAME-004"];
  if (hasCrash) add("crash", "fail", "critical", `exploration-crash:${input.execution.status}`, visualOracleRequirements);
  if (hasFreeze) add("freeze", "fail", "major", `exploration-freeze:${input.execution.settleResult.status}`, visualOracleRequirements);
  const beforeRef = visualStateRef(input.before);
  const afterRef = input.after ? visualStateRef(input.after) : undefined;
  const visualRefAvailable = typeof beforeRef === "string" && beforeRef.length > 0 && typeof afterRef === "string" && afterRef.length > 0;
  const unknownBefore = input.before.ui.unknownScreen === true || input.before.ui.screen === "unknown";
  const afterUi = input.after?.ui as Record<string, unknown> | undefined;
  const explicitUnknownScreen = afterUi?.unknownScreen === true || afterUi?.screen === "unknown" || (afterUi?.screen && typeof afterUi.screen === "object" && (afterUi.screen as Record<string, unknown>).unknown === true);
  const unknownScreen = input.after !== undefined && (explicitUnknownScreen || (input.after.completeness === "unavailable" && !hasCrash && !hasFreeze));
  if (input.candidate.visual && input.execution.status === "executed" && input.after && input.before.completeness === "complete" && input.after.completeness === "complete" && !hasCrash && !hasFreeze && !unknownBefore && !unknownScreen && input.execution.postFingerprint === input.execution.preFingerprint && visualRefAvailable && beforeRef === afterRef) {
    add("no-visual-change", "candidate", "warning", "exploration-no-visual-change", visualOracleRequirements);
  }
  const visualAnomaly = afterUi?.visualAnomaly === true || (Array.isArray(afterUi?.visualAnomalies) && afterUi.visualAnomalies.length > 0) || (afterUi?.screen && typeof afterUi.screen === "object" && (afterUi.screen as Record<string, unknown>).anomaly === true);
  if (visualAnomaly) add("visual-anomaly", "fail", "major", "exploration-visual-anomaly", visualOracleRequirements);
  if (unknownScreen) add("unknown-screen", "inconclusive", "warning", "exploration-unknown-screen", ["REQ-AX-008", ...visualOracleRequirements]);
  return results;
}

export type TemplatePocoCandidateProviderInput = {
  observation: Observation;
  candidates: ActionCandidate[];
  coverageDebt?: CoverageDebt[];
  availableCapabilities?: string[];
};

/**
 * Bridgeが返すTemplate Match/Poco候補を、Coreへ渡す前に同じ検査へ通すMVP provider。
 * 画像認識そのものはAirtest/Poco側が担当し、Coreは座標ではなく正規化regionとidentityだけを保存する。
 */
export class TemplatePocoCandidateProvider {
  readonly id = "template-poco";
  readonly version = "template-poco/v1";
  discover(input: TemplatePocoCandidateProviderInput): CandidateDiscoveryResult {
    const capabilities = input.availableCapabilities ?? [];
    const candidates = input.candidates.filter(candidate => { assertVisualCandidate(candidate, capabilities); return true; });
    return { candidates, coverageDebt: input.coverageDebt ?? [] };
  }
}
