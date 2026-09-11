import { randomUUID } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { appendSessionEvent, sessionPaths, verifyExplorationSessionSnapshot, type ExplorationSessionPaths } from "./session.js";
import { NativeIdentityError, nativeIdentityDigest } from "./native-identity-contracts.js";
import { assertNativeEvidenceEnvelope, MAX_NATIVE_EVIDENCE_BYTES, MAX_NATIVE_CAPTURE_EVIDENCE_BYTES, MAX_NATIVE_JOURNAL_BYTES, NATIVE_EVIDENCE_VERSION,
  NativeEvidenceVerifier, type NativeEvidenceBinding, type NativeEvidenceEnvelope, type NativeEvidenceTarget } from "./native-identity-evidence.js";
import { createNativeEvidenceDirectory, nativeEvidencePath, publishNativeEvidenceBytes, readNativeEvidenceBytes } from "./native-identity-evidence-io.js";
import type { NativeExecutionEvidence, NativeExecutionEvidenceSink } from "./native-identity-executor.js";
import { assertExplorationCharter } from "./contracts.js";

type Reference = { schemaVersion: "lakda/native-evidence-ref/v1" | "lakda/native-evidence-ref/v2"; path: string; sha256: string; size: number; journalId: string; sequence: number };
const referenceLimit = (ref: Reference) => ref.schemaVersion === "lakda/native-evidence-ref/v2" ? MAX_NATIVE_CAPTURE_EVIDENCE_BYTES : MAX_NATIVE_EVIDENCE_BYTES;
const refused = () => new NativeIdentityError("native-evidence-store-invalid");
const json = (bytes: Buffer): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
function observationKeys(value: NativeExecutionEvidence): string[] {
  if (value.kind !== "observation") return [];
  const observation = value.acquisition.observation;
  return [`observation:${observation.observationId}`, `connection:${observation.bridgeBinding.connectionId}`, `challenge:${observation.challenge}`];
}

async function sessionSnapshot(paths: ExplorationSessionPaths, target: NativeEvidenceTarget, signal: AbortSignal) {
  const sessionBytes = await readNativeEvidenceBytes(paths.root, "session.json", MAX_NATIVE_JOURNAL_BYTES, signal);
  const eventsBytes = await readNativeEvidenceBytes(paths.root, "events.jsonl", MAX_NATIVE_JOURNAL_BYTES, signal);
  const snapshot = verifyExplorationSessionSnapshot(json(sessionBytes), new TextDecoder("utf-8", { fatal: true }).decode(eventsBytes));
  const manifest = await readNativeEvidenceBytes(paths.root, "target-manifest.json", 262144, signal);
  const charter = await readNativeEvidenceBytes(paths.root, "charter.json", MAX_NATIVE_JOURNAL_BYTES, signal);
  const charterValue = json(charter); assertExplorationCharter(charterValue);
  const session = snapshot.session;
  if (target.sha256 !== `sha256:${sha256(manifest)}` || nativeIdentityDigest(json(manifest)) !== nativeIdentityDigest(target.manifest)
    || session.targetManifestDigest !== target.sha256 || session.charterDigest !== target.manifest.charterDigest
    || session.configDigest !== target.manifest.configDigest || nativeIdentityDigest(charterValue) !== session.charterDigest) throw refused();
  const binding: NativeEvidenceBinding = { sessionId: session.sessionId, charterDigest: session.charterDigest,
    configDigest: session.configDigest, targetManifestSha256: target.sha256 };
  return { ...snapshot, binding, capturePolicy: structuredClone(charterValue.capture), sourceDigest: nativeIdentityDigest([sha256(sessionBytes), sha256(eventsBytes), sha256(manifest), sha256(charter)]) };
}

