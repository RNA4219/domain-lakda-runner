import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileDigest, portablePath, readJson, writeCanonicalJson, writeJsonAtomic, writeText } from "../core/artifact-store.js";
import { canonicalJson } from "../core/plan.js";
import {
  assertExplorationCapabilitySnapshot,
  assertExplorationCharter,
  assertExplorationFinding,
  assertExplorationReport,
  assertExplorationSession,
  capabilitySnapshotDigest,
  explorationDigest,
  EXPLORATION_SESSION_VERSION,
  type ExplorationCapabilitySnapshot,
  type ExplorationCharter,
  type ExplorationFinding,
  type ExplorationReport,
  type ExplorationSession,
  type ExplorationSessionEvent,
  type ExplorationSessionStatus,
} from "./contracts.js";
import { findSensitive, redact, sha256 } from "../core/redaction.js";
import { readBinaryAttestations, verifyBinaryAttestation } from "./binary-attestation.js";
import { loadSignedExplorationTargetManifest } from "./target-manifest.js";
import { assertHateManifest } from "../core/hate.js";

export type ExplorationSessionPaths = {
  root: string; charter: string; session: string; events: string; checkpoint: string; capability: string; targetManifest: string; findings: string; report: string; control: string; lock: string; runManifests: string; hateManifest: string;
};

export function sessionPaths(root: string): ExplorationSessionPaths {
  const resolved = resolve(root);
  return { root: resolved, charter: join(resolved, "charter.json"), session: join(resolved, "session.json"), events: join(resolved, "events.jsonl"), checkpoint: join(resolved, "checkpoint.json"), capability: join(resolved, "capability-snapshot.json"), targetManifest: join(resolved, "target-manifest.json"), findings: join(resolved, "findings.jsonl"), report: join(resolved, "report.json"), control: join(resolved, "control-requests"), lock: join(resolved, ".session.lock"), runManifests: join(resolved, "run-manifests"), hateManifest: join(resolved, "exports", "artifact-manifest.json") };
}

export function defaultExplorationRoot(outputDir?: string): string { return resolve(outputDir ?? join(process.cwd(), ".lakda", "explorations")); }
export function explorationRunRoot(charter: ExplorationCharter): string { return resolve(charter.outputDir ?? join(process.cwd(), ".lakda", "runs")); }

export function runDirectoryReference(runRoot: string, runDir: string): string {
  const root = resolve(runRoot);
  const candidate = resolve(runDir);
  const reference = relative(root, candidate);
  if (!reference || isAbsolute(reference) || reference.split(/[\\/]/).some(part => part === "..")) throw new Error("探索run directoryはCharter outputDir配下である必要があります");
  return reference.replaceAll("\\", "/");
}

export function resolveRunDirectoryReference(runRoot: string, reference: string): string {
  if (!reference || isAbsolute(reference)) throw new Error("探索run directory referenceは相対pathである必要があります");
  const parts = reference.split(/[\\/]/);
  if (parts.some(part => !part || part === "." || part === "..")) throw new Error("探索run directory referenceにpath traversalは許可されません");
  const root = resolve(runRoot);
  const candidate = resolve(root, ...parts);
  const verified = relative(root, candidate);
  if (!verified || isAbsolute(verified) || verified.split(/[\\/]/).some(part => part === "..")) throw new Error("探索run directory referenceがoutputDir外を指しています");
  return candidate;
}

function now(): string { return new Date().toISOString(); }
function eventId(): string { return `evt-${randomUUID()}`; }
function transitionAllowed(from: ExplorationSessionStatus, to: ExplorationSessionStatus): boolean {
  if (from === to) return false;
  if (from === "draft") return to === "running" || to === "aborted";
  if (from === "running") return to === "paused" || to === "completed" || to === "aborted";
  if (from === "paused") return to === "running" || to === "aborted";
  return false;
}

function expectedEventStatus(type: ExplorationSessionEvent["type"]): ExplorationSessionStatus | undefined {
  if (type === "session-started" || type === "session-resumed") return "running";
  if (type === "session-paused") return "paused";
  if (type === "session-completed") return "completed";
  if (type === "session-aborted" || type === "kill-switch") return "aborted";
  return undefined;
}

type RunManifestRef = NonNullable<ExplorationSession["runManifestRefs"]>[number];

function mergeRunManifestRef(current: RunManifestRef[], value: unknown): RunManifestRef[] {
  if (!value || typeof value !== "object") return current;
  const candidate = value as Partial<RunManifestRef>;
  if (typeof candidate.runId !== "string" || typeof candidate.path !== "string" || typeof candidate.sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(candidate.sha256) || !Number.isSafeInteger(candidate.size) || (candidate.size ?? -1) < 0) return current;
  if (current.some(item => item.runId === candidate.runId && item.path === candidate.path && item.sha256 === candidate.sha256)) return current;
  if (current.some(item => item.runId === candidate.runId && item.sha256 !== candidate.sha256)) throw new Error("探索sessionのrun manifest digestがrunId間で不一致です");
  const size = candidate.size as number;
  return [...current, { runId: candidate.runId, path: candidate.path, sha256: candidate.sha256, size }];
}

async function withSessionLock<T>(paths: ExplorationSessionPaths, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await mkdir(paths.lock);
      try { return await operation(); } finally { await rm(paths.lock, { recursive: true, force: true }); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, 20));
    }
  }
  throw new Error("探索session lockを取得できません");
}

