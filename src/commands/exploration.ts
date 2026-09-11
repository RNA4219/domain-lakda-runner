import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { runLakda } from "../core/runner.js";
import { validateBinaryAttestationSetup } from "../exploration/attestation-preflight.js";
import { loadConfig } from "../core/config.js";
import { LoopbackJsonBridge } from "../adapters/loopback-json.js";
import type { ExternalToolBridge } from "../adapters/external-bridges.js";
import {
  adaptiveConfigFromCharter,
  assertExplorationCapabilityForCharter,
  assertExplorationCapabilitySnapshot,
  assertExplorationCharter,
  capabilitySnapshotDigest,
  capabilitySnapshotFromAdapter,
  explorationDigest,
  type ExplorationCapabilitySnapshot,
  type ExplorationCharter,
  type ExplorationFindingKind,
} from "../exploration/contracts.js";
import {
  appendSessionEvent,
  buildExplorationReport,
  checkpointFromRun,
  copyTargetManifest,
  createExplorationSession,
  explorationRunRoot,
  loadExplorationCharter,
  loadExplorationSession,
  readFindings,
  resolveRunDirectoryReference,
  runDirectoryReference,
  writeFinding,
  writeCapabilitySnapshot,
  type ExplorationSessionPaths,
} from "../exploration/session.js";
import { loadSignedExplorationTargetManifest, type ExplorationTargetManifest } from "../exploration/target-manifest.js";
import { stringFlag, type Flags } from "../cli/parser.js";
import { fileDigest, writeJsonAtomic } from "../core/artifact-store.js";
import { ActionBudget } from "../core/action-budget.js";
import { aggregateExplorationAcceptance } from "../exploration/acceptance.js";
import { resolveReportConfig } from "../reporting/config.js";
import { generateAutomaticReport } from "../reporting/automatic.js";
import { prepareNativeIdentityRuntime } from "../exploration/native-identity-runtime.js";

const playwrightRuntimeRevision = `playwright-${(createRequire(import.meta.url)("playwright/package.json") as { version: string }).version}`;

export class ExplorationPreflightError extends Error {
  readonly exitCode = 2 as const;
  constructor(message: string, cause?: unknown) { super(message, { cause }); this.name = "ExplorationPreflightError"; }
}

async function readCharter(path: string): Promise<ExplorationCharter> {
  let value: unknown;
  try { value = JSON.parse(await readFile(resolve(path), "utf8")) as unknown; }
  catch { throw new Error(`探索Charterを解析できません: ${path}`); }
  assertExplorationCharter(value);
  return value;
}

function outputRoot(charter: ExplorationCharter): string { return explorationRunRoot(charter); }
function sessionRoot(charter: ExplorationCharter): string { return resolve(join(outputRoot(charter), "..", "explorations")); }

function configForCharter(charter: ExplorationCharter, outputDir: string) {
  const configPath = charter.configPath ? resolve(charter.configPath) : resolve(process.cwd(), "lakda.config.json");
  return loadConfig(configPath, {
    baseUrl: charter.baseUrl,
    mode: "adaptive-explore",
    seed: charter.seed,
    persona: charter.persona,
    durationMs: charter.budget.durationMs,
    // replay prefixもこのrunのaction budgetに数えるため、resume時もCharter全体の上限を渡す。
    maxActions: charter.budget.maxActions,
    outputDir,
    explorationPlatform: charter.platform,
    adaptive: adaptiveConfigFromCharter(charter),
    safety: { allowHosts: charter.scope.allowHosts, pathPrefixes: charter.scope.pathPrefixes, maxActionsPerMinute: charter.budget.maxActionsPerMinute, ...(charter.scope.native ? { explorationDenyZones: charter.scope.native.denyZones } : {}) },
    artifacts: { video: charter.capture.video === "off" ? false : "retain-on-non-pass", trace: "retain-on-non-pass", screenshot: "retain-on-non-pass" },
  });
}

type ExplorationCapabilityResult = { snapshot: ExplorationCapabilitySnapshot; bridge?: ExternalToolBridge; binding?: { capabilityDigest: string; bridgeDigest: string } };

