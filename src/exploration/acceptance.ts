import { createRequire } from "node:module";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileDigest } from "../core/artifact-store.js";
import { canonicalJson } from "../core/plan.js";
import { assertHateManifest } from "../core/hate.js";
import { assertExplorationCapabilityForCharter, assertExplorationCapabilitySnapshot, assertExplorationCharter, assertExplorationReport, assertExplorationSession, capabilitySnapshotDigest, explorationDigest, type ExplorationCapabilitySnapshot, type ExplorationCharter, type ExplorationExecutionMode, type ExplorationPlatform, type ExplorationReport } from "./contracts.js";
import { loadExplorationSession } from "./session.js";
import { loadSignedExplorationTargetManifest, verifyTrustedEd25519Payload } from "./target-manifest.js";

export const EXPLORATION_ACCEPTANCE_INDEX_VERSION = "lakda/exploration-acceptance-index/v1" as const;
export const REQUIRED_EXPLORATION_LANES: readonly ExplorationPlatform[] = ["pc-web", "mobile-web", "windows", "android", "ios"];
/**
 * buildExplorationReportが単一laneでは解決できない、集約待ちの自己参照marker。
 * 五laneのreal evidenceを検証するaggregatorだけがこのmarkerを解決する。
 */
export const REAL_LANE_ACCEPTANCE_REQUIRED = "real-lane-acceptance-required" as const;

type Signature = { algorithm: "ed25519"; keyId: string; signedPayloadDigest: string; valueBase64: string };
export type ExplorationAcceptanceIndexEntry = {
  sessionId: string; platform: ExplorationPlatform; executionMode: ExplorationExecutionMode; targetRevision: string;
  sessionPath: string; reportPath: string; reportSha256: string; hateManifestPath: string; hateManifestSha256: string; signature: Signature;
};
export type ExplorationAcceptanceIndex = { schemaVersion: typeof EXPLORATION_ACCEPTANCE_INDEX_VERSION; indexId: string; requiredLanes: ExplorationPlatform[]; entries: ExplorationAcceptanceIndexEntry[] };
export type ExplorationAcceptanceAggregate = {
  schemaVersion: typeof EXPLORATION_ACCEPTANCE_INDEX_VERSION; indexId: string; status: "eligible" | "pending_external" | "rejected";
  requiredLanes: ExplorationPlatform[]; verifiedLanes: ExplorationPlatform[]; blockers: string[]; entries: Array<{ platform: ExplorationPlatform; sessionId: string; status: "verified" | "rejected" | "pending_external"; blockers: string[] }>;
};

type Validator = ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> };
type AjvConstructor = new (options: object) => { compile(value: object): Validator };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const schemaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const validateIndex = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(createRequire(import.meta.url)("node:fs").readFileSync(resolve(schemaRoot, "schemas", "lakda-exploration-acceptance-index-v1.schema.json"), "utf8")) as object);

function portableWithin(root: string, reference: string): string {
  if (!reference || isAbsolute(reference)) throw new Error("acceptance index pathは相対pathが必要です");
  const candidate = resolve(root, reference);
  const rel = relative(resolve(root), candidate);
  if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).some(part => part === ".." || part === ".")) throw new Error("acceptance index pathがroot外です");
  return candidate;
}