/**
 * Read and verify the append-only projection. Projection repair is opt-in so
 * callers that do not own the session lock remain strictly read-only; the
 * public loader acquires the lock before requesting repair.
 */
async function readSession(paths: ExplorationSessionPaths, repairProjection = false): Promise<ExplorationSession> {
  const value = await readJson(paths.session);
  assertExplorationSession(value);
  const zeroDigest = `sha256:${"0".repeat(64)}`;
  if (value.eventCount === 0 && value.eventHeadDigest !== zeroDigest) throw new Error("探索sessionに新契約のevent hash chain headがありません。旧v1 sessionのmigrationは提供しません");
  const raw = existsSync(paths.events) ? await readFile(paths.events, "utf8") : "";
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let previousDigest = zeroDigest;
  const events: ExplorationSessionEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let event: ExplorationSessionEvent;
    try { event = JSON.parse(lines[index]!) as ExplorationSessionEvent; } catch { throw new Error("探索session event logに不正なJSONがあります"); }
    if (event.schemaVersion !== EXPLORATION_SESSION_VERSION || event.sessionId !== value.sessionId || event.sequence !== index + 1 || event.previousDigest !== previousDigest || !event.eventDigest || !["session-created", "session-forked", "capability-snapshot", "session-started", "session-paused", "session-resumed", "kill-switch", "bookmark", "finding", "checkpoint", "session-completed", "session-aborted"].includes(event.type)) throw new Error("探索session event logのversion/sequence/hash chainが不正です。旧v1 sessionのmigrationは提供しません");
    const { eventDigest, ...unsigned } = event;
    if (explorationDigest(unsigned) !== eventDigest) throw new Error("探索session event digestが不一致です");
    if (event.status && !["draft", "running", "paused", "completed", "aborted"].includes(event.status)) throw new Error("探索session event statusが不正です");
    const requiredStatus = expectedEventStatus(event.type);
    if (requiredStatus && event.status !== requiredStatus) throw new Error("探索session event type/statusが不一致です");
    events.push(event); previousDigest = eventDigest;
  }
  if (events.length === 0 && value.eventCount === 0 && value.eventHeadDigest === zeroDigest) return value;
  if (events.length < value.eventCount) throw new Error("探索session projectionがevent logより先行しています。旧v1 sessionのmigrationは提供しません");
  if (events.length === value.eventCount && events.length > 0 && value.eventHeadDigest !== previousDigest) throw new Error("探索session projectionとevent logのhead digestが不一致です。旧v1 sessionのmigrationは提供しません");
  const prefix = events.slice(0, value.eventCount);
  const projectedPrefix = projectSession(value, prefix);
  assertExplorationSession(projectedPrefix);
  if (canonicalJson(projectedPrefix) !== canonicalJson(value)) throw new Error("探索session projectionがevent log由来の値と一致しません。旧v1 sessionのmigrationは提供しません");
  if (events.length === value.eventCount) return value;
  const projected = projectSession(value, events);
  assertExplorationSession(projected);
  if (repairProjection) await writeJsonAtomic(paths.session, projected);
  return projected;
}

function projectSession(base: ExplorationSession, events: ExplorationSessionEvent[]): ExplorationSession {
  let current: ExplorationSession = {
    schemaVersion: base.schemaVersion,
    sessionId: base.sessionId,
    charterDigest: base.charterDigest,
    configDigest: base.configDigest,
    platform: base.platform,
    lane: base.lane,
    status: "draft",
    createdAt: base.createdAt,
    updatedAt: base.createdAt,
    ...(base.charterPath ? { charterPath: base.charterPath } : {}),
    ...(base.capabilitySnapshotPath ? { capabilitySnapshotPath: base.capabilitySnapshotPath } : {}),
    ...(base.checkpointPath ? { checkpointPath: base.checkpointPath } : {}),
    eventCount: 0,
    actionCount: 0,
    runIds: [],
    findingIds: [],
    blockers: [],
    eventHeadDigest: undefined,
    ...(base.hateManifestPath ? { hateManifestPath: base.hateManifestPath } : {}),
    runManifestRefs: [],
  };
  for (const event of events) {
    const payload = event.payload ?? {};
    const nextStatus = event.status ?? current.status;
    if (event.status && !transitionAllowed(current.status, nextStatus)) throw new Error(`探索session event lifecycleが不正です: ${current.status} -> ${nextStatus}`);
    current = {
      ...current,
      status: nextStatus,
      updatedAt: event.at,
      eventCount: event.sequence ?? current.eventCount + 1,
      eventHeadDigest: event.eventDigest,
      runIds: typeof payload.runId === "string" && !current.runIds.includes(payload.runId) ? [...current.runIds, payload.runId] : current.runIds,
      findingIds: typeof payload.findingId === "string" && !current.findingIds.includes(payload.findingId) ? [...current.findingIds, payload.findingId] : current.findingIds,
      ...(typeof payload.actionCount === "number" && Number.isSafeInteger(payload.actionCount) ? { actionCount: payload.actionCount } : {}),
      ...(typeof payload.lastFingerprint === "string" ? { lastFingerprint: payload.lastFingerprint } : {}),
      ...(typeof payload.lastRunDir === "string" ? { lastRunDir: payload.lastRunDir } : {}),
      ...(typeof payload.capabilityDigest === "string" ? { capabilityDigest: payload.capabilityDigest } : {}),
      ...(typeof payload.targetManifestDigest === "string" ? { targetManifestDigest: payload.targetManifestDigest } : {}),
      ...(typeof payload.technicalOutcome === "string" && ["passed", "failed", "partial", "error"].includes(payload.technicalOutcome) ? { technicalOutcome: payload.technicalOutcome as ExplorationSession["technicalOutcome"] } : {}),
      ...(typeof payload.terminationReason === "string" ? { terminationReason: payload.terminationReason } : {}),
      ...(typeof payload.activeDurationMs === "number" ? { activeDurationMs: payload.activeDurationMs } : {}),
      ...(typeof payload.parentSessionId === "string" ? { parentSessionId: payload.parentSessionId } : {}),
      ...(Array.isArray(payload.blockers) ? { blockers: payload.blockers.filter((item): item is string => typeof item === "string") } : {}),
      ...(payload.runManifestRef ? { runManifestRefs: mergeRunManifestRef(current.runManifestRefs ?? [], payload.runManifestRef) } : {}),
    };
  }
  return current;
}