function playwrightBinding(charter: ExplorationCharter, snapshot: ExplorationCapabilitySnapshot): { capabilityDigest: string; bridgeDigest: string } {
  return { capabilityDigest: capabilitySnapshotDigest(snapshot), bridgeDigest: explorationDigest({ transport: "playwright/v1", origin: charter.baseUrl ? new URL(charter.baseUrl).origin : "", targetRevision: snapshot.targetRevision }) };
}

export function assertTemplateCorpusBinding(charter: ExplorationCharter, observedDigest: string | undefined, manifest?: ExplorationTargetManifest): void {
  if (!charter.templateCorpus) {
    if (observedDigest || manifest?.target.templateCorpusDigest) throw new Error("native探索のtemplate corpusがCharterにありません");
    return;
  }
  if (!observedDigest) throw new Error("native探索bridgeは実使用template corpus digestを必須とします");
  if (observedDigest !== charter.templateCorpus.sha256) throw new Error("native探索bridgeのtemplate corpus digestがCharterと不一致です");
  if (manifest && manifest.target.templateCorpusDigest !== observedDigest) throw new Error("native探索bridgeのtemplate corpus digestがtarget manifestと不一致です");
}

export function assertResumeCapabilityBinding(stored: ExplorationCapabilitySnapshot, current: ExplorationCapabilitySnapshot): void {
  if (capabilitySnapshotDigest(stored) !== capabilitySnapshotDigest(current)) throw new Error("resume時のcapability snapshotが一致しません");
  if (stored.rawCapabilityDigest !== current.rawCapabilityDigest) throw new Error("resume時のraw capability digestが一致しません");
}

