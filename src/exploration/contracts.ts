import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLoopbackEndpoint } from "../core/safety.js";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { assertNoSensitivePublicData } from "../adaptive/contracts.js";
import type { AdaptiveConfig, TargetRef } from "../adaptive/contracts.js";

export const EXPLORATION_CHARTER_VERSION = "lakda/exploration-charter/v1" as const;
export const EXPLORATION_CAPABILITY_VERSION = "lakda/exploration-capability/v1" as const;
export const EXPLORATION_SESSION_VERSION = "lakda/exploration-session/v1" as const;
export const EXPLORATION_FINDING_VERSION = "lakda/exploration-finding/v1" as const;
export const EXPLORATION_REPORT_VERSION = "lakda/exploration-report/v1" as const;
export type ExplorationPlatform = "pc-web" | "mobile-web" | "windows" | "android" | "ios";
export type ExplorationExecutionMode = "fixture" | "real" | "emulator" | "mock";
export type ExplorationAdapterId = "playwright" | "airtest-poco";
export type ExplorationSessionStatus = "draft" | "running" | "paused" | "completed" | "aborted";
export type ExplorationFindingKind = "crash" | "freeze" | "no-visual-change" | "unknown-screen" | "visual-anomaly";
export type ExplorationProfile = {
  settlePolicy?: { policyVersion: string; maxWaitMs: number; stableWindowMs: number; readiness?: { testId?: string; role?: string; name?: string; state?: "visible" | "hidden" }; networkQuietExclusions?: string[] };
  fingerprintPolicy?: { algorithmVersion: string; canonicalizationVersion: string };
  recovery?: { maxBacktracks: number; maxAttemptsPerState: number };
};

export type ExplorationCharter = {
  schemaVersion: typeof EXPLORATION_CHARTER_VERSION;
  charterId: string;
  targetRevision: string;
  platform: ExplorationPlatform;
  executionMode: ExplorationExecutionMode;
  /** real laneでは署名済みexploration-target-manifestを必須とする。 */
  targetManifestPath?: string;
  trustStorePath?: string;
  adapter: { id: ExplorationAdapterId; endpoint?: string; initialTarget?: TargetRef };
  baseUrl?: string;
  configPath?: string;
  persona: string;
  scope: { allowHosts: string[]; pathPrefixes?: string[]; native?: { appId: string; surfaces: string[]; denyZones: Array<{ x: number; y: number; width: number; height: number; surface?: string }> } };
  budget: { durationMs: number; maxActions: number; maxActionsPerMinute: number };
  stopWhen: Record<string, unknown>;
  generator: { strategy: "autonomous-uncovered"; version: "autonomous-uncovered/v1" };
  capture: {
    video: "retain-on-finding-or-non-pass" | "off";
    screenshot: "finding-non-pass-bookmark";
    binaryAttestation?: { stagingRoot: string; policyDigest: string; timeoutMs?: number };
    sampledFrames: { enabled: boolean; intervalMs: number; maxFrames: number; maxBytes: number; source: "operator-bridge" | "playwright"; stopTimeoutMs: number };
  };
  templateCorpusVersion: string;
  templateCorpus?: { path: string; version: string; sha256: string };
  seed: number;
  outputDir?: string;
  /** safetyを変更できない、型付きの探索profileだけを許可する。旧adaptive上書きは受け付けない。 */
  profile?: ExplorationProfile;
};

export type ExplorationCapabilitySnapshot = {
  schemaVersion: typeof EXPLORATION_CAPABILITY_VERSION;
  lane: ExplorationPlatform;
  adapterId: string;
  capabilityRevision: string;
  targetRevision: string;
  executionMode?: ExplorationExecutionMode;
  capturedAt: string;
  targetKinds: string[];
  device?: { platform?: "windows" | "android" | "ios"; platformVersion?: string; modelClass?: string; serialDigest?: string; deviceAliasDigest?: string; appId?: string; appRevision?: string; runtimeVersion?: string; airtestVersion?: string; pocoVersion?: string };
  display?: { width?: number; height?: number; orientation?: "portrait" | "landscape" | "unknown"; surface?: string };
  observation: { screen: boolean; templateMatch: boolean; pocoHierarchy: boolean };
  input: { tap: boolean; text: boolean; back: boolean };
  capture: { screenshot: boolean; video: boolean; sampledFrames: boolean };
  liveness: { connected: boolean; responsive: boolean };
  bridgeDigest?: string;
  templateCorpusDigest?: string;
  rawCapabilityDigest?: string;
};

export type ExplorationFinding = {
  schemaVersion: typeof EXPLORATION_FINDING_VERSION;
  findingId: string; sessionId: string; platform: ExplorationPlatform; kind: ExplorationFindingKind;
  status: "exploratory-finding"; severity: "info" | "warning" | "major" | "critical";
  message: string; observedAt: string; targetRevision: string; oracleRefs: string[]; evidenceRefs: string[]; requirementRefs: string[];
  replayRef?: string; bookmark?: boolean;
};