export async function createExplorationSession(charter: ExplorationCharter, config: unknown, root = defaultExplorationRoot(charter.outputDir)): Promise<{ session: ExplorationSession; paths: ExplorationSessionPaths }> {
  assertExplorationCharter(charter);
  const paths = sessionPaths(join(root, `${charter.charterId}-${Date.now()}-${randomUUID().slice(0, 8)}`));
  await mkdir(paths.root, { recursive: true });
  const timestamp = now();
  const session: ExplorationSession = {
    schemaVersion: EXPLORATION_SESSION_VERSION,
    sessionId: paths.root.split(/[\\/]/).pop()!, charterDigest: explorationDigest(charter), configDigest: explorationDigest(config),
    platform: charter.platform, lane: charter.platform, status: "draft", createdAt: timestamp, updatedAt: timestamp,
    charterPath: "charter.json", capabilitySnapshotPath: "capability-snapshot.json", checkpointPath: "checkpoint.json",
    eventCount: 0, actionCount: 0, runIds: [], findingIds: [], blockers: [], eventHeadDigest: `sha256:${"0".repeat(64)}`,
    hateManifestPath: "exports/artifact-manifest.json", runManifestRefs: [],
  };
  assertExplorationSession(session);
  await writeCanonicalJson(paths.charter, charter);
  await writeJsonAtomic(paths.session, session);
  await writeText(paths.events, "");
  await writeText(paths.findings, "");
  await mkdir(paths.control, { recursive: true });
  await appendSessionEvent(paths, { type: "session-created", payload: { charterDigest: session.charterDigest } });
  return { session: await readSession(paths), paths };
}

export async function loadExplorationSession(rootOrSessionPath: string): Promise<{ session: ExplorationSession; paths: ExplorationSessionPaths }> {
  const candidate = resolve(rootOrSessionPath);
  const root = candidate.toLowerCase().endsWith("session.json") ? resolve(candidate, "..") : candidate;
  const paths = sessionPaths(root);
  const session = await withSessionLock(paths, async () => readSession(paths, true));
  return { session, paths };
}

export async function loadExplorationCharter(paths: ExplorationSessionPaths): Promise<ExplorationCharter> {
  const value = await readJson(paths.charter);
  assertExplorationCharter(value);
  return value;
}