async function observePlaywrightTargetRevision(charter: ExplorationCharter, manifest: ExplorationTargetManifest): Promise<string> {
  if (!charter.baseUrl) throw new Error("real Web探索にはbaseUrlが必要です");
  const probe = manifest.target.identity.revisionProbe;
  if (!probe) throw new Error("real Web探索target manifestにはrevisionProbeが必要です");
  const response = await fetch(charter.baseUrl, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`real Web探索のrevision probeが失敗しました: HTTP ${response.status}`);
  let actual: string | null;
  if (probe.kind === "response-header") {
    actual = response.headers.get(probe.name);
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("real Web探索のrevision probe responseが大きすぎます");
    const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    actual = null;
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const name = tag.match(/\bname\s*=\s*(["'])(.*?)\1/i)?.[2];
      const content = tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2];
      if (name === probe.name && content !== undefined) { actual = content; break; }
    }
  }
  if (!actual?.trim() || actual.trim() !== charter.targetRevision) throw new Error("real Web探索のtarget revision probeがmanifest/Charterと一致しません");
  return actual.trim();
}

async function capabilityForCharter(charter: ExplorationCharter, manifest?: ExplorationTargetManifest): Promise<ExplorationCapabilityResult> {
  let snapshot: ExplorationCapabilitySnapshot;
  if (charter.adapter.id === "playwright") {
    const observedTargetRevision = charter.executionMode === "real"
      ? await observePlaywrightTargetRevision(charter, manifest ?? (() => { throw new Error("real Web探索にはtarget manifestが必要です"); })())
      : charter.targetRevision;
    const bridgeDigest = explorationDigest({ transport: "playwright/v1", origin: charter.baseUrl ? new URL(charter.baseUrl).origin : "", targetRevision: observedTargetRevision });
    snapshot = capabilitySnapshotFromAdapter({ charter, adapterId: "playwright", revision: playwrightRuntimeRevision, observedTargetRevision, targetKinds: ["page", "frame", "dialog"], observationCapabilities: ["screen", "hierarchy"], actionCapabilities: ["click", "fill", "back"], evidenceCapabilities: ["screenshot", "video"], connected: true, bridgeDigest });
    assertExplorationCapabilityForCharter(charter, snapshot);
    return { snapshot, binding: playwrightBinding(charter, snapshot) };
  } else {
    const bridge = await LoopbackJsonBridge.connect(charter.adapter.endpoint!, "airtest-poco");
    const capabilities = bridge.capabilities();
    if (!capabilities.liveness) throw new Error("native探索bridgeはliveness capabilityを明示する必要があります");
    if (!capabilities.platform) throw new Error("native探索bridgeはplatform capabilityを明示する必要があります");
    if (charter.executionMode === "real" && !capabilities.targetRevision) throw new Error("real native探索bridgeはbridge報告targetRevisionを必須とします");
    const binding = bridge.binding?.();
    const runtime = capabilities.runtime ?? {};
    assertTemplateCorpusBinding(charter, capabilities.templateCorpusDigest, manifest);
    snapshot = capabilitySnapshotFromAdapter({ charter, adapterId: capabilities.adapterId, revision: capabilities.revision, observedTargetRevision: capabilities.targetRevision, runtimePlatform: capabilities.platform, targetKinds: capabilities.targetKinds, observationCapabilities: capabilities.observationCapabilities, actionCapabilities: capabilities.actionKinds, evidenceCapabilities: capabilities.evidenceCapabilities, liveness: capabilities.liveness, connected: true, bridgeDigest: binding?.bridgeDigest, templateCorpusDigest: capabilities.templateCorpusDigest, rawCapabilityDigest: binding?.capabilityDigest, device: { ...(capabilities.device ?? {}), platform: capabilities.platform, ...(runtime.runtimeVersion ? { runtimeVersion: runtime.runtimeVersion } : {}), ...(runtime.airtestVersion ? { airtestVersion: runtime.airtestVersion } : {}), ...(runtime.pocoVersion ? { pocoVersion: runtime.pocoVersion } : {}) }, display: capabilities.display });
    assertExplorationCapabilityForCharter(charter, snapshot);
    return { snapshot, bridge, binding };
  }
  assertExplorationCapabilityForCharter(charter, snapshot);
  return { snapshot, binding: playwrightBinding(charter, snapshot) };
}

function assertTargetManifestBinding(manifest: ExplorationTargetManifest | undefined, capability: ExplorationCapabilityResult): void {
  if (!manifest) return;
  const binding = capability.binding;
  if (!binding || manifest.bridgeBinding.capabilityDigest !== binding.capabilityDigest || manifest.bridgeBinding.bridgeDigest !== binding.bridgeDigest) throw new Error("探索target manifestのbridge/capability bindingが接続時照合値と一致しません");
  if (manifest.targetRevision !== capability.snapshot.targetRevision) throw new Error("探索target manifestのtargetRevisionが接続時照合値と一致しません");
  if (manifest.target.templateCorpusDigest !== capability.snapshot.templateCorpusDigest) throw new Error("探索target manifestのtemplate corpus digestが接続時照合値と一致しません");
  if (manifest.target.identity.appId !== capability.snapshot.device?.appId) throw new Error("探索target manifestのappIdが接続時照合値と一致しません");
  if (manifest.target.identity.appRevision && manifest.target.identity.appRevision !== capability.snapshot.device?.appRevision) throw new Error("探索target manifestのapp revisionが接続時照合値と一致しません");
  if (manifest.target.identity.serialDigest && manifest.target.identity.serialDigest !== capability.snapshot.device?.serialDigest) throw new Error("探索target manifestのserial digestが接続時照合値と一致しません");
  if (manifest.target.identity.deviceAliasDigest && manifest.target.identity.deviceAliasDigest !== capability.snapshot.device?.deviceAliasDigest) throw new Error("探索target manifestのdevice alias digestが接続時照合値と一致しません");
}

async function preflightTarget(charter: ExplorationCharter, config: ReturnType<typeof configForCharter>): Promise<{ manifest?: ExplorationTargetManifest; manifestDigest?: string }> {
  if (charter.executionMode !== "real") return {};
  if (!charter.targetManifestPath) throw new Error("real探索にはtargetManifestPathが必要です");
  if ((charter.platform === "windows" || charter.platform === "android" || charter.platform === "ios") && !charter.templateCorpus) throw new Error("real Airtest/Poco探索にはtemplateCorpus path/version/SHA-256が必要です");
  if (charter.templateCorpus) {
    const templateDigest = await fileDigest(resolve(charter.templateCorpus.path));
    if (`sha256:${templateDigest.sha256}` !== charter.templateCorpus.sha256) throw new Error("探索template corpusのSHA-256が不一致です");
    if (templateDigest.size < 1) throw new Error("探索template corpusが空です");
  }
  const loaded = await loadSignedExplorationTargetManifest(charter.targetManifestPath, charter, explorationDigest(config), { nativeIdentityPolicy: "validate-only" });
  if (loaded.manifest.schemaVersion === "lakda/exploration-target-manifest/v2" && (charter.capture.video !== "off" || charter.capture.sampledFrames.enabled)) throw new Error("native identity v2の連続撮影と接続世代の照合は未接続です");
  const trustStorePath = loaded.manifest.schemaVersion === "lakda/exploration-target-manifest/v2" && charter.trustStorePath
    ? resolve(dirname(resolve(charter.targetManifestPath)), charter.trustStorePath) : charter.trustStorePath;
  if (charter.capture.binaryAttestation) await validateBinaryAttestationSetup({ ...charter.capture.binaryAttestation, targetManifestSha256: loaded.sha256 }, trustStorePath, loaded.manifest.artifactAttestorKeyIds, [config.outputDir, sessionRoot(charter)]);
  if ((charter.platform === "pc-web" || charter.platform === "mobile-web") && !loaded.manifest.target.identity.revisionProbe) throw new Error("real Web探索target manifestにはrevisionProbeが必要です");
  return { manifest: loaded.manifest, manifestDigest: loaded.sha256 };
}

async function persistRunFindings(paths: ExplorationSessionPaths, charter: ExplorationCharter, runDir: string | undefined): Promise<void> {
  if (!runDir) return;
  const source = join(runDir, "adaptive", "oracle-results.jsonl");
  if (!existsSync(source)) return;
  const existing = new Set((await readFindings(paths)).map(finding => finding.findingId));
  const sessionId = (await loadExplorationSession(paths.root)).session.sessionId;
  const lines = (await readFile(source, "utf8")).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const oracle = JSON.parse(line) as { oracleId?: string; severity?: "info" | "warning" | "major" | "critical"; message?: string; evidenceRefs?: Array<{ artifactId: string }>; sourceRefs?: string[]; requirementRefs?: string[] };
    const message = oracle.message ?? "exploration oracle";
    const lower = message.toLowerCase();
    const idKind = oracle.oracleId?.match(/^exploration:(crash|freeze|no-visual-change|unknown-screen|visual-anomaly):/)?.[1] as ExplorationFindingKind | undefined;
    const kind: ExplorationFindingKind | undefined = idKind ?? (lower.includes("unknown-screen") ? "unknown-screen"
      : lower.includes("freeze") || lower.includes("unresponsive") ? "freeze"
        : lower.includes("no-visual-change") || lower.includes("visual-change") ? "no-visual-change"
          : lower.includes("visual-anomaly") || lower.includes("anomaly") ? "visual-anomaly"
            : lower.includes("crash") || lower.includes("pageerror") || lower.includes("target_lost") ? "crash" : undefined);
    if (!kind || !oracle.oracleId) continue;
    const findingId = `finding-${oracle.oracleId.replace(/[^A-Za-z0-9._:-]/g, "-")}`;
    if (existing.has(findingId)) continue;
    const requirementRefs = oracle.requirementRefs ?? (kind === "unknown-screen" ? ["REQ-AX-008", "REQ-AX-013", "REQ-GAME-004"] : ["REQ-AX-013", "REQ-GAME-004"]);
    await writeFinding(paths, { schemaVersion: "lakda/exploration-finding/v1", findingId, sessionId, platform: charter.platform, kind, status: "exploratory-finding", severity: oracle.severity ?? "warning", message, observedAt: new Date().toISOString(), targetRevision: charter.targetRevision, oracleRefs: [oracle.oracleId], evidenceRefs: (oracle.evidenceRefs ?? []).map(ref => ref.artifactId), requirementRefs });
    existing.add(findingId);
  }
}

