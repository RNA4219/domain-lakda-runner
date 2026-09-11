import { setTimeout as sleep } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { AttestationDirectory } from "./attestation-io.js";
import { assertAttestationRequest, assertAttestationReceipt, attestationRequestDigest, attestationTime, AttestationContractError,
  type BinaryAttestationRequest, type AcceptedBinaryAttestation, type AttestationReceipt } from "./attestation-contracts.js";
import { assertAttestationTrust, verifyAttestationResponse, type AttestationResponseContext } from "./attestation-response.js";
import { adoptAttestationMedia, quarantineAttestationSource } from "./attestation-media.js";
import { publishAttestationEvidence, type AttestationPublicationControl } from "./attestation-publication.js";

export type AttestationExchangeOptions = {
  stagingRoot: string; runDirectory: string; request: BinaryAttestationRequest; context: Omit<AttestationResponseContext, "now">;
  clock?: () => number; monotonic?: () => number; wait?: (ms: number) => Promise<void>;
  monotonicDeadline?: number;
  signal?: AbortSignal; shouldStop?: () => boolean | Promise<boolean>;
};
export type { AttestationReceipt } from "./attestation-contracts.js";
type Published = { request: BinaryAttestationRequest; size: number; sha256: string };
export type AttestationRetention = { receipt: AttestationReceipt; response?: AcceptedBinaryAttestation } & (
  { adoption: "not-attempted"; reason: null }
  | { adoption: "failed"; reason: string }
  | { adoption: "adopted"; reason: null; artifact: { path: string; size: number; sha256: string }; response: AcceptedBinaryAttestation }
);

export async function createAttestationExchange(options: AttestationExchangeOptions, preparedDirectory?: AttestationDirectory): Promise<AttestationExchange> {
  assertAttestationRequest(options.request); assertAttestationTrust(options.context);
  const clock = options.clock ?? Date.now, monotonic = options.monotonic ?? (() => performance.now());
  const now = clock(), remaining = attestationTime(options.request.expiresAt) - now;
  if (!Number.isSafeInteger(now) || now < attestationTime(options.request.createdAt)) throw new AttestationContractError("time-invalid");
  if (remaining <= 0) throw new AttestationContractError("request-expired");
  if (options.monotonicDeadline !== undefined && !Number.isFinite(options.monotonicDeadline)) throw new AttestationContractError("time-invalid");
  const startedMonotonic = monotonic(), deadline = Math.min(startedMonotonic + remaining, options.monotonicDeadline ?? Infinity);
  if (!Number.isFinite(deadline)) throw new AttestationContractError("time-invalid");
  if (deadline <= startedMonotonic) throw new AttestationContractError("request-expired");
  const directory = preparedDirectory ?? await AttestationDirectory.create(options.stagingRoot, options.runDirectory);
  if (directory.runDirectory !== resolve(options.runDirectory) || dirname(directory.root) !== resolve(options.stagingRoot)) throw new AttestationContractError("directory-binding-mismatch");
  await directory.assertOpen();
  return new AttestationExchange(directory, { ...options, request: structuredClone(options.request), context: structuredClone(options.context) }, clock, monotonic, deadline);
}

/** Receive verifies protocol records; stage/retain additionally quarantine and adopt verified media bytes. */
export class AttestationExchange {
  readonly directory: string;
  private readonly published = new Map<string, Published>();
  private readonly stageAttempts = new Set<string>();
  private readonly staged = new Set<string>();
  private readonly retained = new Map<string, AttestationRetention>();
  private publicationAttempted = false;
  constructor(private readonly io: AttestationDirectory, private readonly options: AttestationExchangeOptions,
    private readonly clock: () => number, private readonly monotonic: () => number, private readonly deadline: number) { this.directory = io.root; }

  private expired(): boolean { return this.monotonic() >= this.deadline || this.clock() >= attestationTime(this.options.request.expiresAt); }
  private async stopped(): Promise<boolean> { return this.options.signal?.aborted === true || await this.options.shouldStop?.() === true; }

