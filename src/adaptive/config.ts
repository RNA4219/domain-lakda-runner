import type { LakdaConfig } from "../core/types.js";
import { assertLoopbackEndpoint } from "../core/safety.js";
import type { AdaptiveConfig, AdaptiveStopCondition } from "./contracts.js";

const strategies = new Set(["random", "weighted-random", "least-visited-transition", "shortest-to-uncovered", "risk-weighted-uncovered", "llm-select"]);

function assertStopCondition(value: AdaptiveStopCondition): void {
  if (value.type === "noveltyPlateau") {
    if (!Number.isInteger(value.windowActions) || value.windowActions < 1 || !Number.isInteger(value.minActions) || value.minActions < 0) throw new Error("adaptive noveltyPlateauは正のwindowActionsと0以上のminActionsが必要です");
    return;
  }
  if (value.type === "durationMs") {
    if (!Number.isInteger(value.atMost) || value.atMost < 1) throw new Error("adaptive durationMsは1以上の整数です");
    return;
  }
  if (!Number.isFinite(value.atLeast) || value.atLeast < 0 || value.atLeast > 1) throw new Error(`adaptive ${value.type}は0〜1のatLeastが必要です`);
}

export function validateAdaptiveConfig(adaptive: AdaptiveConfig | undefined, config: LakdaConfig): asserts adaptive is AdaptiveConfig {
  if (!adaptive) throw new Error("adaptive-exploreにはadaptive設定が必要です");
  if (adaptive.schemaVersion !== "lakda/adaptive-config/v1") throw new Error("adaptive.schemaVersionはlakda/adaptive-config/v1だけを許可します");
  if (!["playwright", "airtest-poco", "security"].includes(adaptive.adapter.id)) throw new Error("adaptive.adapter.idが未対応です");
  if (adaptive.adapter.endpoint) assertLoopbackEndpoint(adaptive.adapter.endpoint);
  if (adaptive.adapter.id !== "playwright") {
    if (!adaptive.adapter.endpoint || !adaptive.adapter.initialTarget) throw new Error("external adaptive adapter requires loopback endpoint and initialTarget");
    if (!adaptive.safety.allowTargetKinds.includes(adaptive.adapter.initialTarget.kind)) throw new Error("external initialTarget.kind must be allowed by adaptive Safety Policy");
  }
  if (adaptive.adapter.initialTarget?.origin) {
    const host = new URL(adaptive.adapter.initialTarget.origin).hostname;
    if (!config.safety.allowHosts.includes(host)) throw new Error("external initialTarget host must be in allowlist");
  }
  if (!strategies.has(adaptive.generator.strategy)) throw new Error("adaptive generator strategyが未対応です");
  const groups = [adaptive.stopWhen.any, adaptive.stopWhen.all].filter((value): value is AdaptiveStopCondition[] => value !== undefined);
  if (groups.length === 0 || groups.some(group => group.length === 0)) throw new Error("adaptive stopWhenには空でないanyまたはallが必要です");
  groups.flat().forEach(assertStopCondition);
  if (!adaptive.settlePolicy.policyVersion || !Number.isInteger(adaptive.settlePolicy.maxWaitMs) || adaptive.settlePolicy.maxWaitMs < 1 || !Number.isInteger(adaptive.settlePolicy.stableWindowMs) || adaptive.settlePolicy.stableWindowMs < 0) throw new Error("adaptive settlePolicyが不正です");
  if (!adaptive.fingerprintPolicy.algorithmVersion || !adaptive.fingerprintPolicy.canonicalizationVersion) throw new Error("adaptive fingerprintPolicyが不正です");
  if (!Number.isInteger(adaptive.recovery.maxBacktracks) || adaptive.recovery.maxBacktracks < 0 || !Number.isInteger(adaptive.recovery.maxAttemptsPerState) || adaptive.recovery.maxAttemptsPerState < 1) throw new Error("adaptive recoveryが不正です");
  if (!adaptive.safety.allowTargetKinds.length || adaptive.safety.allowMutationKinds.includes("delete") || adaptive.safety.allowMutationKinds.includes("purchase") || adaptive.safety.allowMutationKinds.includes("publish") || adaptive.safety.allowMutationKinds.includes("external-message") || adaptive.safety.allowMutationKinds.includes("credential-change")) {
    throw new Error("adaptive Safety Policyはtargetを明示し、破壊的mutationを既定denyにします");
  }
  if (adaptive.adapter.id === "security") {
    const activeMutations = adaptive.safety.allowMutationKinds.filter(kind => kind !== "none");
    if (activeMutations.length) {
      const record = adaptive.securityAuthorization;
      if (!adaptive.securityProfileRef || !record || !record.authorizationId || !record.owner || !record.cleanupRef || !record.killSwitchRef || !record.approvalEvidenceRef || !record.targets.hosts.length || !Number.isInteger(record.maxRatePerMinute) || record.maxRatePerMinute < 1 || !Number.isInteger(record.maxConcurrency) || record.maxConcurrency < 1 || !Array.isArray(record.allowedMutationKinds) || Number.isNaN(new Date(record.validFrom).getTime()) || Number.isNaN(new Date(record.validUntil).getTime())) throw new Error("securityAuthorization and securityProfileRef are required for active security mutations");
      if (new Date(record.validFrom) > new Date(record.validUntil)) throw new Error("securityAuthorization validity window is invalid");
    }
  }
  if (config.seed !== Math.trunc(config.seed)) throw new Error("adaptive seedはtop-level整数だけを使用します");
}
