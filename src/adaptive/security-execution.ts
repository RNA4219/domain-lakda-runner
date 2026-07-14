import type { ExecuteContext } from "../adapters/types.js";
import type { LakdaConfig } from "../core/types.js";
import type { ActionCandidate, EvidenceArtifactRef, ExecutionResult } from "./contracts.js";
import { evaluateSecurityAuthorization } from "./security-policy.js";
import { KillSwitch } from "./safety.js";

export type SecurityExecutionAdapter = {
  execute(candidate: ActionCandidate, context: ExecuteContext): Promise<ExecutionResult>;
  checkKillSwitch(request: { runId: string; killSwitchRef: string }): Promise<{ triggered: boolean; evidenceRefs: EvidenceArtifactRef[] }>;
  cleanup(request: { runId: string; cleanupRef: string; candidateId: string }): Promise<{ completed: boolean; evidenceRefs: EvidenceArtifactRef[] }>;
};
export type SecurityExecution = { result: ExecutionResult; trace: Array<Record<string, unknown>> };

function now(): string { return new Date().toISOString(); }
function raceParticipants(candidate: ActionCandidate): number {
  const value = candidate.contract?.ensures?.raceParticipants;
  return typeof value === "number" && Number.isInteger(value) && value >= 2 ? value : 2;
}
function denied(candidate: ActionCandidate, reason: string): ExecutionResult {
  const timestamp = now();
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", executionId: "denied:" + candidate.candidateId, candidateId: candidate.candidateId,
    preFingerprint: candidate.sourceFingerprint, startedAt: timestamp, endedAt: timestamp, status: "denied", failureSignature: reason,
    recoveryStatus: "not_attempted", targetChanges: [], settleResult: { policyVersion: "settle/v1", status: "aborted", elapsedMs: 0, reasons: [reason] }, evidenceRefs: [],
  };
}

function executionFailure(candidate: ActionCandidate): ExecutionResult {
  const timestamp = now();
  return {
    schemaVersion: "lakda/adaptive-contracts/v1", executionId: "failed:" + candidate.candidateId, candidateId: candidate.candidateId,
    preFingerprint: candidate.sourceFingerprint, startedAt: timestamp, endedAt: timestamp, status: "infrastructure_error", failureSignature: "security_execution_failed",
    recoveryStatus: "not_recovered", targetChanges: [], settleResult: { policyVersion: "settle/v1", status: "aborted", elapsedMs: 0, reasons: ["security_execution_failed"] }, evidenceRefs: [],
  };
}

export class SecurityExecutionController {
  private activeRequests = 0;
  private startedRequests = 0;

  constructor(private readonly config: LakdaConfig, private readonly adapter: SecurityExecutionAdapter, private readonly killSwitch: KillSwitch, private readonly runId: string) {}

  private authorizationDenyReason(candidate: ActionCandidate, requestedParticipants = 1): string | undefined {
    const record = this.config.adaptive?.securityAuthorization;
    const origin = candidate.targetRef.origin ?? this.config.baseUrl;
    if (!origin) return "security_target_missing";
    try {
      const decision = evaluateSecurityAuthorization(record, {
        now: new Date(), target: new URL(origin), environment: record?.environment ?? "staging", mutationKind: candidate.mutationKind,
        activeRequests: this.activeRequests, recentRequests: this.startedRequests,
      });
      if (!decision.allowed) return decision.reason;
      if (candidate.mutationKind === "race" && this.startedRequests + requestedParticipants > record!.maxRatePerMinute) return "security_budget";
      return undefined;
    } catch {
      return "security_target_invalid";
    }
  }

  private async refreshKillSwitch(trace: Array<Record<string, unknown>>): Promise<void> {
    if (this.killSwitch.triggered) return;
    const record = this.config.adaptive?.securityAuthorization;
    if (!record) { this.killSwitch.request("authorization_missing"); return; }
    try {
      const status = await this.adapter.checkKillSwitch({ runId: this.runId, killSwitchRef: record.killSwitchRef });
      trace.push({ type: "security-kill-switch", triggered: status.triggered, evidenceRefs: status.evidenceRefs });
      if (status.triggered) this.killSwitch.request("operator");
    } catch {
      this.killSwitch.request("kill_switch_unavailable");
      trace.push({ type: "security-kill-switch", triggered: true, reason: "kill_switch_unavailable" });
    }
  }

  private async preflight(candidate: ActionCandidate, trace: Array<Record<string, unknown>>, requestedParticipants = 1): Promise<string | undefined> {
    if (candidate.mutationKind === "none") return undefined;
    if (this.killSwitch.triggered) return "kill_switch";
    await this.refreshKillSwitch(trace);
    if (this.killSwitch.triggered) return "kill_switch";
    return this.authorizationDenyReason(candidate, requestedParticipants);
  }

  async denyReason(candidate: ActionCandidate): Promise<string | undefined> {
    const trace: Array<Record<string, unknown>> = [];
    return this.preflight(candidate, trace, candidate.mutationKind === "race" ? raceParticipants(candidate) : 1);
  }

