import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertCombinationFactorModel } from "../src/adaptive/combinations.js";
import { loadConfig } from "../src/core/config.js";
import { validateActionPlan } from "../src/core/plan.js";

type Validator = ((value: unknown) => boolean) & { errors?: unknown[] };
type AjvConstructor = new (options: object) => { compile(schema: object): Validator };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const root = resolve(import.meta.dirname, "..");

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function validate(schemaPath: string, value: unknown): Promise<void> {
  const schema = await json(schemaPath) as object;
  const validator = new Ajv({ allErrors: true, strict: false }).compile(schema);
  expect(validator(value), JSON.stringify(validator.errors)).toBe(true);
}

function visit(value: unknown, path = "$"): void {
  if (typeof value === "string") {
    expect(value, path).not.toMatch(/(?:password|passwd|api[-_]?key|access[-_]?token|refresh[-_]?token|credential|storageState)/i);
    expect(value, path).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (/^https?:\/\//.test(value)) {
      const host = new URL(value).hostname;
      expect(host === "localhost" || host === "127.0.0.1" || host.endsWith(".invalid"), path).toBe(true);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, path + "[" + index + "]"));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      expect(key, path).not.toMatch(/(?:password|passwd|api[-_]?key|access[-_]?token|refresh[-_]?token|credential|storageState)/i);
      visit(entry, path + "." + key);
    }
  }
}

test("sanitized examples satisfy their public contracts without real target data", async () => {
  const configPath = resolve(root, "examples/playwright-safe.config.json");
  const configValue = await json("examples/playwright-safe.config.json");
  const model = await json("examples/combination-factor-model.json");
  const replay = await json("examples/replay-action-sequence.json");
  const target = await json("examples/pending-target-manifest.json") as {
    status: string;
    access: { approved: boolean; authSource: string };
    environment: { baseUrlOrigin: string | null };
  };
  await validate("schemas/lakda-config-v1.schema.json", configValue);
  await validate("schemas/lakda-combination-factor-model-v1.schema.json", model);
  await validate("schemas/lakda-target-manifest-v1.schema.json", target);
  assertCombinationFactorModel(model);
  const config = loadConfig(configPath);
  expect(() => validateActionPlan(replay, config)).not.toThrow();
  expect(target.status).toBe("pending_external");
  expect(target.access).toEqual({ approved: false, authSource: "pending_external", approvalEvidenceRef: "pending_external" });
  expect(target.environment.baseUrlOrigin).toBeNull();
  [configValue, model, replay, target].forEach(value => visit(value));
});

test("run catalog public schemas compile under draft 2020-12", async () => {
  for (const path of [
    "schemas/lakda-run-index-v1.schema.json",
    "schemas/lakda-run-detail-v1.schema.json",
    "schemas/lakda-run-comparison-v1.schema.json",
  ]) {
    const schema = await json(path) as object;
    expect(() => new Ajv({ allErrors: true, strict: false }).compile(schema), path).not.toThrow();
  }
});