async function appendSessionEventUnlocked(paths: ExplorationSessionPaths, input: Pick<ExplorationSessionEvent, "type" | "status" | "payload">, session: ExplorationSession): Promise<ExplorationSession> {
  const nextStatus = input.status ?? session.status;
  const requiredStatus = expectedEventStatus(input.type);
  if (requiredStatus && input.status !== requiredStatus) throw new Error(`session event ${input.type}にはstatus=${requiredStatus}が必要です`);
  if (input.status && !transitionAllowed(session.status, nextStatus)) throw new Error(`session status transition is not allowed: ${session.status} -> ${nextStatus}`);
  const rawPayload = input.payload ?? {};
  const payload = Object.fromEntries(Object.entries(rawPayload).map(([key, value]) => {
    if (key === "blockers" && Array.isArray(value)) return [key, value.filter((item): item is string => typeof item === "string").map(item => findSensitive(item).length ? "redacted-blocker" : item)];
    if (typeof value === "string" && findSensitive(value).length) return [key, redact(value)];
    return [key, value];
  }));
  const previousDigest = session.eventHeadDigest ?? `sha256:${"0".repeat(64)}`;
  const sequence = session.eventCount + 1;
  const unsigned = { schemaVersion: EXPLORATION_SESSION_VERSION, eventId: eventId(), sessionId: session.sessionId, at: now(), type: input.type, sequence, previousDigest, ...(input.status ? { status: input.status } : {}), ...(input.payload ? { payload } : {}) };
  const eventDigest = explorationDigest(unsigned);
  const event: ExplorationSessionEvent = { ...unsigned, eventDigest };
  await appendFile(paths.events, `${JSON.stringify(event)}\n`, "utf8");
  const findings = typeof payload.findingId === "string" && !session.findingIds.includes(payload.findingId) ? [...session.findingIds, payload.findingId] : session.findingIds;
  const runIds = typeof payload.runId === "string" && !session.runIds.includes(payload.runId) ? [...session.runIds, payload.runId] : session.runIds;
  const updated: ExplorationSession = {
    ...session, status: nextStatus, updatedAt: event.at, eventCount: sequence, actionCount: typeof payload.actionCount === "number" && Number.isSafeInteger(payload.actionCount) ? payload.actionCount : session.actionCount,
    runIds, findingIds: findings, eventHeadDigest: eventDigest,
    ...(typeof payload.lastFingerprint === "string" ? { lastFingerprint: payload.lastFingerprint } : {}),
    ...(typeof payload.lastRunDir === "string" ? { lastRunDir: payload.lastRunDir } : {}),
    ...(typeof payload.capabilityDigest === "string" ? { capabilityDigest: payload.capabilityDigest } : {}),
    ...(typeof payload.targetManifestDigest === "string" ? { targetManifestDigest: payload.targetManifestDigest } : {}),
    ...(typeof payload.technicalOutcome === "string" && ["passed", "failed", "partial", "error"].includes(payload.technicalOutcome) ? { technicalOutcome: payload.technicalOutcome as ExplorationSession["technicalOutcome"] } : {}),
    ...(typeof payload.terminationReason === "string" ? { terminationReason: payload.terminationReason } : {}),
    ...(typeof payload.activeDurationMs === "number" ? { activeDurationMs: payload.activeDurationMs } : {}),
    ...(typeof payload.parentSessionId === "string" ? { parentSessionId: payload.parentSessionId } : {}),
    ...(Array.isArray(payload.blockers) ? { blockers: payload.blockers.filter((value): value is string => typeof value === "string") } : {}),
    ...(payload.runManifestRef ? { runManifestRefs: mergeRunManifestRef(session.runManifestRefs ?? [], payload.runManifestRef) } : {}),
  };
  assertExplorationSession(updated);
  await writeJsonAtomic(paths.session, updated);
  return updated;
}

export async function appendSessionEvent(paths: ExplorationSessionPaths, input: Pick<ExplorationSessionEvent, "type" | "status" | "payload">): Promise<ExplorationSession> {
  return await withSessionLock(paths, async () => appendSessionEventUnlocked(paths, input, await readSession(paths)));
}

export async function writeCapabilitySnapshot(paths: ExplorationSessionPaths, snapshot: ExplorationCapabilitySnapshot): Promise<void> {
  const digest = capabilitySnapshotDigest(snapshot);
  assertExplorationCapabilitySnapshot(snapshot);
  await withSessionLock(paths, async () => {
    const session = await readSession(paths);
    await writeJsonAtomic(paths.capability, snapshot);
    await appendSessionEventUnlocked(paths, { type: "capability-snapshot", payload: { capabilityDigest: digest } }, session);
  });
}

/** real preflightで検証済みのtarget manifest bytesをsessionへ固定保存する。 */
export async function copyTargetManifest(paths: ExplorationSessionPaths, sourcePath: string, expectedDigest?: string): Promise<string> {
  return await withSessionLock(paths, async () => {
    const source = resolve(sourcePath);
    const bytes = await readFile(source);
    const digest = await fileDigest(source);
    const actual = `sha256:${digest.sha256}`;
    if (expectedDigest && expectedDigest !== actual) throw new Error("探索target manifest source digestがpreflight結果と一致しません");
    if (existsSync(paths.targetManifest)) {
      const existing = await fileDigest(paths.targetManifest);
      if (existing.sha256 !== digest.sha256 || existing.size !== digest.size) throw new Error("session target manifest snapshotが変更されています");
    } else {
      await writeFile(paths.targetManifest, bytes);
    }
    return actual;
  });
}

export async function writeCheckpoint(paths: ExplorationSessionPaths, checkpoint: Record<string, unknown>): Promise<void> {
  await withSessionLock(paths, async () => {
    const session = await readSession(paths);
    const value = {
      schemaVersion: "lakda/exploration-checkpoint/v1",
      sessionId: session.sessionId,
      createdAt: now(),
      ...(typeof checkpoint.runId === "string" ? { runId: checkpoint.runId } : {}),
      ...(typeof checkpoint.lastRunDir === "string" ? { lastRunDir: checkpoint.lastRunDir } : {}),
      ...(typeof checkpoint.actionCount === "number" ? { actionCount: checkpoint.actionCount } : {}),
      ...(typeof checkpoint.lastFingerprint === "string" ? { lastFingerprint: checkpoint.lastFingerprint } : {}),
      ...(typeof checkpoint.activeDurationMs === "number" ? { activeDurationMs: checkpoint.activeDurationMs } : {}),
      ...(typeof checkpoint.traceSha256 === "string" ? { traceSha256: checkpoint.traceSha256 } : {}),
      ...(typeof checkpoint.replayTraceSha256 === "string" ? { replayTraceSha256: checkpoint.replayTraceSha256 } : {}),
      ...(Array.isArray(checkpoint.actionTimestamps) && checkpoint.actionTimestamps.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) ? { actionTimestamps: checkpoint.actionTimestamps as number[] } : {}),
    };
    await writeJsonAtomic(paths.checkpoint, value);
    await appendSessionEventUnlocked(paths, { type: "checkpoint", payload: { checkpointPath: "checkpoint.json", ...(typeof checkpoint.actionCount === "number" ? { actionCount: checkpoint.actionCount } : {}), ...(typeof checkpoint.lastFingerprint === "string" ? { lastFingerprint: checkpoint.lastFingerprint } : {}), ...(typeof checkpoint.lastRunDir === "string" ? { lastRunDir: checkpoint.lastRunDir } : {}) } }, session);
  });
}