function reference(value: unknown): Reference {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw refused();
  const ref = value as Reference;
  if (Object.keys(ref).sort().join() !== "journalId,path,schemaVersion,sequence,sha256,size" || !["lakda/native-evidence-ref/v1", "lakda/native-evidence-ref/v2"].includes(ref.schemaVersion)
    || typeof ref.path !== "string" || !nativeEvidencePath.test(ref.path) || ref.path !== `native-identity/${ref.journalId}/${String(ref.sequence).padStart(6, "0")}.json`
    || !Number.isInteger(ref.sequence) || ref.sequence < 1 || ref.sequence > 20001 || !Number.isInteger(ref.size) || ref.size < 1 || ref.size > referenceLimit(ref)
    || typeof ref.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(ref.sha256)) throw refused();
  return ref;
}

async function verifyInventory(root: string, expected: Set<string>) {
  const base = join(root, "native-identity");
  let folders;
  try { folders = await readdir(base, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && expected.size === 0) return; throw refused(); }
  if ((await lstat(base)).isSymbolicLink() || folders.length > 256) throw refused();
  const actual = new Set<string>();
  for (const folder of folders) {
    if (!folder.isDirectory() || folder.isSymbolicLink()) throw refused();
    const files = await readdir(join(base, folder.name), { withFileTypes: true });
    if (!files.length || files.length > 20001) throw refused();
    for (const file of files) {
      const relative = `native-identity/${folder.name}/${file.name}`;
      if (!file.isFile() || file.isSymbolicLink() || !nativeEvidencePath.test(relative) || !expected.has(relative)) throw refused();
      actual.add(relative);
    }
  }
  if (actual.size !== expected.size) throw refused();
}

/** Read-only proof check. The caller remains responsible for verifying the target signature and its trusted keys. */
export async function readSessionNativeEvidence(suppliedPaths: ExplorationSessionPaths, suppliedTarget: NativeEvidenceTarget, requestedSignal?: AbortSignal): Promise<{ complete: boolean; records: NativeEvidenceEnvelope[]; references: Reference[]; bytes: number; sourceDigest: string }> {
  try {
    const paths = sessionPaths(suppliedPaths.root);
    const target = structuredClone(suppliedTarget), deadline = AbortSignal.timeout(5000);
    const signal = requestedSignal ? AbortSignal.any([deadline, requestedSignal]) : deadline;
    const snapshot = await sessionSnapshot(paths, target, signal), expected = new Set<string>(), records: NativeEvidenceEnvelope[] = [];
    const journals = new Map<string, { verifier: NativeEvidenceVerifier; count: number; version: NativeEvidenceEnvelope["schemaVersion"] }>(), references: Reference[] = [];
    let total = 0, lastJournal: string | undefined;
    const identities = new Set<string>();
    for (const event of snapshot.events) {
      if (!event.payload || !("nativeEvidenceRef" in event.payload)) continue;
      if (event.type !== "checkpoint" || records.length >= 20001) throw refused();
      const ref = reference(event.payload.nativeEvidenceRef);
      if (expected.has(ref.path) || (total += ref.size) > MAX_NATIVE_JOURNAL_BYTES) throw refused();
      const bytes = await readNativeEvidenceBytes(paths.root, ref.path, referenceLimit(ref), signal);
      if (bytes.length !== ref.size || `sha256:${sha256(bytes)}` !== ref.sha256) throw refused();
      const value = json(bytes); assertNativeEvidenceEnvelope(value);
      if (ref.schemaVersion !== (value.schemaVersion === NATIVE_EVIDENCE_VERSION ? "lakda/native-evidence-ref/v2" : "lakda/native-evidence-ref/v1")) throw refused();
      if (value.journalId !== ref.journalId || value.sequence !== ref.sequence || nativeIdentityDigest(value.binding) !== nativeIdentityDigest(snapshot.binding)) throw refused();
      let journal = journals.get(value.journalId);
      if (journal && (lastJournal !== value.journalId || journal.version !== value.schemaVersion)) throw refused();
      if (!journal) {
        if ([...journals.values()].some(item => !item.verifier.complete)) throw refused();
        journal = { verifier: new NativeEvidenceVerifier(target, snapshot.capturePolicy), count: 0, version: value.schemaVersion }; journals.set(value.journalId, journal);
      }
      if (value.sequence !== ++journal.count) throw refused();
      for (const key of observationKeys(value.evidence)) {
        if (identities.has(key)) throw refused();
        identities.add(key);
      }
      journal.verifier.accept(value.evidence); expected.add(ref.path); records.push(value); references.push(ref);
      lastJournal = value.journalId;
    }
    await verifyInventory(paths.root, expected);
    if ((await sessionSnapshot(paths, target, signal)).sourceDigest !== snapshot.sourceDigest) throw refused();
    return { complete: records.length > 0 && [...journals.values()].every(item => item.verifier.complete), records, references, bytes: total, sourceDigest: snapshot.sourceDigest };
  } catch { throw refused(); }
}

