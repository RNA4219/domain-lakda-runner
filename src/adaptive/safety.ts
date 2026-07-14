import type { LakdaConfig } from "../core/types.js";
import type { ActionCandidate, MutationKind, TargetKind } from "./contracts.js";

export type AdaptiveSafetyDecision = { allowed: true } | { allowed: false; reason: string };
export type AdaptiveSafetyContext = { actionCount: number; artifactBytes: number; killSwitch?: KillSwitch };

export class KillSwitch {
  private reasonValue: string | undefined;
  request(reason: string): void { this.reasonValue ??= reason; }
  get triggered(): boolean { return this.reasonValue !== undefined; }
  get reason(): string | undefined { return this.reasonValue; }
}

const destructive = new Set<MutationKind>(["delete", "purchase", "publish", "external-message", "credential-change"]);

export function evaluateAdaptiveSafety(candidate: ActionCandidate, config: LakdaConfig, context: AdaptiveSafetyContext): AdaptiveSafetyDecision {
  const adaptive = config.adaptive;
  if (!adaptive) return { allowed: false, reason: "adaptive_config_missing" };
  if (context.killSwitch?.triggered) return { allowed: false, reason: "kill_switch" };
  if (context.actionCount >= config.maxActions) return { allowed: false, reason: "max_actions" };
  if (context.artifactBytes >= config.artifacts.maxRunBytes) return { allowed: false, reason: "artifact_budget" };
  if (!adaptive.safety.allowTargetKinds.includes(candidate.targetRef.kind as TargetKind)) return { allowed: false, reason: "target_kind_denied" };
  if (adaptive.safety.denyActionIds.includes(candidate.candidateId) || config.safety.denyActionKinds.some(value => candidate.actionKind.toLowerCase().includes(value.toLowerCase()))) return { allowed: false, reason: "deny_action" };
  if (destructive.has(candidate.mutationKind) || !adaptive.safety.allowMutationKinds.includes(candidate.mutationKind)) return { allowed: false, reason: "mutation_denied" };
  if (candidate.mutationKind !== "none" && config.safety.requireFixtureResetForMutations && !config.fixtureReset) return { allowed: false, reason: "fixture_reset_required" };
  if (candidate.targetRef.origin) {
    const host = new URL(candidate.targetRef.origin).hostname;
    if (!config.safety.allowHosts.includes(host)) return { allowed: false, reason: "host_denied" };
  }
  return { allowed: true };
}
