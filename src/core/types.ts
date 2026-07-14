import type { AdaptiveConfig } from "../adaptive/contracts.js";

export type RunMode = "smoke" | "seeded-random" | "regression-replay" | "llm-explore" | "adaptive-explore";
export type RunOutcome = "passed" | "failed" | "partial" | "error";
export type ArtifactExpectations = { trace: boolean; screenshot: boolean; video: boolean; har: boolean; domSnapshots: number };
export type LlmStatus = "not_requested" | "available" | "unavailable" | "mismatch";
export type TerminationReason =
  | "completed"
  | "machine_failure"
  | "hold"
  | "obligations_unmet"
  | "duration_limit"
  | "max_actions"
  | "rate_limit"
  | "artifact_limit"
  | "artifact_failure"
  | "executor_error"
  | "llm_error";

export type RunOptions = {
  baseUrl: string;
  mode: RunMode;
  browser: "chromium";
  seed: number;
  persona: string;
  durationMs: number;
  maxActions: number;
  workers: number;
  outputDir: string;
};
export type FailureSeverity = "warning" | "failure";

export type Failure = {
  failureId: string;
  ruleId: "UI-001" | "UI-002" | "UI-003" | "UI-004" | "UI-005" | "UI-006" | "UI-007" | "UI-008";
  severity: FailureSeverity;
  message: string;
};

export type ActionKind = "navigate" | "goto" | "click" | "fill" | "check" | "select" | "press";
export type Locator = {
  testId?: string;
  role?: "button" | "link" | "textbox" | "checkbox" | "combobox" | "option" | "menuitem" | "tab";
  name?: string;
};
export type Action = {
  id: string;
  kind: ActionKind;
  path?: string;
  locator?: Locator;
  /** @deprecated CSS/XPath is rejected at the safety boundary. */
  selector?: string;
  /** @deprecated values must be resolved from inputProfiles. */
  value?: string;
  accessibleName?: string;
  inputProfileId?: string;
  key?: "Enter" | "Escape" | "Space" | "Tab";
  mutates?: boolean;
};

export type ActionPlan = {
  schemaVersion: "lakda/action-plan/v1";
  mode: "smoke" | "seeded-random" | "regression-replay" | "llm-explore";
  seed: number;
  baseUrl: string;
  actions: Action[];
};

export type LlmConfig = {
  enabled: boolean;
  baseUrl: string;
  expectedModelId: string;
  modelSha256?: string;
  modelPath?: string;
  runtimeEvidence: { runtimeVersion: string; runtimeBuild: string; chatTemplateHash: string };
  seed: number;
  temperature: number;
  topP: number;
  maxTokens: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  maxRetries: number;
};

export type LakdaConfig = {
  schemaVersion: "lakda/v1";
  baseUrl?: string;
  mode: RunMode;
  browser: "chromium";
  seed: number;
  persona: string;
  durationMs: number;
  maxActions: number;
  workers: number;
  outputDir: string;
  headed: boolean;
  adaptive?: AdaptiveConfig;
  /** v1 source of truth for executable actions. */
  actionCatalog: Action[];
  /** Backward-compatible input alias; normalized into actionCatalog. */
  candidates: Action[];
  inputProfiles: Record<string, string>;
  profiles: {
    smoke: { actionIds: string[] };
    seededRandom: { candidateIds?: string[]; count?: number };
  };
  classifier: {
    majorRequestUrlPatterns: string[];
    consoleErrorAllowPatterns: string[];
  };
  personas: Record<string, {
    storageStatePath?: string;
    validationPath?: string;
    loginUrlPattern?: string;
    requiredLocator?: Locator;
  }>;
  obligations: Array<{ expectedUrl?: string; visible?: Locator }>;
  fixtureReset?: { url: string };
  safety: {
    allowHosts: string[];
    denyActionKinds: string[];
    maxActionsPerMinute: number;
    requireFixtureResetForMutations: boolean;
    fixtureResetConfigured: boolean;
  };
  llm: LlmConfig;
  artifacts: {
    classification: "public" | "internal" | "confidential" | "restricted";
    trace: "retain-on-non-pass";
    screenshot: "retain-on-non-pass";
    video: boolean;
    har: boolean;
    domSnapshots: boolean;
    maxRunBytes: number;
  };
};

export type RunResult = {
  runId: string;
  attempt: number;
  outcome: RunOutcome;
  exitCode: 0 | 1 | 2;
  terminationReason: TerminationReason;
  workerIndex: number;
  batchId?: string;
  artifactManifestPath?: string;
  actionSequencePath?: string;
  failures: Failure[];
  llmStatus: LlmStatus;
};

export type WorkerRunEntry =
  | { workerIndex: number; seed: number; status: "completed"; result: RunResult }
  | { workerIndex: number; seed: number; status: "error"; error: { name: string; message: string } };

export type RunBatchResult = {
  schemaVersion: "lakda/run-batch/v1";
  batchId: string;
  outcome: RunOutcome;
  exitCode: 0 | 1 | 2;
  requestedWorkers: number;
  completedWorkers: number;
  workerResults: WorkerRunEntry[];
};

export type LlmDecision =
  | { decision: "action"; candidateId: string; inputProfileId?: string; reason: string; confidence: "low" | "medium" | "high" }
  | { decision: "stop" | "hold"; reason: string; confidence: "low" | "medium" | "high" };

export type LlmEvidence = {
  endpoint: string;
  modelId?: string;
  providerModelId?: string;
  modelSha256?: string;
  runtime: LlmConfig["runtimeEvidence"];
  promptHash: string;
  schemaHash: string;
  seed: number;
  temperature: number;
  topP: number;
  maxTokens: number;
  attempt: number;
  retryReason?: string;
  httpStatus?: number;
  requestTokens?: number;
  responseTokens?: number;
  ttftMs?: number;
  totalLatencyMs: number;
  rawResponseSha256?: string;
  redactedRequestSha256: string;
  redactedResponseSha256?: string;
  validation: "accepted" | "rejected";
  rejectionReason?: string;
  decision?: LlmDecision;
};