export async function writeFinding(paths: ExplorationSessionPaths, finding: ExplorationFinding): Promise<void> {
  assertExplorationFinding(finding);
  await withSessionLock(paths, async () => {
    const session = await readSession(paths);
    const charter = await loadExplorationCharter(paths);
    if (finding.sessionId !== session.sessionId) throw new Error("finding sessionIdが探索sessionと一致しません");
    if (finding.platform !== session.platform || finding.targetRevision !== charter.targetRevision) throw new Error("finding platformまたはtargetRevisionが探索sessionと一致しません");
    if (findSensitive(finding.message).length) throw new Error("finding messageにsecret/PIIを保存できません");
    await appendFile(paths.findings, `${JSON.stringify(finding)}\n`, "utf8");
    await appendSessionEventUnlocked(paths, { type: "finding", payload: { findingId: finding.findingId } }, session);
  });
}

/**
 * run単位HATE manifestをsession配下へコピーし、bytes／SHA／run_idを再検証してから
 * append-only session projectionへ登録する。session HATEは外部run pathを直接参照しない。
 */
export async function registerRunManifest(paths: ExplorationSessionPaths, runId: string, manifestPath: string): Promise<RunManifestRef> {
  return await withSessionLock(paths, async () => {
    const session = await readSession(paths);
    const source = resolve(manifestPath);
    const bytes = await readFile(source);
    let manifest: unknown;
    try { manifest = JSON.parse(bytes.toString("utf8")) as unknown; } catch { throw new Error("run HATE manifestが不正なJSONです"); }
    assertHateManifest(manifest);
    if ((manifest as { run_id?: unknown }).run_id !== runId) throw new Error("run HATE manifestのrun_idがsession runIdと一致しません");
    const runRoot = resolve(dirname(source), "..");
    for (const artifact of (manifest as { artifacts: Array<{ path?: unknown; sha256?: unknown; size_bytes?: unknown }> }).artifacts) {
      if (typeof artifact.path !== "string" || !artifact.path || isAbsolute(artifact.path)) throw new Error("run HATE manifest artifact pathが不正です");
      const artifactPath = resolve(runRoot, artifact.path);
      const artifactRelative = relative(runRoot, artifactPath);
      if (!artifactRelative || isAbsolute(artifactRelative) || artifactRelative.split(/[\\/]/).some(part => part === "..")) throw new Error("run HATE manifest artifactがrun root外です");
      const artifactSha = artifact.sha256;
      const artifactSize = artifact.size_bytes;
      if (typeof artifactSha !== "string" || !/^(?:sha256:)?[0-9a-fA-F]{64}$/.test(artifactSha) || typeof artifactSize !== "number" || !Number.isSafeInteger(artifactSize) || artifactSize < 0) throw new Error("run HATE manifest artifact digest/sizeが不正です");
      const digest = await fileDigest(artifactPath);
      if (digest.size !== artifactSize || digest.sha256.toLowerCase() !== artifactSha.replace(/^sha256:/i, "").toLowerCase()) throw new Error("run HATE manifestのartifact bytesが不一致です");
    }
    const digest = await fileDigest(source);
    const safeRunId = runId.replace(/[^A-Za-z0-9._-]/g, "-");
    const relativePath = `run-manifests/${safeRunId}-${sha256(runId).slice(0, 16)}.json`;
    const destination = resolve(paths.root, relativePath);
    const relativeCheck = relative(paths.root, destination);
    if (!relativeCheck || isAbsolute(relativeCheck) || relativeCheck.split(/[\\/]/).some(part => part === "..")) throw new Error("session run manifest pathがsession外です");
    await mkdir(paths.runManifests, { recursive: true });
    if (existsSync(destination)) {
      const existing = await fileDigest(destination);
      if (existing.sha256 !== digest.sha256 || existing.size !== digest.size) throw new Error("session run manifestの既存copyが変更されています");
    } else {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    const ref: RunManifestRef = { runId, path: portablePath(paths.root, destination), sha256: `sha256:${digest.sha256}`, size: digest.size };
    await appendSessionEventUnlocked(paths, { type: "checkpoint", payload: { runManifestRef: ref } }, session);
    return ref;
  });
}

export async function readFindings(paths: ExplorationSessionPaths): Promise<ExplorationFinding[]> {
  if (!existsSync(paths.findings)) return [];
  const raw = await readFile(paths.findings, "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map(line => { const value = JSON.parse(line) as unknown; assertExplorationFinding(value); return value; });
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function sessionArtifactKind(path: string): "trace" | "screenshot" | "video" | "log" | "report" | "other" {
  if (path.endsWith(".zip")) return "trace";
  if (/\.(png|jpg|jpeg)$/i.test(path)) return "screenshot";
  if (path.endsWith(".webm")) return "video";
  if (path.endsWith(".jsonl")) return "log";
  if (path.endsWith(".json")) return "report";
  return "other";
}

function repositoryCommitSha(): string {
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (/^[A-Fa-f0-9]{7,64}$/.test(value)) return value;
  } catch { /* session HATE remains verifiable even when source is not a git checkout */ }
  return "0000000";
}

/** session artifactを既存HATE/v1へ登録する。HATE exporterに別形式を導入しない。 */
export async function buildSessionHateManifest(paths: ExplorationSessionPaths, session: ExplorationSession): Promise<object> {
  const output = resolve(paths.hateManifest);
  const charter = await loadExplorationCharter(paths).catch(() => undefined);
  let artifactAttestorKeyIds: string[] | undefined;
  if (charter?.executionMode === "real") {
    try {
      const sessionValue = await readJson(paths.session) as { configDigest?: string };
      const loadedTarget = await loadSignedExplorationTargetManifest(paths.targetManifest, charter, typeof sessionValue.configDigest === "string" ? sessionValue.configDigest : "");
      artifactAttestorKeyIds = loadedTarget.manifest.artifactAttestorKeyIds ? [...loadedTarget.manifest.artifactAttestorKeyIds] : [];
    } catch { artifactAttestorKeyIds = []; }
  }
  const sessionAttestations = charter?.executionMode === "real" ? await readBinaryAttestations(paths.root) : new Map();
  const files = (await listFiles(paths.root)).filter(path => {
    const rel = portablePath(paths.root, path);
    if (resolve(path) === output) return false;
    if (rel.startsWith("control-requests/") || rel === "control-requests" || rel === ".session.lock") return false;
    return true;
  });
  const artifacts = [] as Array<Record<string, unknown>>;
  for (const path of files.sort()) {
    const rel = portablePath(paths.root, path);
    const bytes = await readFile(path);
    const digest = await fileDigest(path);
    const artifactKind = sessionArtifactKind(rel);
    const binary = artifactKind === "trace" || artifactKind === "screenshot" || artifactKind === "video";
    let classification: "internal" | "restricted" = "internal";
    let redactionStatus: "not_required" | "redacted" | "pending" | "failed";
    let secretsScan: "pass" | "fail" | "not_applicable" = "pass";
    let piiScan: "pass" | "fail" | "not_applicable" = "pass";
    if (binary) {
      if (charter?.executionMode === "real") {
        const attestation = sessionAttestations.get(rel);
        const verified = attestation ? await verifyBinaryAttestation(paths.root, rel, attestation, { requireSignature: true, trustStorePath: charter.trustStorePath ? resolve(charter.trustStorePath) : undefined, ...(artifactAttestorKeyIds !== undefined ? { allowedKeyIds: artifactAttestorKeyIds } : {}) }) : false;
        if (verified) {
          redactionStatus = attestation?.decision === "sanitized" ? "redacted" : "not_required";
        } else {
          classification = "restricted";
          redactionStatus = "pending";
          secretsScan = "fail";
          piiScan = "fail";
        }
      } else {
        // Binary bytes are never coerced to UTF-8 text for a false "pass".
        redactionStatus = "pending";
        secretsScan = "not_applicable";
        piiScan = "not_applicable";
      }
    } else {
      const sensitive = findSensitive(bytes.toString("utf8")).length > 0;
      classification = sensitive ? "restricted" : "internal";
      redactionStatus = sensitive ? "failed" : "not_required";
      secretsScan = sensitive ? "fail" : "pass";
    }
    artifacts.push({
      artifact_id: `lakda:exploration-${rel.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      kind: artifactKind, path: rel, sha256: `sha256:${digest.sha256}`, size_bytes: digest.size,
      classification, redaction_status: redactionStatus, redaction_rule_version: "lakda-redact-v1",
      safe_for_summary: false, public_exposure: "none", retention: { class: "default", days: 14 },
      security_checks: { secrets_scan: secretsScan, pii_scan: piiScan },
      lakda: { sessionId: session.sessionId, producerVersion: "0.4.0-rc.3", createdAt: session.updatedAt },
    });
  }
  const manifest = { schema_version: "HATE/v1", run_id: session.sessionId, run_attempt: 1, commit_sha: repositoryCommitSha(), artifacts };
  assertHateManifest(manifest);
  if (artifacts.some(artifact => artifact.security_checks && (artifact.security_checks as { secrets_scan?: string }).secrets_scan === "fail")) throw new Error("session artifactにsecret/PIIが含まれるためHATE manifestを確定できません");
  await mkdir(dirname(output), { recursive: true });
  await writeJsonAtomic(output, manifest);
  return manifest;
}

async function readAdaptiveCoverage(runDir: string | undefined, requireBinaryAttestation = false, trustStorePath?: string, allowedKeyIds?: readonly string[]): Promise<{ coverage: ExplorationReport["coverage"]; findings: ExplorationFinding[]; capture: ExplorationReport["capture"] }> {
  const empty = { coverage: { actions: 0, states: 0, transitions: 0, unexplored: [] as string[] }, findings: [], capture: { screenshots: 0, videos: 0, sampledFrames: 0, failures: runDir ? ["adaptive-coverage-unavailable"] : [] } };
  if (!runDir || !existsSync(runDir)) return empty;
  try {
    const value = await readJson(join(runDir, "adaptive", "coverage.json")) as { actions?: number; stateCount?: number; transitionCount?: number; unexplored?: unknown; timeline?: Array<Record<string, unknown>>; [key: string]: unknown };
    if (typeof value.actions !== "number" || !Number.isInteger(value.actions) || value.actions < 0 || typeof value.stateCount !== "number" || !Number.isInteger(value.stateCount) || value.stateCount < 0 || typeof value.transitionCount !== "number" || !Number.isInteger(value.transitionCount) || value.transitionCount < 0) throw new Error("coverage schema fields are missing or invalid");
    const coverage: ExplorationReport["coverage"] = { actions: value.actions, states: value.stateCount, transitions: value.transitionCount, unexplored: Array.isArray(value.unexplored) ? value.unexplored.filter((item): item is string => typeof item === "string") : [], ...(Array.isArray(value.timeline) ? { timeline: value.timeline } : {}) };
    const artifactRoot = join(runDir, "artifacts");
    const files = await listFiles(artifactRoot);
    const relative = (path: string) => path.slice(artifactRoot.length + 1).replaceAll("\\", "/");
    const image = /\.(png|jpg|jpeg)$/i;
    const screenshots = files.filter(path => image.test(path) && !relative(path).startsWith("frames/") && !relative(path).startsWith("video/")).length;
    const videos = files.filter(path => relative(path).startsWith("video/") && /\.webm$/i.test(path)).length;
    const sampledFrames = files.filter(path => relative(path).startsWith("frames/") && image.test(path)).length;
    const snapshotPath = join(runDir, "adaptive", "candidate-snapshots.jsonl");
    if (!existsSync(snapshotPath)) throw new Error("coverage-debt evidence is missing");
    const snapshotLines = (await readFile(snapshotPath, "utf8")).split(/\r?\n/).filter(Boolean);
    for (const line of snapshotLines) {
      const snapshot = JSON.parse(line) as { schemaVersion?: string; coverageDebt?: Array<Record<string, unknown>> };
      if (snapshot.schemaVersion !== "lakda/candidate-snapshots/v1" || !Array.isArray(snapshot.coverageDebt)) throw new Error("coverage-debt evidence schema is invalid");
      for (const debt of snapshot.coverageDebt) {
        if (debt.schemaVersion !== "lakda-coverage-debt/v1" || typeof debt.debtId !== "string" || typeof debt.actionKind !== "string" || typeof debt.targetFingerprint !== "string" || !["ambiguous-locator", "sensitive-locator", "missing-accessible-name", "missing-input-profile", "out-of-scope-link", "disabled-control", "unsupported-control", "unknown-screen"].includes(String(debt.reason)) || !["not-applicable", "resolved", "ambiguous", "unavailable"].includes(String(debt.scope)) || (debt.name !== undefined && debt.nameDigest !== undefined)) throw new Error("coverage-debt evidence is invalid");
      }
    }
    const attestations = requireBinaryAttestation ? await readBinaryAttestations(runDir) : new Map();
    const binaryPaths = requireBinaryAttestation ? files.filter(path => /\.(png|jpg|jpeg|webm|zip)$/i.test(path)).map(relative) : [];
    const attestationFailures: string[] = [];
    if (requireBinaryAttestation && binaryPaths.length > 0) {
      const metadata = await readJson(join(runDir, "run-metadata.json")) as { artifactPolicy?: { artifactAttestorKeyIds?: unknown } };
      const metadataKeys = metadata.artifactPolicy?.artifactAttestorKeyIds;
      if (!Array.isArray(metadataKeys) || metadataKeys.some(key => typeof key !== "string") || allowedKeyIds === undefined || metadataKeys.length !== allowedKeyIds.length || metadataKeys.some(key => !allowedKeyIds.includes(key)) || allowedKeyIds.some(key => !metadataKeys.includes(key))) {
        attestationFailures.push("binary-attestation-key-allowlist-mismatch");
      }
    }
    for (const path of binaryPaths) {
      const attestation = attestations.get(path);
      if (!attestation || !(await verifyBinaryAttestation(runDir, path, attestation, { requireSignature: true, trustStorePath, ...(allowedKeyIds !== undefined ? { allowedKeyIds } : {}) }))) attestationFailures.push(`binary-attestation-required:${path}`);
    }
    return { coverage, findings: [], capture: { screenshots, videos, sampledFrames, failures: attestationFailures } };
  } catch { return { ...empty, capture: { ...empty.capture, failures: ["adaptive-coverage-invalid"] } }; }
}

export async function buildExplorationReport(paths: ExplorationSessionPaths): Promise<ExplorationReport> {
  const session = (await loadExplorationSession(paths.root)).session;
  const charter = await loadExplorationCharter(paths);
  const findings = await readFindings(paths);
  let artifactAttestorKeyIds: string[] | undefined;
  if (charter.executionMode === "real") {
    // The copied, signed target manifest is the source of truth for the
    // binary-attestor allowlist.  Acceptance performs the full signature and
    // binding verification; report generation still treats a missing/invalid
    // manifest as an empty allowlist so any retained binary fails closed.
    try {
      const loadedTarget = await loadSignedExplorationTargetManifest(paths.targetManifest, charter, session.configDigest);
      artifactAttestorKeyIds = loadedTarget.manifest.artifactAttestorKeyIds ? [...loadedTarget.manifest.artifactAttestorKeyIds] : [];
    } catch { artifactAttestorKeyIds = []; }
  }
  const run = await readAdaptiveCoverage(session.lastRunDir ? resolveRunDirectoryReference(explorationRunRoot(charter), session.lastRunDir) : undefined, charter.executionMode === "real", charter.trustStorePath ? resolve(charter.trustStorePath) : undefined, artifactAttestorKeyIds);
  const blockers = [...(session.blockers ?? []), ...run.capture.failures];
  if (session.technicalOutcome && session.technicalOutcome !== "passed" && !blockers.some(blocker => blocker.startsWith("technical-outcome:"))) blockers.push(`technical-outcome:${session.technicalOutcome}`);
  const report: ExplorationReport = {
    schemaVersion: "lakda/exploration-report/v1", sessionId: session.sessionId, status: session.status, charterDigest: session.charterDigest,
    platform: session.platform, lane: session.lane, targetRevision: charter.targetRevision, executionMode: charter.executionMode, coverage: { ...run.coverage, actions: Math.max(run.coverage.actions, session.actionCount) },
    findings: findings.length ? findings : run.findings, blockers, capture: run.capture,
    residualRisk: [...blockers, ...findings.filter(finding => finding.status === "exploratory-finding").map(finding => `${finding.kind}:${finding.findingId}`)], goNoGo: "external-qeg-required", runIds: session.runIds,
    sessionStatus: session.status, ...(session.technicalOutcome ? { technicalOutcome: session.technicalOutcome } : {}), ...(session.terminationReason ? { terminationReason: session.terminationReason } : {}), acceptanceStatus: charter.executionMode === "fixture" || charter.executionMode === "mock" || charter.executionMode === "emulator" ? "fixture_only" : "pending_external",
  };
  const nativeLane = charter.platform === "windows" || charter.platform === "android" || charter.platform === "ios";
  const acceptanceRequired = charter.executionMode === "real";
  if ((nativeLane && charter.executionMode !== "real" || acceptanceRequired) && session.status === "completed") {
    report.status = "pending_external";
    if (!report.blockers.includes("real-lane-acceptance-required")) report.blockers.push("real-lane-acceptance-required");
    report.residualRisk.push("real-lane-acceptance-required");
  }
  assertExplorationReport(report);
  await writeJsonAtomic(paths.report, report);
  await buildSessionHateManifest(paths, await readSession(paths));
  return report;
}

export async function checkpointFromRun(paths: ExplorationSessionPaths, result: { runId: string; runDir?: string; runDirectoryRef?: string; artifactManifestPath?: string; actionCount?: number; actionOffset?: number; lastFingerprint?: string; activeDurationMs?: number; actionTimestamps?: number[] }): Promise<void> {
  const session = (await loadExplorationSession(paths.root)).session;
  let segmentActions = result.actionCount;
  let lastFingerprint = result.lastFingerprint;
  let traceSha256: string | undefined;
  let replayTraceSha256: string | undefined;
  if (result.runDir) {
    const coverage = await readJson(join(result.runDir, "adaptive", "coverage.json")) as { actions?: unknown };
    if (typeof coverage.actions !== "number") throw new Error("resume checkpointには検証済みcoverageが必要です");
    segmentActions = Math.max(0, coverage.actions - (result.actionOffset ?? 0));
    const tracePath = join(result.runDir, "adaptive", "trace.json");
    const trace = await readJson(tracePath) as { schemaVersion?: string; trace?: Array<Record<string, unknown>> };
    if (trace.schemaVersion !== "lakda/adaptive-trace/v1" || !Array.isArray(trace.trace)) throw new Error("resume checkpointにはversioned adaptive traceが必要です");
    const entries = trace.trace ?? [];
    const last = [...entries].reverse().find(entry => typeof entry.postFingerprint === "string");
    if (segmentActions > 0 && !last) throw new Error("resume checkpointにはaction後のpostFingerprintが必要です");
    if (typeof last?.postFingerprint === "string") lastFingerprint = last.postFingerprint;
    traceSha256 = `sha256:${(await fileDigest(tracePath)).sha256}`;
    const replayTracePath = join(result.runDir, "adaptive", "replay-trace.json");
    replayTraceSha256 = `sha256:${(await fileDigest(replayTracePath)).sha256}`;
  }
  const totalActions = session.actionCount + (segmentActions ?? 0);
  if (totalActions > 0 && !lastFingerprint) throw new Error("resume checkpointにはlastFingerprintが必要です");
  const runManifestRef = result.artifactManifestPath ? await registerRunManifest(paths, result.runId, result.artifactManifestPath) : undefined;
  await writeCheckpoint(paths, { runId: result.runId, ...(result.runDirectoryRef ? { lastRunDir: result.runDirectoryRef } : {}), actionCount: totalActions, ...(lastFingerprint ? { lastFingerprint } : {}), ...(traceSha256 ? { traceSha256 } : {}), ...(replayTraceSha256 ? { replayTraceSha256 } : {}), ...(result.activeDurationMs !== undefined ? { activeDurationMs: result.activeDurationMs } : {}), ...(result.actionTimestamps ? { actionTimestamps: result.actionTimestamps } : {}), ...(runManifestRef ? { runManifestRef } : {}) });
}