async function executeSession(paths: ExplorationSessionPaths, charter: ExplorationCharter, resumed: boolean, bridge?: ExternalToolBridge, manifest?: ExplorationTargetManifest, manifestDigest?: string, nativeTrustStorePath?: string): Promise<number> {
  const loaded = await loadExplorationSession(paths.root);
  const replayPrefix = resumed ? loaded.session.actionCount : 0;
  const config = configForCharter(charter, outputRoot(charter));
  if (loaded.session.configDigest !== explorationDigest(config) && !resumed) throw new Error("探索設定のdigestがCharter作成時と一致しません");
  if (resumed && loaded.session.configDigest !== explorationDigest(configForCharter(charter, outputRoot(charter)))) throw new Error("resume時のCharter/config digestが一致しません");
  const checkpoint = resumed && existsSync(paths.checkpoint) ? JSON.parse(await readFile(paths.checkpoint, "utf8")) as { activeDurationMs?: number; actionTimestamps?: number[] } : {};
  const actionBudget = new ActionBudget(charter.budget.maxActionsPerMinute, undefined, Array.isArray(checkpoint.actionTimestamps) ? checkpoint.actionTimestamps : []);
  const current = await appendSessionEvent(paths, { type: resumed ? "session-resumed" : "session-started", status: "running", payload: { configDigest: explorationDigest(config), ...(manifestDigest ? { targetManifestDigest: manifestDigest } : {}) } });
  const startedAt = Date.now();
  try {
    const replayInput = resumed && replayPrefix > 0 && loaded.session.lastRunDir ? join(resolveRunDirectoryReference(outputRoot(charter), loaded.session.lastRunDir), "adaptive", "replay-trace.json") : undefined;
    const runtime = {
      controlFile: paths.control,
      explorationCapture: { sampledFrames: charter.capture.sampledFrames },
      ...(charter.capture.binaryAttestation ? { binaryAttestation: { ...charter.capture.binaryAttestation, targetManifestSha256: manifestDigest ?? "", sessionId: current.sessionId } } : {}),
      actionBudget,
      ...(charter.executionMode === "real" ? { requireBinaryAttestation: true, ...(charter.trustStorePath ? { attestationTrustStorePath: nativeTrustStorePath ?? resolve(charter.trustStorePath) } : {}), artifactAttestorKeyIds: manifest?.artifactAttestorKeyIds ?? [] } : {}),
      ...(manifest?.target.identity.revisionProbe ? { explorationTargetRevisionProbe: { ...manifest.target.identity.revisionProbe, expected: charter.targetRevision } } : {}),
      ...(bridge ? { adaptiveBridge: bridge } : {}),
      ...(resumed ? { adaptiveReplayPrefixActions: replayPrefix, ...(loaded.session.lastFingerprint ? { adaptiveExpectedFingerprint: loaded.session.lastFingerprint } : {}) } : {}),
    };
    const result = await runLakda(config, replayInput && existsSync(replayInput) ? replayInput : undefined, runtime);
    const runDir = result.actionSequencePath ? dirname(result.actionSequencePath) : undefined;
    const runDirectoryRef = runDir ? runDirectoryReference(outputRoot(charter), runDir) : undefined;
    await persistRunFindings(paths, charter, runDir);
    const activeDurationMs = (checkpoint.activeDurationMs ?? 0) + Math.max(0, Date.now() - startedAt);
    await checkpointFromRun(paths, { runId: result.runId, ...(runDir ? { runDir } : {}), ...(runDirectoryRef ? { runDirectoryRef } : {}), ...(result.artifactManifestPath ? { artifactManifestPath: result.artifactManifestPath } : {}), ...(resumed ? { actionOffset: replayPrefix } : {}), activeDurationMs, actionTimestamps: actionBudget.snapshot() });
    let operatorCommand: "pause" | "kill" | undefined;
    if (runDir) {
      try {
        const trace = JSON.parse(await readFile(join(runDir, "adaptive", "trace.json"), "utf8")) as { trace?: Array<Record<string, unknown>> };
        const control = [...(trace.trace ?? [])].reverse().find(entry => entry.type === "operator-control" && (entry.command === "pause" || entry.command === "kill"));
        operatorCommand = control?.command as "pause" | "kill" | undefined;
        for (const entry of trace.trace ?? []) if (entry.type === "operator-bookmark") await appendSessionEvent(paths, { type: "bookmark", payload: { runId: result.runId, ...(typeof entry.requestId === "string" ? { requestId: entry.requestId } : {}), ...(typeof entry.actionCount === "number" ? { actionCount: entry.actionCount } : {}) } });
      } catch { /* trace integrity is reported by checkpoint/report validation */ }
      try {
        const metadata = JSON.parse(await readFile(join(runDir, "run-metadata.json"), "utf8")) as { runId?: unknown; operatorControl?: { command?: unknown } };
        const command = metadata.operatorControl?.command;
        if (metadata.runId === result.runId && (command === "pause" || command === "kill")) operatorCommand = command;
      } catch { /* Missing final metadata cannot supply an operator command. */ }
    }
    if (operatorCommand === "kill") {
      await appendSessionEvent(paths, { type: "kill-switch", status: "aborted", payload: { runId: result.runId, activeDurationMs, terminationReason: "operator-kill-switch", technicalOutcome: result.outcome, ...(runDirectoryRef ? { lastRunDir: runDirectoryRef } : {}) } });
      const report = await buildExplorationReport(paths, { nativeTrustStorePath });
      console.log(JSON.stringify({ ...result, sessionId: current.sessionId, reportPath: paths.report, report }, null, 2));
      return result.exitCode;
    }
    const paused = operatorCommand === "pause" || result.terminationReason === "hold";
    const errored = result.outcome === "error" || result.terminationReason === "executor_error";
    await appendSessionEvent(paths, { type: errored ? "session-aborted" : paused ? "session-paused" : "session-completed", status: errored ? "aborted" : paused ? "paused" : "completed", payload: { runId: result.runId, ...(runDirectoryRef ? { lastRunDir: runDirectoryRef } : {}), actionCount: (await loadExplorationSession(paths.root)).session.actionCount, activeDurationMs, technicalOutcome: result.outcome, terminationReason: result.terminationReason, ...(errored ? { blockers: ["adaptive-executor-error"] } : {}) } });
    const report = await buildExplorationReport(paths, { nativeTrustStorePath });
    console.log(JSON.stringify({ ...result, sessionId: current.sessionId, reportPath: paths.report, report }, null, 2));
    return result.exitCode;
  } catch (error) {
    await appendSessionEvent(paths, { type: "session-aborted", status: "aborted", payload: { blockers: [error instanceof Error ? error.message : String(error)] } });
    await buildExplorationReport(paths, { nativeTrustStorePath }).catch(() => undefined);
    throw error;
  }
}

