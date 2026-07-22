import type { LakdaConfig } from "../core/types.js";
import { assertLoopbackEndpoint } from "../core/safety.js";
import { assertBuiltInAdapterConfiguration } from "../adapters/registry.js";
import type { AdaptiveConfig, AdaptiveStopCondition } from "./contracts.js";
import { assertBuiltInGenerator } from "./generators.js";



function assertOnlyKeys(value: object, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw new Error(`${label} contains unsupported extension fields: ${extra.join(",")}`);
}

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
  assertOnlyKeys(adaptive.adapter, ["id", "endpoint", "initialTarget"], "adaptive.adapter");
  assertOnlyKeys(adaptive.generator, ["strategy", "version"], "adaptive.generator");
  assertBuiltInAdapterConfiguration(adaptive.adapter.id, adaptive.safety.allowTargetKinds, adaptive.adapter.initialTarget?.kind);
  if (adaptive.adapter.id === "playwright" && (adaptive.adapter.endpoint || adaptive.adapter.initialTarget)) throw new Error("playwright adapter does not accept an external runtime endpoint or initialTarget");
  if (adaptive.adapter.endpoint) assertLoopbackEndpoint(adaptive.adapter.endpoint);
  if (adaptive.adapter.id !== "playwright") {
    if (!adaptive.adapter.endpoint || !adaptive.adapter.initialTarget) throw new Error("external adaptive adapter requires loopback endpoint and initialTarget");
    if (!adaptive.safety.allowTargetKinds.includes(adaptive.adapter.initialTarget.kind)) throw new Error("external initialTarget.kind must be allowed by adaptive Safety Policy");
  }
  if (adaptive.adapter.initialTarget?.origin) {
    const host = new URL(adaptive.adapter.initialTarget.origin).hostname;
    if (!config.safety.allowHosts.includes(host)) throw new Error("external initialTarget host must be in allowlist");
  }
  assertBuiltInGenerator(adaptive.generator.strategy, adaptive.generator.version);
  if (adaptive.generator.strategy === "llm-select" && (!config.llm.enabled || !config.llm.modelPath || !config.llm.modelSha256)) throw new Error("adaptive llm-select requires llm.enabled=true, modelPath, and modelSha256");
  const actionIds = new Set<string>();
  for (const contract of adaptive.actionContracts ?? []) {
    if (!contract.actionId.trim() || actionIds.has(contract.actionId)) throw new Error("adaptive actionContractsには一意なactionIdが必要です");
    actionIds.add(contract.actionId);
  }
  const groups = [adaptive.stopWhen.any, adaptive.stopWhen.all].filter((value): value is AdaptiveStopCondition[] => value !== undefined);
  if (groups.length === 0 || groups.some(group => group.length === 0)) throw new Error("adaptive stopWhenには空でないanyまたはallが必要です");
  groups.flat().forEach(assertStopCondition);
  if (!adaptive.settlePolicy.policyVersion || !Number.isInteger(adaptive.settlePolicy.maxWaitMs) || adaptive.settlePolicy.maxWaitMs < 1 || !Number.isInteger(adaptive.settlePolicy.stableWindowMs) || adaptive.settlePolicy.stableWindowMs < 0) throw new Error("adaptive settlePolicyが不正です");
  if (adaptive.settlePolicy.readiness && !adaptive.settlePolicy.readiness.testId && !adaptive.settlePolicy.readiness.role) throw new Error("adaptive settlePolicy readinessにはtestIdまたはroleが必要です");
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