async function assertPhysicalConfinement(root: string, candidate: string, expected: "file" | "directory"): Promise<void> {
  const lexicalRoot = resolve(root);
  const lexicalCandidate = resolve(candidate);
  const lexicalRelative = relative(lexicalRoot, lexicalCandidate);
  if (lexicalRelative && (isAbsolute(lexicalRelative) || lexicalRelative.split(/[\\/]/).some(part => part === ".."))) throw new Error("acceptance artifact pathがroot外です");
  let cursor = lexicalRoot;
  for (const part of lexicalRelative.split(/[\\/]/).filter(Boolean)) {
    cursor = resolve(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error("acceptance artifact pathにsymlink/reparse pointは使用できません");
  }
  const [physicalRoot, physicalCandidate] = await Promise.all([realpath(lexicalRoot), realpath(lexicalCandidate)]);
  const physicalRelative = relative(physicalRoot, physicalCandidate);
  if (physicalRelative && (isAbsolute(physicalRelative) || physicalRelative.split(/[\\/]/).some(part => part === ".."))) throw new Error("acceptance artifact pathがphysical root外です");
  const stat = await lstat(lexicalCandidate);
  if (expected === "file" ? !stat.isFile() : !stat.isDirectory()) throw new Error(`acceptance artifactは${expected}ではありません`);
}

function expectedMode(platform: ExplorationPlatform): ExplorationExecutionMode {
  // acceptance indexはfixture／emulator／mockの結果をreal Gateへ昇格させない。
  // PC／mobile Webも承認済みtargetとrevision probeを伴うreal evidenceを要求する。
  void platform;
  return "real";
}

function unsignedEntry(entry: ExplorationAcceptanceIndexEntry): string {
  const copy = structuredClone(entry) as Partial<ExplorationAcceptanceIndexEntry>;
  delete copy.signature;
  return canonicalJson(copy);
}

type HateArtifact = { path?: unknown; sha256?: unknown; size_bytes?: unknown; redaction_status?: unknown; public_exposure?: unknown; security_checks?: unknown };

function securityBlocker(artifact: HateArtifact): string | undefined {
  if (artifact.redaction_status !== "not_required" && artifact.redaction_status !== "redacted") return "redaction-status";
  if (artifact.public_exposure !== "none") return "public-exposure";
  const checks = artifact.security_checks;
  if (!checks || typeof checks !== "object" || (checks as { secrets_scan?: unknown }).secrets_scan !== "pass" || (checks as { pii_scan?: unknown }).pii_scan !== "pass") return "security-scan";
  return undefined;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every(value => right.includes(value));
}

async function verifyEntry(root: string, entry: ExplorationAcceptanceIndexEntry, trustStorePath: string): Promise<string[]> {
  const blockers: string[] = [];
  if (entry.executionMode !== expectedMode(entry.platform)) blockers.push(`${entry.platform}:execution-mode-mismatch`);
  const sessionPath = portableWithin(root, entry.sessionPath);
  const reportPath = portableWithin(root, entry.reportPath);
  const hatePath = portableWithin(root, entry.hateManifestPath);
  const sessionJsonPath = resolve(sessionPath, "session.json");
  await assertPhysicalConfinement(root, sessionPath, "directory");
  await Promise.all([
    assertPhysicalConfinement(sessionPath, sessionJsonPath, "file"),
    assertPhysicalConfinement(sessionPath, reportPath, "file"),
    assertPhysicalConfinement(sessionPath, hatePath, "file"),
  ]);
  const reportFromSession = relative(sessionPath, reportPath);
  const hateFromSession = relative(sessionPath, hatePath);
  if (!reportFromSession || isAbsolute(reportFromSession) || reportFromSession.split(/[\\/]/).some(part => part === "..")) blockers.push(`${entry.platform}:report-outside-session`);
  if (!hateFromSession || isAbsolute(hateFromSession) || hateFromSession.split(/[\\/]/).some(part => part === "..")) blockers.push(`${entry.platform}:hate-outside-session`);
  if (resolve(reportPath) !== resolve(sessionPath, "report.json")) blockers.push(`${entry.platform}:report-path-not-canonical`);
  if (resolve(hatePath) !== resolve(sessionPath, "exports", "artifact-manifest.json")) blockers.push(`${entry.platform}:hate-path-not-canonical`);
  try {
    const [sessionBytes, reportBytes, hateBytes] = await Promise.all([readFile(sessionJsonPath), readFile(reportPath), readFile(hatePath)]);
    const loadedSession = await loadExplorationSession(sessionPath);
    const projectedBytes = await readFile(sessionJsonPath);
    if (!projectedBytes.equals(sessionBytes)) blockers.push(`${entry.platform}:session-projection-rewritten`);
    const session = loadedSession.session;
    assertExplorationSession(session);
    if (session.sessionId !== entry.sessionId || session.platform !== entry.platform || session.status !== "completed") blockers.push(`${entry.platform}:session-binding-mismatch`);
    if (session.technicalOutcome !== "passed") blockers.push(`${entry.platform}:technical-outcome-not-passed`);
    if (!session.targetManifestDigest) blockers.push(`${entry.platform}:target-manifest-digest-missing`);
    if (new Set(session.runIds).size !== session.runIds.length) blockers.push(`${entry.platform}:duplicate-run-id`);
    if (!session.runIds.length) blockers.push(`${entry.platform}:run-id-missing`);
    const runManifestRefs = session.runManifestRefs ?? [];
    if (new Set(runManifestRefs.map(ref => ref.runId)).size !== runManifestRefs.length) blockers.push(`${entry.platform}:duplicate-run-manifest-ref`);
    if (!runManifestRefs.length) blockers.push(`${entry.platform}:run-manifest-ref-missing`);
    if (runManifestRefs.length > 0 && !sameStringSet(session.runIds, runManifestRefs.map(ref => ref.runId))) blockers.push(`${entry.platform}:run-manifest-set-mismatch`);
    await assertPhysicalConfinement(sessionPath, loadedSession.paths.events, "file");
    const eventBytes = await readFile(loadedSession.paths.events, "utf8");
    const events = eventBytes.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { type?: unknown; at?: unknown; payload?: Record<string, unknown> });
    const started = events.find(event => event.type === "session-started");
    if (!started || typeof started.at !== "string") blockers.push(`${entry.platform}:session-started-event-missing`);
    if (started?.payload?.targetManifestDigest !== session.targetManifestDigest) blockers.push(`${entry.platform}:session-target-manifest-event-mismatch`);
    const charterPath = session.charterPath === "charter.json" ? portableWithin(sessionPath, session.charterPath) : undefined;
    if (!charterPath || resolve(charterPath) !== resolve(sessionPath, "charter.json")) blockers.push(`${entry.platform}:charter-path-not-canonical`);
    let charter: ExplorationCharter | undefined;
    let charterFile: { path: string; sha256: string; size: number } | undefined;
    if (charterPath) {
      await assertPhysicalConfinement(sessionPath, charterPath, "file");
      const charterBytes = await readFile(charterPath);
      const charterDigest = await fileDigest(charterPath);
      charterFile = { path: "charter.json", sha256: `sha256:${charterDigest.sha256}`, size: charterDigest.size };
      charter = JSON.parse(charterBytes.toString("utf8")) as ExplorationCharter;
      assertExplorationCharter(charter);
      if (charter.executionMode !== "real" || charter.platform !== entry.platform || charter.targetRevision !== entry.targetRevision || session.charterDigest !== explorationDigest(charter)) blockers.push(`${entry.platform}:charter-binding-mismatch`);
    }
    let capabilitySnapshot: ExplorationCapabilitySnapshot | undefined;
    let capabilityFile: { path: string; sha256: string; size: number } | undefined;
    try {
      if (session.capabilitySnapshotPath !== "capability-snapshot.json") throw new Error("capability snapshot pathがcanonicalではありません");
      const capabilityPath = portableWithin(sessionPath, session.capabilitySnapshotPath);
      await assertPhysicalConfinement(sessionPath, capabilityPath, "file");
      const capability = JSON.parse((await readFile(capabilityPath)).toString("utf8")) as ExplorationCapabilitySnapshot;
      assertExplorationCapabilitySnapshot(capability);
      capabilitySnapshot = capability;
      if (capability.lane !== entry.platform || capability.targetRevision !== entry.targetRevision) blockers.push(`${entry.platform}:capability-binding-mismatch`);
      if (capability.executionMode !== "real") blockers.push(`${entry.platform}:capability-execution-mode-mismatch`);
      if (!charter || capability.adapterId !== charter.adapter.id) blockers.push(`${entry.platform}:capability-adapter-mismatch`);
      if (charter) assertExplorationCapabilityForCharter(charter, capability);
      if (!capability.bridgeDigest) blockers.push(`${entry.platform}:capability-bridge-digest-missing`);
      const digest = capabilitySnapshotDigest(capability);
      // session.capabilityDigest is the normalized snapshot binding. Native
      // bridges may additionally expose a raw AdapterCapabilities digest;
      // that raw value is intentionally allowed to differ from the normalized
      // projection and is checked against target-manifest bridgeBinding below.
      if (!session.capabilityDigest || session.capabilityDigest !== digest) blockers.push(`${entry.platform}:capability-digest-mismatch`);
      if (!capability.rawCapabilityDigest || !/^sha256:[0-9a-f]{64}$/.test(capability.rawCapabilityDigest)) blockers.push(`${entry.platform}:capability-raw-digest-missing`);
      const bytes = await fileDigest(capabilityPath);
      capabilityFile = { path: session.capabilitySnapshotPath, sha256: `sha256:${bytes.sha256}`, size: bytes.size };
    } catch (error) {
      blockers.push(`${entry.platform}:capability-snapshot-invalid`);
      void error;
    }
    const runManifestFiles: Array<{ path: string; runId: string; sha256: string; size: number; artifacts: HateArtifact[] }> = [];
    for (const ref of runManifestRefs) {
      try {
        if (!ref.path.startsWith("run-manifests/")) throw new Error("run manifest pathがcanonicalではありません");
        const runManifestPath = portableWithin(sessionPath, ref.path);
        await assertPhysicalConfinement(sessionPath, runManifestPath, "file");
        const runBytes = await readFile(runManifestPath);
        const digest = await fileDigest(runManifestPath);
        if (`sha256:${digest.sha256}` !== ref.sha256 || digest.size !== ref.size) throw new Error("run manifest bytesが不一致です");
        const runManifest = JSON.parse(runBytes.toString("utf8")) as { run_id?: unknown; artifacts?: HateArtifact[] };
        assertHateManifest(runManifest);
        if (runManifest.run_id !== ref.runId) throw new Error("run manifest run_idがsession refと不一致です");
        for (const artifact of runManifest.artifacts ?? []) {
          const security = securityBlocker(artifact);
          if (security) throw new Error(`run HATE artifact security ${security}`);
        }
        runManifestFiles.push({ path: ref.path, runId: ref.runId, sha256: ref.sha256, size: ref.size, artifacts: runManifest.artifacts ?? [] });
      } catch (error) {
        blockers.push(`${entry.platform}:run-manifest-invalid`);
        void error;
      }
    }
    let targetManifestFile: { path: string; sha256: string; size: number } | undefined;
    if (charter && session.targetManifestDigest && started && typeof started.at === "string") {
      try {
        const targetPath = portableWithin(sessionPath, "target-manifest.json");
        await assertPhysicalConfinement(sessionPath, targetPath, "file");
        const targetDigest = await fileDigest(targetPath);
        targetManifestFile = { path: "target-manifest.json", sha256: `sha256:${targetDigest.sha256}`, size: targetDigest.size };
        if (targetManifestFile.sha256 !== session.targetManifestDigest) blockers.push(`${entry.platform}:target-manifest-digest-mismatch`);
        const loadedTarget = await loadSignedExplorationTargetManifest(targetPath, charter, session.configDigest, { at: started.at, trustStorePath: resolve(trustStorePath) });
        const manifest = loadedTarget.manifest;
        if (manifest.platform !== entry.platform || manifest.targetRevision !== entry.targetRevision || manifest.executionMode !== "real" || manifest.adapterId !== charter.adapter.id) blockers.push(`${entry.platform}:target-manifest-binding-mismatch`);
        if (manifest.charterDigest !== session.charterDigest || manifest.configDigest !== session.configDigest) blockers.push(`${entry.platform}:target-manifest-session-binding-mismatch`);
        if (!capabilitySnapshot || !capabilitySnapshot.rawCapabilityDigest || manifest.bridgeBinding.capabilityDigest !== capabilitySnapshot.rawCapabilityDigest) blockers.push(`${entry.platform}:target-manifest-capability-binding-mismatch`);
        if (capabilitySnapshot?.bridgeDigest && manifest.bridgeBinding.bridgeDigest !== capabilitySnapshot.bridgeDigest) blockers.push(`${entry.platform}:target-manifest-bridge-binding-mismatch`);
      } catch (error) {
        blockers.push(`${entry.platform}:target-manifest-invalid`);
        void error;
      }
    } else {
      blockers.push(`${entry.platform}:target-manifest-missing`);
    }
    const reportDigest = await fileDigest(reportPath);
    const hateDigest = await fileDigest(hatePath);
    if (`sha256:${reportDigest.sha256}` !== entry.reportSha256) blockers.push(`${entry.platform}:report-sha256-mismatch`);
    if (`sha256:${hateDigest.sha256}` !== entry.hateManifestSha256) blockers.push(`${entry.platform}:hate-sha256-mismatch`);
    const report = JSON.parse(reportBytes.toString("utf8")) as ExplorationReport;
    assertExplorationReport(report);
    if (report.sessionId !== entry.sessionId || report.platform !== entry.platform || report.targetRevision !== entry.targetRevision || report.executionMode !== entry.executionMode || report.charterDigest !== session.charterDigest || report.status !== "completed" && report.status !== "pending_external") blockers.push(`${entry.platform}:report-binding-mismatch`);
    if (!report.runIds || !sameStringSet(session.runIds, report.runIds)) blockers.push(`${entry.platform}:report-run-id-set-mismatch`);
    if (report.technicalOutcome !== "passed") blockers.push(`${entry.platform}:report-technical-outcome-not-passed`);
    if (report.capture.failures.length > 0) blockers.push(`${entry.platform}:capture-failures-present`);
    // The single-lane report may contain only the self-reference marker. It is
    // resolved here after the detached signature/HATE and all five real lanes
    // are checked; any other blocker remains a hard rejection.
    const unexpectedReportBlockers = report.blockers.filter(blocker => blocker !== REAL_LANE_ACCEPTANCE_REQUIRED);
    if (unexpectedReportBlockers.length > 0) blockers.push(`${entry.platform}:unexpected-report-blocker`);
    // Individual real reports remain pending_external until this five-lane
    // aggregator has verified the detached entry. Do not require the report
    // to self-assert eligibility; that would recreate the removed single-session
    // self-eligibility gate.
    if (entry.executionMode === "real" && report.acceptanceStatus !== "pending_external") blockers.push(`${entry.platform}:real-acceptance-status-mismatch`);
    const hate = JSON.parse(hateBytes.toString("utf8")) as { run_id?: unknown; artifacts?: HateArtifact[] };
    assertHateManifest(hate);
    if (hate.run_id !== entry.sessionId) blockers.push(`${entry.platform}:session-hate-run-id-mismatch`);
    const hateArtifacts = hate.artifacts ?? [];
    const findHateArtifact = (path: string): HateArtifact | undefined => hateArtifacts.find(artifact => artifact.path === path);
    for (const artifact of hateArtifacts) {
      const security = securityBlocker(artifact);
      if (security) blockers.push(`${entry.platform}:session-hate-security-${security}`);
    }
    if (targetManifestFile) {
      const artifact = findHateArtifact(targetManifestFile.path);
      if (!artifact || artifact.sha256 !== targetManifestFile.sha256 || artifact.size_bytes !== targetManifestFile.size) blockers.push(`${entry.platform}:target-manifest-not-in-session-hate`);
    }
    if (charterFile) {
      const artifact = findHateArtifact(charterFile.path);
      if (!artifact || artifact.sha256 !== charterFile.sha256 || artifact.size_bytes !== charterFile.size) blockers.push(`${entry.platform}:charter-not-in-session-hate`);
    }
    const requiredHatePaths = ["charter.json", "session.json", "events.jsonl", "capability-snapshot.json", "target-manifest.json", "findings.jsonl", "report.json"];
    if (session.checkpointPath) {
      if (session.checkpointPath !== "checkpoint.json") blockers.push(`${entry.platform}:checkpoint-path-not-canonical`);
      requiredHatePaths.push("checkpoint.json");
    }
    for (const requiredPath of requiredHatePaths) {
      try {
        const actualPath = portableWithin(sessionPath, requiredPath);
        await assertPhysicalConfinement(sessionPath, actualPath, "file");
        const digest = await fileDigest(actualPath);
        const artifact = findHateArtifact(requiredPath);
        if (!artifact || artifact.sha256 !== `sha256:${digest.sha256}` || artifact.size_bytes !== digest.size) blockers.push(`${entry.platform}:required-session-artifact-missing:${requiredPath}`);
      } catch {
        blockers.push(`${entry.platform}:required-session-artifact-missing:${requiredPath}`);
      }
    }
    if (capabilityFile) {
      const artifact = findHateArtifact(capabilityFile.path);
      if (!artifact || artifact.sha256 !== capabilityFile.sha256 || artifact.size_bytes !== capabilityFile.size) blockers.push(`${entry.platform}:capability-snapshot-not-in-session-hate`);
    }
    for (const runFile of runManifestFiles) {
      const artifact = findHateArtifact(runFile.path);
      if (!artifact || artifact.sha256 !== runFile.sha256 || artifact.size_bytes !== runFile.size) blockers.push(`${entry.platform}:run-manifest-not-in-session-hate`);
    }
    for (const artifact of hateArtifacts) {
      if (typeof artifact.path !== "string" || !artifact.path || isAbsolute(artifact.path)) { blockers.push(`${entry.platform}:hate-artifact-path-invalid`); continue; }
      const artifactPath = portableWithin(sessionPath, artifact.path);
      if (typeof artifact.sha256 !== "string" || typeof artifact.size_bytes !== "number") { blockers.push(`${entry.platform}:hate-artifact-record-invalid`); continue; }
      try {
        await assertPhysicalConfinement(sessionPath, artifactPath, "file");
        const digest = await fileDigest(artifactPath);
        if (digest.size !== artifact.size_bytes || digest.sha256.toLowerCase() !== artifact.sha256.replace(/^sha256:/i, "").toLowerCase()) blockers.push(`${entry.platform}:hate-artifact-bytes-mismatch:${artifact.path}`);
      } catch { blockers.push(`${entry.platform}:hate-artifact-missing:${artifact.path}`); }
    }
    if (!await verifyTrustedEd25519Payload(unsignedEntry(entry), entry.signature, trustStorePath)) blockers.push(`${entry.platform}:entry-signature-invalid`);
  } catch (error) {
    blockers.push(`${entry.platform}:${error instanceof Error ? error.message : "acceptance-entry-invalid"}`);
  }
  return blockers;
}