  private assertBinding(request: BinaryAttestationRequest): void {
    assertAttestationRequest(request);
    for (const field of ["runId", "sessionId", "targetManifestSha256", "policyDigest", "createdAt", "expiresAt"] as const) {
      if (request[field] !== this.options.request[field]) throw new AttestationContractError("exchange-binding-mismatch");
    }
  }

  private async assertActive(): Promise<void> {
    if (await this.stopped()) throw new AttestationContractError("request-cancelled");
    if (this.expired()) throw new AttestationContractError("request-expired");
  }

  private mediaOptions(maxBytes: number) {
    return { maxBytes, signal: this.options.signal, clock: this.clock, check: () => this.assertActive() };
  }

  async stage(request: BinaryAttestationRequest, maxBytes: number): Promise<void> {
    this.assertBinding(request); await this.assertActive();
    if (this.stageAttempts.has(request.requestId) || this.published.has(request.requestId)) throw new AttestationContractError("source-already-staged");
    this.stageAttempts.add(request.requestId);
    await quarantineAttestationSource(this.io, request, this.mediaOptions(maxBytes));
    await this.publish(request);
    this.staged.add(request.requestId);
  }

  async retain(requestId: string, maxBytes: number): Promise<AttestationRetention> {
    if (!this.staged.has(requestId)) throw new AttestationContractError("source-not-staged");
    const result = await this.receive(requestId);
    if (!result.response) return this.rememberRetention(requestId, { ...result, adoption: "not-attempted", reason: null });
    try {
      const artifact = await adoptAttestationMedia(this.io, this.published.get(requestId)!.request, result.response, result.receipt, this.options.context, this.mediaOptions(maxBytes));
      return this.rememberRetention(requestId, { receipt: result.receipt, response: result.response, adoption: "adopted", reason: null, artifact });
    } catch (error) {
      return this.rememberRetention(requestId, { ...result, adoption: "failed", reason: error instanceof AttestationContractError ? error.code : "media-adoption-failed" });
    }
  }

  private rememberRetention(requestId: string, result: AttestationRetention): AttestationRetention {
    this.retained.set(requestId, structuredClone(result));
    return result;
  }

