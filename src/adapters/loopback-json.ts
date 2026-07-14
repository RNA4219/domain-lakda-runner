import { assertLoopbackEndpoint } from "../core/safety.js";
import type { ActionCandidate, AdapterCapabilities, EvidenceArtifactRef, ExecutionResult, Observation, TargetRef } from "../adaptive/contracts.js";
import type { AdapterFailure, EvidenceRequest, ExecuteContext, ObserveContext, RecoverContext, RecoveryResult } from "./types.js";
import type { ExternalToolBridge, SecurityCleanupRequest, SecurityCleanupResult, SecurityControlRequest, SecurityControlResult } from "./external-bridges.js";

type Operation = "observe" | "generate-candidates" | "execute" | "recover" | "capture-evidence" | "security-control" | "cleanup";
export class LoopbackJsonBridge implements ExternalToolBridge {
  private constructor(private readonly endpoint: URL, private readonly capabilityValue: AdapterCapabilities) {}

  static async connect(endpoint: string, adapterId: string): Promise<LoopbackJsonBridge> {
    const url = assertLoopbackEndpoint(endpoint);
    const base = new URL(url.href.endsWith("/") ? url.href : `${url.href}/`);
    const response = await fetch(new URL("capabilities", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapterId }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`operator bridge capability handshake failed: HTTP ${response.status}`);
    const capabilities = await response.json() as AdapterCapabilities;
    if (capabilities.adapterId !== adapterId) throw new Error("operator bridge adapterId mismatch");
    return new LoopbackJsonBridge(base, capabilities);
  }

  capabilities(): AdapterCapabilities { return this.capabilityValue; }

  private async call<T>(operation: Operation, payload: unknown): Promise<T> {
    const response = await fetch(new URL(operation, this.endpoint), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`operator bridge ${operation} failed: HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  observe(target: TargetRef, context: ObserveContext): Promise<Observation> { return this.call("observe", { target, context }); }
  generateCandidates(observation: Observation): Promise<ActionCandidate[]> { return this.call("generate-candidates", { observation }); }
  execute(candidate: ActionCandidate, context: ExecuteContext): Promise<ExecutionResult> { return this.call("execute", { candidate, context }); }
  recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult> { return this.call("recover", { failure, context }); }
  captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]> { return this.call("capture-evidence", { request }); }
  checkKillSwitch(request: SecurityControlRequest): Promise<SecurityControlResult> { return this.call("security-control", { request }); }
  cleanup(request: SecurityCleanupRequest): Promise<SecurityCleanupResult> { return this.call("cleanup", { request }); }
}
