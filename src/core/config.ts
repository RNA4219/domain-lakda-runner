import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Action, LakdaConfig, RunMode } from "./types.js";
import { assertLoopbackEndpoint } from "./safety.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configSchema = JSON.parse(readFileSync(resolve(root, "schemas", "lakda-config-v1.schema.json"), "utf8")) as object;
type Validator = ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> };
type AjvConstructor = new (options: object) => { compile(value: object): Validator };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const validateConfigSchema = new Ajv({ allErrors: true, strict: false }).compile(configSchema);

const defaultConfig: LakdaConfig = {
  schemaVersion: "lakda/v1",
  mode: "smoke",
  browser: "chromium",
  seed: 4219,
  persona: "guest",
  durationMs: 600_000,
  maxActions: 100,
  workers: 1,
  outputDir: ".lakda/runs",
  headed: false,
  actionCatalog: [{ id: "navigate-root", kind: "navigate", path: "/", accessibleName: "root" }],
  candidates: [{ id: "navigate-root", kind: "navigate", path: "/", accessibleName: "root" }],
  inputProfiles: {},
  profiles: { smoke: { actionIds: ["navigate-root"] }, seededRandom: {} },
  classifier: { majorRequestUrlPatterns: [], consoleErrorAllowPatterns: [] },
  personas: { guest: {} },
  obligations: [],
  safety: {
    allowHosts: ["127.0.0.1", "localhost"],
    denyActionKinds: ["delete", "deactivate", "billing", "transfer"],
    maxActionsPerMinute: 60,
    requireFixtureResetForMutations: true,
    fixtureResetConfigured: false,
  },
  llm: {
    enabled: false,
    baseUrl: "http://127.0.0.1:8080/v1",
    expectedModelId: "Qwen3.5-4B-Q4_K_M.gguf",
    runtimeEvidence: { runtimeVersion: "not-provided", runtimeBuild: "not-provided", chatTemplateHash: "not-provided" },
    seed: 4219,
    temperature: 0,
    topP: 1,
    maxTokens: 512,
    connectTimeoutMs: 5_000,
    requestTimeoutMs: 60_000,
    maxRetries: 2,
  },
  artifacts: {
    classification: "internal",
    trace: "retain-on-non-pass",
    screenshot: "retain-on-non-pass",
    video: false,
    har: false,
    domSnapshots: false,
    maxRunBytes: 1_073_741_824,
  },
};

type PartialConfig = Omit<Partial<LakdaConfig>, "safety" | "llm" | "artifacts" | "profiles" | "classifier"> & {
  safety?: Partial<LakdaConfig["safety"]>;
  llm?: Partial<LakdaConfig["llm"]>;
  artifacts?: Partial<LakdaConfig["artifacts"]>;
  profiles?: Partial<LakdaConfig["profiles"]>;
  classifier?: Partial<LakdaConfig["classifier"]>;
};

function mergeConfig(input: PartialConfig): LakdaConfig {
  const actionCatalog = input.actionCatalog ?? input.candidates ?? defaultConfig.actionCatalog;
  const inferredSmokeActionIds = (input.actionCatalog || input.candidates) ? actionCatalog.slice(0, 1).map(action => action.id) : defaultConfig.profiles.smoke.actionIds;
  const resolvedSeed = input.seed ?? defaultConfig.seed;
  const requestedLlmSeed = input.llm?.seed;
  if (requestedLlmSeed !== undefined && requestedLlmSeed !== resolvedSeed) throw new Error("llm.seed はtop-level seedと一致させてください");
  const resolvedFixtureReset = input.fixtureReset ?? defaultConfig.fixtureReset;
  const fixtureResetConfigured = input.safety?.fixtureResetConfigured ?? Boolean(resolvedFixtureReset);
  return {
    ...defaultConfig,
    ...input,
    seed: resolvedSeed,
    actionCatalog,
    candidates: actionCatalog,
    inputProfiles: { ...defaultConfig.inputProfiles, ...input.inputProfiles },
    profiles: {
      ...defaultConfig.profiles,
      ...input.profiles,
      smoke: { ...defaultConfig.profiles.smoke, ...input.profiles?.smoke, actionIds: input.profiles?.smoke?.actionIds ?? inferredSmokeActionIds },
      seededRandom: { ...defaultConfig.profiles.seededRandom, ...input.profiles?.seededRandom },
    },
    classifier: { ...defaultConfig.classifier, ...input.classifier },
    personas: { ...defaultConfig.personas, ...input.personas },
    obligations: input.obligations ?? defaultConfig.obligations,
    fixtureReset: resolvedFixtureReset,
    safety: { ...defaultConfig.safety, ...input.safety, fixtureResetConfigured },
    llm: { ...defaultConfig.llm, ...input.llm, seed: resolvedSeed, runtimeEvidence: { ...defaultConfig.llm.runtimeEvidence, ...input.llm?.runtimeEvidence } },
    artifacts: { ...defaultConfig.artifacts, ...input.artifacts },
  } as LakdaConfig;
}