/** Attach to a signature-verifying executor; creating a sink never authorizes an action. */
export async function createSessionNativeEvidenceSink(suppliedPaths: ExplorationSessionPaths, suppliedTarget: NativeEvidenceTarget): Promise<NativeExecutionEvidenceSink & { journalId: string }> {
  const paths = sessionPaths(suppliedPaths.root);
  const target = structuredClone(suppliedTarget), existing = await readSessionNativeEvidence(paths, target);
  if ((existing.records.length > 0 && !existing.complete) || existing.records.length >= 19999
    || new Set(existing.records.map(value => value.journalId)).size >= 256 || existing.bytes + 3 * MAX_NATIVE_EVIDENCE_BYTES > MAX_NATIVE_JOURNAL_BYTES) throw refused();
  const snapshot = await sessionSnapshot(paths, target, AbortSignal.timeout(5000));
  if (!["draft", "paused", "running"].includes(snapshot.session.status)) throw refused();
  const journalId = randomUUID(), verifier = new NativeEvidenceVerifier(target, snapshot.capturePolicy);
  await createNativeEvidenceDirectory(paths.root, journalId);
  const priorIdentities = new Set(existing.records.flatMap(value => observationKeys(value.evidence)));
  let sequence = 0, used = existing.bytes, busy = false, stopped = false;
  return { journalId, async record(input: NativeExecutionEvidence): Promise<void> {
    if (busy || stopped) throw refused();
    busy = true;
    try {
      const value: NativeEvidenceEnvelope = { schemaVersion: NATIVE_EVIDENCE_VERSION, binding: structuredClone(snapshot.binding),
        journalId, sequence: sequence + 1, evidence: structuredClone(input) };
      assertNativeEvidenceEnvelope(value);
      if (observationKeys(value.evidence).some(key => priorIdentities.has(key))) throw refused();
      verifier.accept(value.evidence);
      const bytes = Buffer.from(`${canonicalJson(value)}\n`), reserved = input.kind === "capture-requested" ? MAX_NATIVE_CAPTURE_EVIDENCE_BYTES : input.kind === "action-requested" ? MAX_NATIVE_EVIDENCE_BYTES : 0;
      if (bytes.length > MAX_NATIVE_CAPTURE_EVIDENCE_BYTES || used + bytes.length + reserved > MAX_NATIVE_JOURNAL_BYTES || existing.records.length + sequence + 1 + (reserved ? 1 : 0) > 20001) throw refused();
      const signal = AbortSignal.timeout(5000), current = await sessionSnapshot(paths, target, signal);
      if (nativeIdentityDigest(current.binding) !== nativeIdentityDigest(snapshot.binding) || !["draft", "paused", "running"].includes(current.session.status)) throw refused();
      const path = `native-identity/${journalId}/${String(value.sequence).padStart(6, "0")}.json`;
      await publishNativeEvidenceBytes(paths.root, path, bytes, signal);
      if (!(await readNativeEvidenceBytes(paths.root, path, MAX_NATIVE_CAPTURE_EVIDENCE_BYTES, signal)).equals(bytes)) throw refused();
      const ref: Reference = { schemaVersion: "lakda/native-evidence-ref/v2", path, sha256: `sha256:${sha256(bytes)}`, size: bytes.length, journalId, sequence: value.sequence };
      signal.throwIfAborted();
      await appendSessionEvent(paths, { type: "checkpoint", payload: { nativeEvidenceRef: ref } });
      signal.throwIfAborted();
      sequence++; used += bytes.length;
    } catch { stopped = true; throw refused(); }
    finally { busy = false; }
  } };
}
