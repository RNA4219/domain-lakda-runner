import { assertLoopbackEndpoint } from "../core/safety.js";
import { assertAdaptiveContract, type ActionCandidate, type AdapterCapabilities, type EvidenceArtifactRef, type ExecutionResult, type Observation, type TargetRef } from "../adaptive/contracts.js";
import { securityBindingDigest } from "../adaptive/security-policy.js";
import type { AdapterFailure, EvidenceRequest, ExecuteContext, ObserveContext, RecoverContext, RecoveryResult } from "./types.js";
import type { ExternalToolBridge, SecurityCleanupRequest, SecurityCleanupResult, SecurityControlRequest, SecurityControlResult } from "./external-bridges.js";

type Operation = "observe" | "generate-candidates" | "execute" | "recover" | "capture-evidence" | "security-control" | "cleanup";
const MAX_JSON_BYTES = 1_048_576;

async function boundedJson<T>(response: Response, operation: string): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) throw new Error(`operator bridge ${operation} returned a non-JSON response`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error(`operator bridge ${operation} response exceeds size limit`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error(`operator bridge ${operation} response exceeds size limit`);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T; }
  catch { throw new Error(`operator bridge ${operation} returned invalid JSON`); }
}
export class LoopbackJsonBridge implements ExternalToolBridge {
  private constructor(private readonly endpoint: URL, private readonly capabilityValue: AdapterCapabilities) {}

  static async connect(endpoint: string, adapterId: string): Promise<LoopbackJsonBridge> {
    const url = assertLoopbackEndpoint(endpoint);
    const base = new URL(url.href.endsWith("/") ? url.href : `${url.href}/`);
    const response = await fetch(new URL("capabilities", base), {
      method: "POST",
      redirect: "error",
      headers: { "accept": "application/json", "content-type": "application/json" },
      body: JSON.stringify({ adapterId }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`operator bridge capability handshake failed: HTTP ${response.status}`);
    const capabilities = await boundedJson<AdapterCapabilities>(response, "capability handshake");
    assertAdaptiveContract(capabilities);
    if (capabilities.adapterId !== adapterId) throw new Error("operator bridge adapterId mismatch");
    return new LoopbackJsonBridge(base, capabilities);
  }

  capabilities(): AdapterCapabilities { return this.capabilityValue; }
  binding(): { capabilityDigest: string; bridgeDigest: string } {
    return {
      capabilityDigest: securityBindingDigest(this.capabilityValue),
      bridgeDigest: securityBindingDigest({ transport: "loopback-json/v1", endpoint: this.endpoint.href }),
    };
  }

  private async call<T>(operation: Operation, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body, "utf8") > MAX_JSON_BYTES) throw new Error(`operator bridge ${operation} request exceeds size limit`);
    const response = await fetch(new URL(operation, this.endpoint), {
      method: "POST",
      redirect: "error",
      headers: { "accept": "application/json", "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`operator bridge ${operation} failed: HTTP ${response.status}`);
    return boundedJson<T>(response, operation);
  }

  observe(target: TargetRef, context: ObserveContext): Promise<Observation> { return this.call("observe", { target, context }); }
  generateCandidates(observation: Observation): Promise<ActionCandidate[]> { return this.call("generate-candidates", { observation }); }
  execute(candidate: ActionCandidate, context: ExecuteContext): Promise<ExecutionResult> { return this.call("execute", { candidate, context }); }
  recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult> { return this.call("recover", { failure, context }); }
  captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]> { return this.call("capture-evidence", { request }); }
  checkKillSwitch(request: SecurityControlRequest): Promise<SecurityControlResult> { return this.call("security-control", { request }); }
  cleanup(request: SecurityCleanupRequest): Promise<SecurityCleanupResult> { return this.call("cleanup", { request }); }
}