export function loadConfig(path = resolve(process.cwd(), "lakda.config.json"), overrides: PartialConfig = {}): LakdaConfig {
  let input: PartialConfig = {};
  if (existsSync(path)) {
    try { input = JSON.parse(readFileSync(path, "utf8")) as PartialConfig; }
    catch { throw new Error(`設定JSONを解析できません: ${path}`); }
  }
  if (!validateConfigSchema(input)) throw new Error(`設定schemaに適合しません: ${validateConfigSchema.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
  const config = mergeConfig({ ...input, ...overrides, safety: { ...input.safety, ...overrides.safety }, llm: { ...input.llm, ...overrides.llm }, artifacts: { ...input.artifacts, ...overrides.artifacts } });
  validateConfig(config);
  return config;
}

export function validateConfig(config: LakdaConfig): void {
  if (config.schemaVersion !== "lakda/v1") throw new Error("schemaVersion は lakda/v1 だけを許可します");
  if (config.browser !== "chromium") throw new Error("v1 は chromium だけを許可します");
  if (!Number.isInteger(config.seed)) throw new Error("seed は整数で指定してください");
  if (!Number.isInteger(config.workers) || !Number.isFinite(config.workers) || config.workers < 1 || config.workers > 4) throw new Error("workers は1〜4の整数です");
  if (config.maxActions < 1 || config.durationMs < 1) throw new Error("maxActions と durationMs は1以上です");
  if (config.llm.maxRetries < 0 || config.llm.maxRetries > 2) throw new Error("llm.maxRetries は0〜2です");
  if (config.llm.seed !== config.seed) throw new Error("llm.seed はtop-level seedと一致させてください");
  if (config.safety.fixtureResetConfigured !== Boolean(config.fixtureReset)) throw new Error("fixtureResetConfigured はfixtureResetから導出される値と一致させてください");
  if (config.llm.temperature !== 0 || config.llm.topP !== 1 || config.llm.maxTokens !== 512) throw new Error("v1 のLLM sampling値は temperature=0, topP=1, maxTokens=512 です");
  if (config.llm.connectTimeoutMs !== 5_000 || config.llm.requestTimeoutMs !== 60_000) throw new Error("v1 のLLM timeoutは5秒/60秒です");
  assertLoopbackEndpoint(config.llm.baseUrl);

  if (config.baseUrl) {
    const host = new URL(config.baseUrl).hostname;
    if (!config.safety.allowHosts.includes(host)) throw new Error(`baseUrl host はallowlistに必要です: ${host}`);
  }
  const persona = config.personas[config.persona];
  if (!persona) throw new Error(`persona設定がありません: ${config.persona}`);
  if (config.persona !== "guest" && (!persona.validationPath || !persona.loginUrlPattern || !persona.requiredLocator)) {
    throw new Error("non-guest persona には validationPath、loginUrlPattern、requiredLocator が必要です");
  }
  if (config.fixtureReset) {
    const resetUrl = new URL(config.fixtureReset.url, config.baseUrl);
    if (resetUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(resetUrl.hostname)) throw new Error("fixtureReset はloopback HTTP URLだけを許可します");
  }
  const actionIds = new Set(config.actionCatalog.map(action => action.id));
  if (config.profiles.smoke.actionIds.length === 0 || config.profiles.smoke.actionIds.some(id => !actionIds.has(id))) throw new Error("profiles.smoke.actionIds はactionCatalogのIDだけを指定してください");
  if (config.profiles.seededRandom.candidateIds?.some(id => !actionIds.has(id))) throw new Error("profiles.seededRandom.candidateIds はactionCatalogのIDだけを指定してください");
  if (config.profiles.seededRandom.count !== undefined && (!Number.isInteger(config.profiles.seededRandom.count) || config.profiles.seededRandom.count < 1)) throw new Error("profiles.seededRandom.count は1以上の整数です");
  for (const pattern of [...config.classifier.majorRequestUrlPatterns, ...config.classifier.consoleErrorAllowPatterns]) { try { new RegExp(pattern); } catch { throw new Error(`classifier patternが不正です: ${pattern}`); } }
  if (config.actionCatalog.some(action => action.mutates) && config.safety.requireFixtureResetForMutations && !config.fixtureReset) {
    throw new Error("変更操作にはfixtureResetが必要です");
  }
  if (config.mode === "llm-explore") {
    if (!config.llm.enabled) throw new Error("llm-explore には llm.enabled=true が必要です");
    if (!config.llm.modelPath || !config.llm.modelSha256) throw new Error("llm-explore には modelPath と modelSha256 が必要です");
  }
}

export function parseMode(value: string | undefined): RunMode {
  if (value === "smoke" || value === "seeded-random" || value === "regression-replay" || value === "llm-explore") return value;
  throw new Error("mode は smoke, seeded-random, regression-replay, llm-explore のいずれかです");
}

export function normalizedAction(action: Action): Action {
  return { ...action, id: action.id.trim(), path: action.path ? (action.path.startsWith("/") ? action.path : `/${action.path}`) : undefined };
}