export async function aggregateExplorationAcceptance(indexPath: string, trustStorePath: string): Promise<ExplorationAcceptanceAggregate> {
  const absolute = resolve(indexPath);
  const root = dirname(absolute);
  let value: unknown;
  try { value = JSON.parse(await readFile(absolute, "utf8")) as unknown; } catch { throw new Error("exploration acceptance indexを読み込めません"); }
  if (!validateIndex(value)) throw new Error(`exploration acceptance index schemaが不正です: ${validateIndex.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  const index = value as ExplorationAcceptanceIndex;
  const requiredLanes = [...index.requiredLanes];
  if (requiredLanes.length !== REQUIRED_EXPLORATION_LANES.length || REQUIRED_EXPLORATION_LANES.some(lane => !requiredLanes.includes(lane))) throw new Error("acceptance indexのrequiredLanesは5 lane全件が必要です");
  if (new Set(index.entries.map(entry => entry.platform)).size !== index.entries.length) throw new Error("acceptance indexに同一platformの重複entryがあります");
  const entryResults = [] as ExplorationAcceptanceAggregate["entries"];
  for (const entry of index.entries) {
    const blockers = await verifyEntry(root, entry, resolve(trustStorePath));
    entryResults.push({ platform: entry.platform, sessionId: entry.sessionId, status: blockers.length ? "rejected" : "verified", blockers });
  }
  const verifiedLanes = entryResults.filter(entry => entry.status === "verified").map(entry => entry.platform);
  const missing = requiredLanes.filter(lane => !verifiedLanes.includes(lane));
  const blockers = [...entryResults.flatMap(entry => entry.blockers), ...missing.map(lane => `${lane}:acceptance-required`)].filter((value, index, values) => values.indexOf(value) === index);
  const status = entryResults.some(entry => entry.status === "rejected") ? "rejected" : missing.length ? "pending_external" : "eligible";
  return { schemaVersion: EXPLORATION_ACCEPTANCE_INDEX_VERSION, indexId: index.indexId, status, requiredLanes, verifiedLanes, blockers, entries: entryResults };
}