export async function exploreRunCommand(flags: Flags): Promise<number> {
  const reporting = await resolveReportConfig(flags);
  const charter = await readCharter(stringFlag(flags, "charter", true)!);
  const config = configForCharter(charter, outputRoot(charter));
  const created = await createExplorationSession(charter, config, sessionRoot(charter));
  let preflight: { manifest?: ExplorationTargetManifest; manifestDigest?: string };
  let capability: ExplorationCapabilityResult;
  let native: Awaited<ReturnType<typeof prepareNativeIdentityRuntime>> | undefined;
  try {
    preflight = await preflightTarget(charter, config);
    if (preflight.manifestDigest && charter.targetManifestPath) await copyTargetManifest(created.paths, charter.targetManifestPath, preflight.manifestDigest);
    if (preflight.manifestDigest) await appendSessionEvent(created.paths, { type: "capability-snapshot", payload: { targetManifestDigest: preflight.manifestDigest } });
    if (preflight.manifest?.schemaVersion === "lakda/exploration-target-manifest/v2") native = await prepareNativeIdentityRuntime(created.paths, charter, explorationDigest(config), { manifest: preflight.manifest, sha256: preflight.manifestDigest! }, false);
    capability = await capabilityForCharter(charter, preflight.manifest);
    await writeCapabilitySnapshot(created.paths, capability.snapshot);
    assertTargetManifestBinding(preflight.manifest, capability);
    if (native && capability.bridge) capability.bridge = await native.connect(capability.bridge);
  } catch (error) {
    await appendSessionEvent(created.paths, { type: "session-aborted", status: "aborted", payload: { blockers: [error instanceof Error ? error.message : String(error)] } }).catch(() => undefined);
    await buildExplorationReport(created.paths, { nativeTrustStorePath: native?.trustStorePath }).catch(() => undefined);
    await generateAutomaticReport(reporting, { session: created.paths.root });
    throw error instanceof ExplorationPreflightError ? error : new ExplorationPreflightError(error instanceof Error ? error.message : String(error), error);
  }
  try { return await executeSession(created.paths, charter, false, capability.bridge, preflight.manifest, preflight.manifestDigest, native?.trustStorePath); }
  finally { await generateAutomaticReport(reporting, { session: created.paths.root }); }
}