  async exportRetained(maxBytes: number, control: AttestationPublicationControl = {}): Promise<Array<{ path: string; size: number; sha256: string }>> {
    if (this.publicationAttempted) throw new AttestationContractError("already-exported");
    if (this.staged.size !== this.published.size || this.retained.size !== this.published.size) throw new AttestationContractError("exchange-not-complete");
    this.publicationAttempted = true;
    const entries = [...this.published].map(([id, saved]) => ({ request: saved.request, result: this.retained.get(id)! }));
    const startedAt = this.clock(), startedMonotonic = this.monotonic();
    const budget = attestationTime(this.options.request.expiresAt) - attestationTime(this.options.request.createdAt);
    const alreadyStopped = entries.some(({ result }) => result.receipt.status === "cancelled" || result.reason === "request-cancelled") || await this.stopped();
    const check = async () => {
      control.signal?.throwIfAborted(); await control.check?.();
      if (await this.stopped() && !alreadyStopped) throw new AttestationContractError("request-cancelled");
      const current = this.clock(), elapsed = this.monotonic();
      if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(current) || current < startedAt || startedAt < attestationTime(this.options.request.createdAt)
        || !Number.isFinite(startedMonotonic) || !Number.isFinite(elapsed) || elapsed < startedMonotonic) throw new AttestationContractError("time-invalid");
      if (current >= startedAt + budget || elapsed >= startedMonotonic + budget) throw new AttestationContractError("publication-expired");
    };
    return publishAttestationEvidence(this.io, entries, this.options.request, this.options.context, maxBytes, { signal: control.signal, check });
  }

  async publish(request: BinaryAttestationRequest): Promise<void> {
    this.assertBinding(request);
    if (this.expired()) throw new AttestationContractError("request-expired");
    if (await this.stopped()) throw new AttestationContractError("request-cancelled");
    if (this.published.has(request.requestId)) throw new AttestationContractError("request-already-published");
    try {
      const saved = await this.io.write(`attestations/requests/${request.requestId}.json`, request);
      this.published.set(request.requestId, { request: structuredClone(request), ...saved });
    } catch (error) {
      if (error instanceof AttestationContractError && error.code === "message-already-exists") throw new AttestationContractError("request-already-published");
      throw error;
    }
  }

  private async checkRequest(saved: Published): Promise<void> {
    try {
      if (!await this.io.read(`attestations/requests/${saved.request.requestId}.json`, saved)) throw new Error();
    } catch { throw new AttestationContractError("request-changed"); }
  }

  async receive(requestId: string): Promise<{ receipt: AttestationReceipt; response?: AcceptedBinaryAttestation }> {
    const saved = this.published.get(requestId);
    if (!saved) throw new AttestationContractError("request-not-published");
    await this.checkRequest(saved);
    const request = saved.request, requestSha256 = attestationRequestDigest(request);
    try { await this.io.write(`attestations/claims/${requestId}.json`, { requestId, requestSha256 }); }
    catch (error) {
      if (error instanceof AttestationContractError && error.code === "message-already-exists") throw new AttestationContractError("request-already-claimed");
      throw error;
    }
    let responseSha256: string | null = null, receivedAt: string | null = null;
    const finish = async (status: AttestationReceipt["status"], reason: string | null, response?: AcceptedBinaryAttestation) => {
      const receipt: AttestationReceipt = { schemaVersion: "lakda/binary-attestation-receipt/v1", requestId, requestSha256,
        runId: request.runId, targetManifestSha256: request.targetManifestSha256, status, reason, responseSha256, receivedAt,
        finishedAt: new Date(this.clock()).toISOString() };
      assertAttestationReceipt(receipt);
      await this.io.write(`attestations/receipts/${requestId}.json`, receipt);
      return { receipt, ...(response ? { response } : {}) };
    };
    for (;;) {
      if (await this.stopped()) return finish("cancelled", "stop-requested");
      if (this.expired()) return finish("timeout", "request-expired");
      try {
        const snapshot = await this.io.read(`attestations/responses/${requestId}.json`);
        if (await this.stopped()) return finish("cancelled", "stop-requested");
        if (this.expired()) return finish("timeout", "request-expired");
        if (snapshot?.bytes) {
          responseSha256 = snapshot.sha256; receivedAt = new Date(this.clock()).toISOString();
          await this.checkRequest(saved);
          let value: unknown;
          try { value = JSON.parse(snapshot.bytes.toString("utf8")); }
          catch { return finish("rejected", "response-invalid"); }
          if (snapshot.bytes.toString("utf8") !== canonicalJson(value) + "\n") return finish("rejected", "response-invalid");
          try {
            const response = verifyAttestationResponse(request, value, { ...this.options.context, now: this.clock() });
            if (await this.stopped()) return finish("cancelled", "stop-requested");
            if (this.expired()) return finish("timeout", "request-expired");
            return finish("response-verified", null, response);
          } catch (error) {
            const reason = error instanceof AttestationContractError ? error.code : "response-invalid";
            return finish(reason === "request-expired" ? "timeout" : "rejected", reason);
          }
        }
        const duration = Math.max(1, Math.min(250, this.deadline - this.monotonic()));
        if (this.options.wait) await this.options.wait(duration);
        else await sleep(duration, undefined, this.options.signal ? { signal: this.options.signal } : {});
      } catch (error) {
        if (await this.stopped()) return finish("cancelled", "stop-requested");
        return finish("error", error instanceof AttestationContractError ? error.code : "exchange-io-error");
      }
    }
  }
}