export type ExplorationSession = {
  schemaVersion: typeof EXPLORATION_SESSION_VERSION;
  sessionId: string; charterDigest: string; configDigest: string; platform: ExplorationPlatform; lane: string;
  status: ExplorationSessionStatus; createdAt: string; updatedAt: string; charterPath?: string; capabilitySnapshotPath?: string; checkpointPath?: string;
  eventCount: number; actionCount: number; runIds: string[]; findingIds: string[]; capabilityDigest?: string; lastFingerprint?: string; lastRunDir?: string; blockers?: string[];
  eventHeadDigest?: string; parentSessionId?: string; activeDurationMs?: number; targetManifestDigest?: string; technicalOutcome?: "passed" | "failed" | "partial" | "error"; terminationReason?: string;
  /** session-level HATE manifestの固定相対path。run manifestはdigest付きでrunManifestRefsへ登録する。 */
  hateManifestPath?: string;
  runManifestRefs?: Array<{ runId: string; path: string; sha256: string; size: number }>;
};

export type ExplorationSessionEvent = {
  schemaVersion: typeof EXPLORATION_SESSION_VERSION; eventId: string; sessionId: string; at: string;
  type: "session-created" | "session-forked" | "capability-snapshot" | "session-started" | "session-paused" | "session-resumed" | "kill-switch" | "bookmark" | "finding" | "checkpoint" | "session-completed" | "session-aborted";
  status?: ExplorationSessionStatus; payload?: Record<string, unknown>; sequence?: number; previousDigest?: string; eventDigest?: string;
};

export type ExplorationReport = {
  schemaVersion: typeof EXPLORATION_REPORT_VERSION; sessionId: string; status: ExplorationSessionStatus | "pending_external"; charterDigest: string;
  platform: ExplorationPlatform; lane: string; targetRevision: string; executionMode?: ExplorationExecutionMode;
  coverage: { actions: number; states: number; transitions: number; unexplored: string[]; timeline?: Array<Record<string, unknown>> };
  findings: ExplorationFinding[]; blockers: string[]; capture: { screenshots: number; videos: number; sampledFrames: number; failures: string[] };
  residualRisk: string[]; goNoGo: "external-qeg-required"; runIds?: string[];
  sessionStatus?: ExplorationSessionStatus; technicalOutcome?: "passed" | "failed" | "partial" | "error"; terminationReason?: string; acceptanceStatus?: "fixture_only" | "pending_external" | "eligible" | "rejected";
};

type Validator = ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> };
type AjvConstructor = new (options: object) => { compile(schema: object): Validator; addSchema(schema: object): void; getSchema(id: string): Validator | undefined };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ajv = new Ajv({ allErrors: true, strict: false });
const schema = (name: string): object => JSON.parse(readFileSync(resolve(root, "schemas", name), "utf8")) as object;
const findingSchema = schema("lakda-exploration-finding-v1.schema.json");
ajv.addSchema(findingSchema);
const validators = {
  charter: ajv.compile(schema("lakda-exploration-charter-v1.schema.json")),
  capability: ajv.compile(schema("lakda-exploration-capability-v1.schema.json")),
  session: ajv.compile(schema("lakda-exploration-session-v1.schema.json")),
  finding: ajv.getSchema("https://local.invalid/lakda/exploration-finding/v1")!,
  report: ajv.compile(schema("lakda-exploration-report-v1.schema.json")),
};