export async function exploreResumeCommand(flags: Flags): Promise<number> {
  const reporting = await resolveReportConfig(flags);
  const loaded = await loadExplorationSession(stringFlag(flags, "session", true)!);
  const charter = await loadExplorationCharter(loaded.paths);
  if (explorationDigest(charter) !== loaded.session.charterDigest) throw new Error("sessionのCharter digestが一致しません");
  if (loaded.session.status !== "paused" && loaded.session.status !== "draft") throw new Error(`sessionはresumeできる状態ではありません: ${loaded.session.status}`);
  if (loaded.session.actionCount > 0) {
    if (!existsSync(loaded.paths.checkpoint) || !loaded.session.lastRunDir || !loaded.session.lastFingerprint) throw new Error("resumeには検証済みcheckpoint、lastRunDir、lastFingerprintが必要です");
    const checkpoint = JSON.parse(await readFile(loaded.paths.checkpoint, "utf8")) as { sessionId?: string; actionCount?: number; lastFingerprint?: string; traceSha256?: string; replayTraceSha256?: string; activeDurationMs?: number; actionTimestamps?: unknown };
    if (checkpoint.sessionId !== loaded.session.sessionId || checkpoint.actionCount !== loaded.session.actionCount || checkpoint.lastFingerprint !== loaded.session.lastFingerprint) throw new Error("checkpointとsession projectionが一致しません。暗黙に継続しません");
    if (!Array.isArray(checkpoint.actionTimestamps) || checkpoint.actionTimestamps.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("resume checkpointのrate budget timestampがありません");
    const tracePath = join(resolveRunDirectoryReference(explorationRunRoot(charter), loaded.session.lastRunDir), "adaptive", "trace.json");
    const replayTracePath = join(resolveRunDirectoryReference(explorationRunRoot(charter), loaded.session.lastRunDir), "adaptive", "replay-trace.json");
    if (!existsSync(tracePath)) throw new Error("resume traceがありません。暗黙に新規runを開始しません");
    const traceValue = JSON.parse(await readFile(tracePath, "utf8")) as { schemaVersion?: string; trace?: unknown };
    if (traceValue.schemaVersion !== "lakda/adaptive-trace/v1" || !Array.isArray(traceValue.trace)) throw new Error("resume trace schemaが不正です");
    if (!checkpoint.traceSha256 || checkpoint.traceSha256 !== `sha256:${(await fileDigest(tracePath)).sha256}`) throw new Error("resume trace digestがcheckpointと一致しません");
    if (!checkpoint.replayTraceSha256 || checkpoint.replayTraceSha256 !== `sha256:${(await fileDigest(replayTracePath)).sha256}`) throw new Error("resume replay trace digestがcheckpointと一致しません");
  }
  if (!existsSync(loaded.paths.capability)) throw new Error("capability snapshotがありません。暗黙に再取得してresumeしません");
  const capability = JSON.parse(await readFile(loaded.paths.capability, "utf8")) as ExplorationCapabilitySnapshot;
  assertExplorationCapabilitySnapshot(capability);
  assertExplorationCapabilityForCharter(charter, capability);
  const storedDigest = capabilitySnapshotDigest(capability);
  if (!loaded.session.capabilityDigest || loaded.session.capabilityDigest !== storedDigest) throw new Error("session capability digestがsnapshotと一致しません");
  let preflight: { manifest?: ExplorationTargetManifest; manifestDigest?: string };
  let currentCapability: ExplorationCapabilityResult;
  let native: Awaited<ReturnType<typeof prepareNativeIdentityRuntime>> | undefined;
  try {
    preflight = await preflightTarget(charter, configForCharter(charter, outputRoot(charter)));
    if (preflight.manifestDigest && charter.targetManifestPath) await copyTargetManifest(loaded.paths, charter.targetManifestPath, preflight.manifestDigest);
    if (preflight.manifest?.schemaVersion === "lakda/exploration-target-manifest/v2") native = await prepareNativeIdentityRuntime(loaded.paths, charter, preflight.manifest.configDigest, { manifest: preflight.manifest, sha256: preflight.manifestDigest! }, loaded.session.status === "paused");
    currentCapability = await capabilityForCharter(charter, preflight.manifest);
    assertResumeCapabilityBinding(capability, currentCapability.snapshot);
    assertTargetManifestBinding(preflight.manifest, currentCapability);
    if (native && currentCapability.bridge) currentCapability.bridge = await native.connect(currentCapability.bridge);
  } catch (error) {
    throw error instanceof ExplorationPreflightError ? error : new ExplorationPreflightError(error instanceof Error ? error.message : String(error), error);
  }
  try { return await executeSession(loaded.paths, charter, loaded.session.status === "paused", currentCapability.bridge, preflight.manifest, preflight.manifestDigest, native?.trustStorePath); }
  finally { await generateAutomaticReport(reporting, { session: loaded.paths.root }); }
}

export async function exploreReportCommand(flags: Flags): Promise<number> {
  const loaded = await loadExplorationSession(stringFlag(flags, "session", true)!);
  const nativeApi = await import("../exploration/native-identity-evidence-target.js");
  const charter = await nativeApi.sessionHasNativeEvidence(loaded.paths) ? await loadExplorationCharter(loaded.paths) : undefined;
  const nativeTrustStorePath = charter?.targetManifestPath && charter.trustStorePath ? resolve(dirname(resolve(charter.targetManifestPath)), charter.trustStorePath) : undefined;
  const report = await buildExplorationReport(loaded.paths, { nativeTrustStorePath });
  const out = stringFlag(flags, "out", true)!;
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(resolve(out), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ sessionId: loaded.session.sessionId, reportPath: resolve(out), status: report.status }, null, 2));
  return 0;
}

