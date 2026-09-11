import { AttestationContractError, createAttestationRequest } from "./attestation-contracts.js";
import { verifyAttestationTrustUnchanged } from "./attestation-evidence.js";
import { createAttestationExchange, type AttestationRetention, type AttestationExchangeOptions } from "./attestation-exchange.js";
import { inventoryAttestationSources } from "./attestation-inventory.js";
import type { PreparedBinaryAttestationRun } from "./attestation-preflight.js";

export type BinaryAttestationRunSummary = { requested: number; adopted: number; results: Array<{
  requestId: string; sourcePath: string; receiptStatus: AttestationRetention["receipt"]["status"];
  adoption: AttestationRetention["adoption"]; reason: string | null; artifactPath?: string;
}> };
const attempted = new WeakSet<PreparedBinaryAttestationRun>();

export async function completeBinaryAttestationRun(prepared: PreparedBinaryAttestationRun, maxBytes: number, shouldStop: () => Promise<boolean>, timing: Pick<AttestationExchangeOptions, "clock" | "monotonic"> = {}): Promise<BinaryAttestationRunSummary> {
  if (attempted.has(prepared)) throw new AttestationContractError("run-already-attempted");
  attempted.add(prepared);
  try {
    const clock = timing.clock ?? Date.now, monotonic = timing.monotonic ?? (() => performance.now());
    const now = clock(), startedMonotonic = monotonic(), monotonicDeadline = startedMonotonic + prepared.options.timeoutMs;
    if (!Number.isSafeInteger(now) || !Number.isFinite(startedMonotonic) || !Number.isFinite(monotonicDeadline)) throw new AttestationContractError("time-invalid");
    const check = async () => {
      if (await shouldStop()) throw new AttestationContractError("request-cancelled");
      const current = clock(), elapsed = monotonic();
      if (!Number.isSafeInteger(current) || current < now || !Number.isFinite(elapsed) || elapsed < startedMonotonic) throw new AttestationContractError("time-invalid");
      if (current >= now + prepared.options.timeoutMs || elapsed >= monotonicDeadline) throw new AttestationContractError("request-expired");
    };
    await prepared.io.assertOpen(); await check(); await verifyAttestationTrustUnchanged(prepared.trust);
    const sources = await inventoryAttestationSources(prepared.io.runDirectory, maxBytes, check);
    if (!sources.length) return { requested: 0, adopted: 0, results: [] };
    const requests = sources.map(source => createAttestationRequest({ ...prepared.binding, sourcePath: source.path, sourceSize: source.size,
      sourceSha256: source.sha256, mediaType: source.mediaType }, { now, timeoutMs: prepared.options.timeoutMs }));
    const exchange = await createAttestationExchange({ stagingRoot: prepared.options.stagingRoot, runDirectory: prepared.io.runDirectory,
      request: requests[0], context: prepared.context, shouldStop, clock, monotonic, monotonicDeadline }, prepared.io);
    for (const request of requests) await exchange.stage(request, maxBytes);
    // Each request has a distinct claim and media path; all settle before any run finalization.
    const settled = await Promise.allSettled(requests.map(request => exchange.retain(request.requestId, maxBytes)));
    if (settled.some(result => result.status === "rejected")) throw new AttestationContractError("exchange-incomplete");
    const results = settled.map((result, index) => {
      if (result.status !== "fulfilled") throw new AttestationContractError("exchange-incomplete");
      const value = result.value;
      return { requestId: requests[index].requestId, sourcePath: requests[index].sourcePath, receiptStatus: value.receipt.status,
        adoption: value.adoption, reason: value.adoption === "failed" ? value.reason : value.receipt.reason,
        ...(value.adoption === "adopted" ? { artifactPath: value.artifact.path } : {}) };
    });
    await verifyAttestationTrustUnchanged(prepared.trust);
    await exchange.exportRetained(maxBytes);
    return { requested: requests.length, adopted: results.filter(result => result.adoption === "adopted").length, results };
  } catch (error) { throw error instanceof AttestationContractError ? error : new AttestationContractError("run-handoff-failed"); }
}