  private async cleanup(candidate: ActionCandidate, trace: Array<Record<string, unknown>>): Promise<{ completed: boolean; evidenceRefs: EvidenceArtifactRef[] }> {
    const record = this.config.adaptive?.securityAuthorization;
    if (!record) return { completed: false, evidenceRefs: [] };
    try {
      const cleanup = await this.adapter.cleanup({ runId: this.runId, cleanupRef: record.cleanupRef, candidateId: candidate.candidateId });
      trace.push({ type: "security-cleanup", candidateId: candidate.candidateId, completed: cleanup.completed, evidenceRefs: cleanup.evidenceRefs });
      if (!cleanup.completed) this.killSwitch.request("cleanup_failed");
      return cleanup;
    } catch {
      this.killSwitch.request("cleanup_failed");
      trace.push({ type: "security-cleanup", candidateId: candidate.candidateId, completed: false, reason: "cleanup_failed" });
      return { completed: false, evidenceRefs: [] };
    }
  }

  private withCleanupFailure(result: ExecutionResult, cleanup: { completed: boolean; evidenceRefs: EvidenceArtifactRef[] }): ExecutionResult {
    const evidenceRefs = [...result.evidenceRefs, ...cleanup.evidenceRefs];
    if (cleanup.completed) return { ...result, evidenceRefs };
    return { ...result, status: "action_failed", failureSignature: "cleanup_failed", recoveryStatus: "not_recovered", evidenceRefs };
  }

  private async executeSequential(candidate: ActionCandidate, context: ExecuteContext, trace: Array<Record<string, unknown>>): Promise<ExecutionResult> {
    this.activeRequests += 1; this.startedRequests += 1;
    let result: ExecutionResult;
    try {
      result = await this.adapter.execute(candidate, context);
    } catch {
      result = executionFailure(candidate);
      trace.push({ type: "security-execution-error", candidateId: candidate.candidateId, reason: "security_execution_failed" });
    } finally {
      this.activeRequests -= 1;
    }
    const cleanup = await this.cleanup(candidate, trace);
    return this.withCleanupFailure(result, cleanup);
  }

  private async executeRace(candidate: ActionCandidate, context: ExecuteContext, trace: Array<Record<string, unknown>>): Promise<ExecutionResult> {
    const record = this.config.adaptive!.securityAuthorization!;
    const count = raceParticipants(candidate); const groupId = "race:" + candidate.candidateId + ":" + this.startedRequests;
    const results: ExecutionResult[] = []; const evidenceRefs: EvidenceArtifactRef[] = []; let next = 0; let skipped = false;
    const worker = async (): Promise<void> => {
      while (next < count) {
        const participantIndex = next++;
        const reason = await this.preflight(candidate, trace);
        if (reason) {
          skipped = true;
          trace.push({ type: "race-participant-skipped", groupId, participantIndex, reason });
          return;
        }
        this.activeRequests += 1; this.startedRequests += 1;
        let result: ExecutionResult;
        try {
          result = await this.adapter.execute(candidate, { ...context, race: { groupId, participantIndex, participantCount: count } });
        } catch {
          result = executionFailure(candidate);
          this.killSwitch.request("race_participant_failure");
        } finally {
          this.activeRequests -= 1;
        }
        results.push(result); evidenceRefs.push(...result.evidenceRefs);
        trace.push({ type: "race-participant", groupId, participantIndex, executionId: result.executionId, status: result.status, startedAt: result.startedAt, endedAt: result.endedAt });
      }
    };
    await Promise.all(Array.from({ length: Math.min(count, record.maxConcurrency) }, () => worker()));
    const cleanup = await this.cleanup(candidate, trace);
    evidenceRefs.push(...cleanup.evidenceRefs);
    const failed = results.find(result => result.status !== "executed");
    const timestamp = now();
    return {
      schemaVersion: "lakda/adaptive-contracts/v1", executionId: groupId, candidateId: candidate.candidateId, preFingerprint: candidate.sourceFingerprint,
      ...(results.at(-1)?.postFingerprint ? { postFingerprint: results.at(-1)?.postFingerprint } : {}),
      startedAt: timestamp, endedAt: timestamp,
      status: cleanup.completed ? (this.killSwitch.triggered || skipped ? "denied" : failed?.status ?? "executed") : "action_failed",
      ...(cleanup.completed ? (this.killSwitch.triggered || skipped ? { failureSignature: "kill_switch" } : failed?.failureSignature ? { failureSignature: failed.failureSignature } : {}) : { failureSignature: "cleanup_failed" }),
      recoveryStatus: cleanup.completed && !failed && !skipped ? "not_required" : "not_recovered", targetChanges: [],
      settleResult: { policyVersion: "settle/v1", status: this.killSwitch.triggered || skipped ? "aborted" : failed ? "timed_out" : "settled", elapsedMs: 0, reasons: this.killSwitch.triggered || skipped ? ["kill_switch"] : failed ? [failed.status] : [] },
      evidenceRefs,
    };
  }

  async execute(candidate: ActionCandidate, context: ExecuteContext): Promise<SecurityExecution> {
    const trace: Array<Record<string, unknown>> = [];
    const reason = await this.preflight(candidate, trace, candidate.mutationKind === "race" ? raceParticipants(candidate) : 1);
    if (reason) return { result: denied(candidate, reason), trace };
    const result = candidate.mutationKind === "race"
      ? await this.executeRace(candidate, context, trace)
      : await this.executeSequential(candidate, context, trace);
    return { result, trace };
  }
}
