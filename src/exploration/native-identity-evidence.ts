import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { findSensitive } from "../core/redaction.js";
import { nativeActionLease, validateNativeActionReceiptExpectation } from "./native-identity-actions.js";
import { assertNativeIdentityObservation, nativeIdentityDigest, nativeIdentityTime, NativeIdentityError } from "./native-identity-contracts.js";
import { verifyNativeIdentityForTarget, type NativeExplorationTargetManifest } from "./native-identity-target.js";
import type { NativeExecutionEvidence } from "./native-identity-executor.js";
import { NativeCaptureEvidenceVerifier } from "./native-identity-capture-verifier.js";
import type { ExplorationCharter } from "./contracts.js";

export const NATIVE_EVIDENCE_VERSION = "lakda/native-execution-evidence/v2" as const;
export const NATIVE_EVIDENCE_LEGACY_VERSION = "lakda/native-execution-evidence/v1" as const;
export const MAX_NATIVE_EVIDENCE_BYTES = 131072;
export const MAX_NATIVE_CAPTURE_EVIDENCE_BYTES = 4 * 1024 * 1024 + 16384;
export const MAX_NATIVE_JOURNAL_BYTES = 32 * 1024 * 1024;
export type NativeEvidenceBinding = { sessionId: string; charterDigest: string; configDigest: string; targetManifestSha256: string };
export type NativeEvidenceEnvelope = { schemaVersion: typeof NATIVE_EVIDENCE_VERSION | typeof NATIVE_EVIDENCE_LEGACY_VERSION; binding: NativeEvidenceBinding; journalId: string; sequence: number; evidence: NativeExecutionEvidence };
export type NativeEvidenceTarget = { manifest: NativeExplorationTargetManifest; sha256: string };
type Validator = (value: unknown) => boolean;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as new (options: object) => { compile(schema: object): Validator; addSchema(schema: object): unknown };
const schema = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "..", "schemas", name), "utf8")) as object;
const ajv = new Ajv({ strict: false, strictNumbers: true });
const validateLegacy = ajv.compile(schema("lakda-native-execution-evidence-v1.schema.json"));
ajv.addSchema(schema("lakda-native-capture-v1.schema.json"));
ajv.addSchema(schema("lakda-native-capture-evidence-v1.schema.json"));
const validateCurrent = ajv.compile(schema("lakda-native-execution-evidence-v2.schema.json"));
const refused = () => new NativeIdentityError("native-evidence-invalid");

export function assertNativeEvidenceEnvelope(value: unknown): asserts value is NativeEvidenceEnvelope {
  let raw: string;
  try { raw = JSON.stringify(value); } catch { throw refused(); }
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_NATIVE_CAPTURE_EVIDENCE_BYTES
    || !(validateLegacy(value) || validateCurrent(value)) || findSensitive(raw).length) throw refused();
  const envelope = value as NativeEvidenceEnvelope;
  if ((envelope.schemaVersion === NATIVE_EVIDENCE_LEGACY_VERSION || envelope.evidence.kind !== "capture-finished") && Buffer.byteLength(raw) > MAX_NATIVE_EVIDENCE_BYTES) throw refused();
  if (envelope.evidence.kind === "observation") assertNativeIdentityObservation(envelope.evidence.acquisition.observation);
}

/** Verify recorded assertions against an already signature-verified target; this is not an operator approval. */
export class NativeEvidenceVerifier {
  private observation?: Extract<NativeExecutionEvidence, { kind: "observation" }>;
  private pending?: Extract<NativeExecutionEvidence, { kind: "action-requested" }>;
  private ordinal = 0;
  private stopped = false;
  private uncertain = false;
  private timeFloor = 0;
  private readonly captures: NativeCaptureEvidenceVerifier;
  constructor(private readonly target: NativeEvidenceTarget, capturePolicy?: ExplorationCharter["capture"]) {
    this.captures = new NativeCaptureEvidenceVerifier(target, time => this.at(time), capturePolicy && structuredClone(capturePolicy));
  }
  get complete(): boolean { return !!this.observation && !this.pending && !this.uncertain && this.captures.complete; }

  private at(time: number): void {
    if (!this.observation || time < this.timeFloor) throw refused();
    const acquisition = this.observation.acquisition;
    verifyNativeIdentityForTarget(this.target.manifest, { ...acquisition, now: time,
      elapsedMs: acquisition.elapsedMs + Math.max(0, time - acquisition.now) });
  }

  accept(value: NativeExecutionEvidence): void {
    if (value.kind === "observation") {
      if (this.observation || value.targetManifestSha256 !== this.target.sha256) throw refused();
      verifyNativeIdentityForTarget(this.target.manifest, value.acquisition);
      this.observation = structuredClone(value);
      this.captures.observe(value);
      this.timeFloor = value.acquisition.now;
      return;
    }
    if (value.kind === "capture-requested" || value.kind === "capture-finished") {
      const time = value.kind === "capture-requested" ? value.requestedAt : value.finishedAt;
      if (!this.observation || this.pending || time < this.timeFloor) throw refused();
      if (this.stopped && value.kind === "capture-requested" && !["stop", "discard"].includes(value.expectation.operation)) throw refused();
      this.captures.accept(value); this.timeFloor = time; return;
    }
    if (!this.observation || this.stopped || this.captures.blocked || this.captures.pending) throw refused();
    if (value.kind === "action-requested") {
      const expected = value.expectation, signature = this.target.manifest.signature;
      if (this.pending || expected.schemaVersion !== "lakda/native-action-request/v2" || expected.ordinal !== this.ordinal + 1
        || nativeIdentityDigest(expected.lease) !== nativeIdentityDigest(nativeActionLease(this.observation.acquisition.observation))
        || nativeIdentityDigest(expected.approvalWindow) !== nativeIdentityDigest({ targetManifestSha256: this.target.sha256, validFrom: signature.validFrom, validUntil: signature.validUntil })) throw refused();
      this.at(value.requestedAt);
      this.pending = structuredClone(value); this.ordinal = expected.ordinal; this.timeFloor = value.requestedAt;
      return;
    }
    if (!this.pending || value.requestSha256 !== this.pending.requestSha256 || value.ordinal !== this.ordinal || value.finishedAt < this.timeFloor) throw refused();
    if (value.startedAt !== null && (value.startedAt < this.timeFloor || value.startedAt > value.finishedAt)) throw refused();
    if (value.receipt) {
      if (value.startedAt === null || value.actionAttempted !== value.receipt.actionAttempted) throw refused();
      this.at(value.startedAt);
      validateNativeActionReceiptExpectation(this.pending.expectation, value.receipt, value.startedAt, value.finishedAt);
      this.at(nativeIdentityTime(value.receipt.checkedAt));
    } else if (value.actionAttempted !== (value.startedAt === null ? false : "unknown") || value.executionStatus !== "failed") throw refused();
    if (value.executionStatus === "completed") {
      if (!value.receipt) throw refused();
      this.at(value.finishedAt);
    }
    this.uncertain = value.actionAttempted === "unknown";
    this.stopped = value.executionStatus === "failed" || !value.receipt || (value.receipt.operation === "execute" ? value.receipt.result.status !== "executed" : !value.receipt.result.recovered);
    this.pending = undefined; this.timeFloor = value.finishedAt;
  }
}