async function enqueueControl(paths: ExplorationSessionPaths, command: "pause" | "kill" | "bookmark", reason: string): Promise<string> {
  await mkdir(paths.control, { recursive: true });
  const requestId = randomUUID();
  const path = join(paths.control, `${Date.now()}-${requestId}.json`);
  await writeJsonAtomic(path, { command, reason, requestId });
  return requestId;
}

export async function explorePauseCommand(flags: Flags): Promise<number> {
  const loaded = await loadExplorationSession(stringFlag(flags, "session", true)!);
  if (loaded.session.status !== "running") throw new Error(`sessionはpauseできる状態ではありません: ${loaded.session.status}`);
  const requestId = await enqueueControl(loaded.paths, "pause", "operator-pause");
  console.log(JSON.stringify({ sessionId: loaded.session.sessionId, status: "pause-requested", requestId }, null, 2));
  return 0;
}

export async function exploreKillCommand(flags: Flags): Promise<number> {
  const loaded = await loadExplorationSession(stringFlag(flags, "session", true)!);
  if (loaded.session.status === "completed" || loaded.session.status === "aborted") throw new Error(`sessionはkillできる状態ではありません: ${loaded.session.status}`);
  const requestId = await enqueueControl(loaded.paths, "kill", "operator-kill-switch");
  console.log(JSON.stringify({ sessionId: loaded.session.sessionId, status: "kill-requested", requestId }, null, 2));
  return 0;
}