function assertSchema(validate: Validator, value: unknown, label: string): void {
  if (!validate(value)) throw new Error(`${label} schemaに適合しません: ${validate.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  assertNoSensitivePublicData(value);
}

export function assertExplorationCharter(value: unknown): asserts value is ExplorationCharter {
  assertSchema(validators.charter, value, "exploration charter");
  const charter = value as ExplorationCharter;
  if (!charter.executionMode) throw new Error("exploration charterにはexecutionModeが必要です");
  if (charter.executionMode === "real" && !charter.targetManifestPath) throw new Error("real探索には署名済みtargetManifestPathが必要です");
  if (charter.executionMode === "real" && !charter.trustStorePath) throw new Error("real探索にはoperator trustStorePathが必要です");
  if (charter.capture.sampledFrames.enabled && (charter.capture.sampledFrames.maxFrames < 1 || charter.capture.sampledFrames.maxBytes < 1)) throw new Error("sampled framesには正のmaxFrames/maxBytesが必要です");
  if (charter.platform === "pc-web" || charter.platform === "mobile-web") {
    if (charter.adapter.id !== "playwright" || !charter.baseUrl) throw new Error("Web laneにはplaywrightとbaseUrlが必要です");
  } else {
    if (charter.adapter.id !== "airtest-poco" || !charter.adapter.endpoint || !charter.adapter.initialTarget) throw new Error("device laneにはairtest-pocoのloopback endpointとinitialTargetが必要です");
    assertLoopbackEndpoint(charter.adapter.endpoint);
  }
  if (charter.adapter.endpoint) assertLoopbackEndpoint(charter.adapter.endpoint);
  if (charter.baseUrl) {
    const url = new URL(charter.baseUrl);
    const host = url.hostname;
    if (!charter.scope.allowHosts.includes(host)) throw new Error("charter baseUrl hostはscope.allowHostsに必要です");
    if (charter.scope.pathPrefixes?.length) {
      const allowed = charter.scope.pathPrefixes.some(prefix => prefix === "/" || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
      if (!allowed) throw new Error("charter baseUrl pathはscope.pathPrefixesに必要です");
    }
  }
}

export function assertExplorationCapabilitySnapshot(value: unknown): asserts value is ExplorationCapabilitySnapshot { assertSchema(validators.capability, value, "exploration capability"); }
export function assertExplorationSession(value: unknown): asserts value is ExplorationSession { assertSchema(validators.session, value, "exploration session"); }
export function assertExplorationFinding(value: unknown): asserts value is ExplorationFinding { assertSchema(validators.finding, value, "exploration finding"); }
export function assertExplorationReport(value: unknown): asserts value is ExplorationReport { assertSchema(validators.report, value, "exploration report"); }

export function explorationDigest(value: unknown): string { return `sha256:${sha256(canonicalJson(value))}`; }

/** Capture timestampを除いた、resume時に再照合するcapability binding。 */
export function capabilitySnapshotDigest(snapshot: ExplorationCapabilitySnapshot): string {
  const stable: Record<string, unknown> = { ...snapshot };
  delete stable.capturedAt;
  delete stable.rawCapabilityDigest;
  return explorationDigest(stable);
}

export function adaptiveConfigFromCharter(charter: ExplorationCharter): AdaptiveConfig {
  const targetKind = charter.adapter.initialTarget?.kind ?? (charter.platform === "pc-web" || charter.platform === "mobile-web" ? "page" : "device");
  const fallback: AdaptiveConfig = {
    schemaVersion: "lakda/adaptive-config/v1",
    adapter: { id: charter.adapter.id, ...(charter.adapter.endpoint ? { endpoint: charter.adapter.endpoint } : {}), ...(charter.adapter.initialTarget ? { initialTarget: charter.adapter.initialTarget } : {}) },
    generator: charter.generator,
    stopWhen: charter.stopWhen as AdaptiveConfig["stopWhen"],
    settlePolicy: { policyVersion: "settle/v1", maxWaitMs: 5_000, stableWindowMs: 100 },
    fingerprintPolicy: { algorithmVersion: "sha256/v1", canonicalizationVersion: "canonical/v1" },
    recovery: { maxBacktracks: 2, maxAttemptsPerState: 1 },
    safety: { allowTargetKinds: [targetKind], denyActionIds: [], allowMutationKinds: ["none"] },
  };
  const safeProfile = charter.profile ?? {};
  return {
    ...fallback,
    ...(safeProfile.settlePolicy ? { settlePolicy: safeProfile.settlePolicy as AdaptiveConfig["settlePolicy"] } : {}),
    ...(safeProfile.fingerprintPolicy ? { fingerprintPolicy: safeProfile.fingerprintPolicy as AdaptiveConfig["fingerprintPolicy"] } : {}),
    ...(safeProfile.recovery ? { recovery: safeProfile.recovery as AdaptiveConfig["recovery"] } : {}),
    schemaVersion: "lakda/adaptive-config/v1",
    adapter: { id: charter.adapter.id, ...(charter.adapter.endpoint ? { endpoint: charter.adapter.endpoint } : {}), ...(charter.adapter.initialTarget ? { initialTarget: charter.adapter.initialTarget } : {}) },
    generator: charter.generator,
    stopWhen: charter.stopWhen as AdaptiveConfig["stopWhen"],
  };
}

export function capabilitySnapshotFromAdapter(input: { charter: ExplorationCharter; adapterId: string; revision: string; observedTargetRevision?: string; runtimePlatform?: "windows" | "android" | "ios"; targetKinds: string[]; observationCapabilities: string[]; actionCapabilities: string[]; evidenceCapabilities: string[]; connected?: boolean; liveness?: { connected: boolean; responsive: boolean }; bridgeDigest?: string; templateCorpusDigest?: string; rawCapabilityDigest?: string; device?: ExplorationCapabilitySnapshot["device"]; display?: ExplorationCapabilitySnapshot["display"] }): ExplorationCapabilitySnapshot {
  const has = (values: string[], ...names: string[]) => names.some(name => values.includes(name));
  if (input.charter.executionMode === "real" && !input.observedTargetRevision) throw new Error("real探索のcapability snapshotには実観測targetRevisionが必要です");
  const snapshot: ExplorationCapabilitySnapshot = {
    schemaVersion: EXPLORATION_CAPABILITY_VERSION, lane: input.charter.platform, adapterId: input.adapterId, capabilityRevision: input.revision, targetRevision: input.observedTargetRevision ?? input.charter.targetRevision, executionMode: input.charter.executionMode,
    capturedAt: new Date().toISOString(), targetKinds: [...input.targetKinds],
    ...(input.runtimePlatform || input.device ? { device: { ...(input.device ?? {}), ...(input.runtimePlatform ? { platform: input.runtimePlatform } : {}) } } : {}),
    ...(input.display ? { display: input.display } : {}),
    observation: { screen: has(input.observationCapabilities, "screen", "screenshot"), templateMatch: has(input.observationCapabilities, "template-match", "image"), pocoHierarchy: has(input.observationCapabilities, "poco", "hierarchy") },
    input: { tap: has(input.actionCapabilities, "tap", "click"), text: has(input.actionCapabilities, "text", "fill", "input"), back: has(input.actionCapabilities, "back") },
    capture: { screenshot: has(input.evidenceCapabilities, "screenshot", "screen"), video: has(input.evidenceCapabilities, "video", "recording"), sampledFrames: has(input.evidenceCapabilities, "sampled-frames/v1", "sampled-frames") },
    liveness: input.liveness ?? { connected: input.connected ?? true, responsive: input.connected ?? true },
    ...(input.bridgeDigest ? { bridgeDigest: input.bridgeDigest } : {}),
    ...(input.templateCorpusDigest ? { templateCorpusDigest: input.templateCorpusDigest } : {}),
  };
  snapshot.rawCapabilityDigest = input.rawCapabilityDigest ?? capabilitySnapshotDigest(snapshot);
  assertExplorationCapabilitySnapshot(snapshot);
  return snapshot;
}

export function assertExplorationCapabilityForCharter(charter: ExplorationCharter, snapshot: ExplorationCapabilitySnapshot): void {
  assertExplorationCharter(charter);
  assertExplorationCapabilitySnapshot(snapshot);
  if (snapshot.lane !== charter.platform || snapshot.adapterId !== charter.adapter.id || snapshot.targetRevision !== charter.targetRevision) {
    throw new Error("capability snapshotとCharterのlane/adapter/targetRevisionが一致しません");
  }
  if (!snapshot.liveness.connected || !snapshot.liveness.responsive) throw new Error("探索laneのoperator bridgeが接続済みかつ応答可能である必要があります");
  const initialKind = charter.adapter.initialTarget?.kind;
  if (initialKind && !snapshot.targetKinds.includes(initialKind)) throw new Error("探索laneのinitialTarget capabilityが不足しています");
  if (!snapshot.observation.screen || !snapshot.input.tap) throw new Error("探索laneにはscreen観測とtap入力capabilityが必要です");
  if (!snapshot.capture.screenshot) throw new Error("探索laneにはfinding/non-pass用screenshot capabilityが必要です");
  const nativeLane = charter.platform === "windows" || charter.platform === "android" || charter.platform === "ios";
  if (!nativeLane) return;
  if (!charter.scope.native) throw new Error("native探索laneにはappId/surface/deny zoneを含むnative scopeが必要です");
  if (snapshot.device?.platform !== charter.platform) throw new Error("native探索laneとoperator bridge platformが一致しません");
  if (charter.templateCorpus) {
    if (!snapshot.templateCorpusDigest) throw new Error("native探索laneにはbridgeが観測したtemplate corpus digestが必要です");
    if (snapshot.templateCorpusDigest !== charter.templateCorpus.sha256) throw new Error("native探索laneのtemplate corpus digestがCharterと不一致です");
  }
  if (snapshot.device?.appId !== charter.scope.native.appId) throw new Error("native探索laneのappIdがscopeと一致しません");
  if (!snapshot.display?.surface || !charter.scope.native.surfaces.includes(snapshot.display.surface)) throw new Error("native探索laneのsurfaceがscope外または未観測です");
  if (!snapshot.observation.templateMatch && !snapshot.observation.pocoHierarchy) throw new Error("native探索laneにはTemplateまたはPocoのcandidate capabilityが必要です");
  if (charter.capture.video === "retain-on-finding-or-non-pass" && !snapshot.capture.video && !(charter.capture.sampledFrames.enabled && snapshot.capture.sampledFrames)) {
    throw new Error("native探索laneにはvideoまたは明示有効なsampled frames capabilityが必要です");
  }
}