export async function exploreBookmarkCommand(flags: Flags): Promise<number> {
  const loaded = await loadExplorationSession(stringFlag(flags, "session", true)!);
  if (loaded.session.status !== "running") throw new Error(`sessionはbookmarkできる状態ではありません: ${loaded.session.status}`);
  const requestId = await enqueueControl(loaded.paths, "bookmark", "operator-bookmark");
  console.log(JSON.stringify({ sessionId: loaded.session.sessionId, status: "bookmark-requested", requestId }, null, 2));
  return 0;
}

export async function exploreForkCommand(flags: Flags): Promise<number> {
  const loaded = await loadExplorationSession(stringFlag(flags, "session", true)!);
  const charter = await loadExplorationCharter(loaded.paths);
  const config = configForCharter(charter, outputRoot(charter));
  const created = await createExplorationSession(charter, config, sessionRoot(charter));
  await appendSessionEvent(created.paths, { type: "session-forked", payload: { parentSessionId: loaded.session.sessionId, blockers: ["operator-approved-fork"] } });
  console.log(JSON.stringify({ sessionId: created.session.sessionId, sessionPath: created.paths.root, parentSessionId: loaded.session.sessionId }, null, 2));
  return 0;
}

export async function exploreAcceptanceCommand(flags: Flags): Promise<number> {
  const indexPath = stringFlag(flags, "index", true)!;
  const trustStorePath = stringFlag(flags, "trust-store", true)!;
  const aggregate = await aggregateExplorationAcceptance(indexPath, trustStorePath);
  const out = stringFlag(flags, "out");
  if (out) {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeJsonAtomic(resolve(out), aggregate);
  }
  console.log(JSON.stringify(aggregate, null, 2));
  return aggregate.status === "eligible" ? 0 : 2;
}
