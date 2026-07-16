import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
type AjvInstance = { addSchema(schema: object): void; compile(schema: object): Validator };
type AjvConstructor = new (options: object) => AjvInstance;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const readJson = (path: string): object => JSON.parse(readFileSync(resolve(path), "utf8")) as object;
const hateSchema = readJson("vendor/hate/v1/artifact-manifest.schema.json");

function validator(path: string): Validator {
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(hateSchema);
  return ajv.compile(readJson(path));
}

const digest = "sha256:" + "a".repeat(64);
const artifact = {
  artifact_id: "lakda:artifact-oracle",
  kind: "report",
  path: "adaptive/oracle-results.jsonl",
  sha256: digest,
  size_bytes: 10,
  classification: "internal",
  redaction_status: "not_required",
  redaction_rule_version: "lakda-redact-v1",
  safe_for_summary: true,
  public_exposure: "none",
  retention: { class: "default", days: 14 },
  security_checks: { secrets_scan: "pass", pii_scan: "pass" },
};

test("P7 corpus schema binds each case to target revision and config digest", () => {
  const validate = validator("schemas/adaptive-acceptance-corpus-v1.schema.json");
  const corpus = {
    schemaVersion: "lakda/adaptive-acceptance-corpus/v1",
    corpusId: "approved-corpus",
    version: "1.0.0",
    targetRevision: "product-revision",
    cases: [{ caseId: "web-001", acceptanceId: "AC-AE-001", configDigest: digest, expected: { outcome: "passed" } }],
  };
  expect(validate(corpus)).toBe(true);
  expect(validate({ ...corpus, cases: [{ caseId: "web-001", acceptanceId: "AC-AE-001", expected: { outcome: "passed" } }] })).toBe(false);
});

test("P7 case report schema reuses HATE artifact refs and forbids a Lakda QEG verdict", () => {
  const validate = validator("schemas/adaptive-acceptance-case-v1.schema.json");
  const report = {
    schemaVersion: "lakda/adaptive-acceptance-case/v1",
    acceptanceId: "AC-AE-001",
    caseId: "web-001",
    runId: "run-1",
    attempt: 1,
    revision: "product-revision",
    runnerRevision: "abcdef0",
    executionMode: "real",
    environment: { label: "staging", origin: "https://staging.example.test", adapterId: "playwright" },
    runtime: { nodeVersion: "v24.0.0", platform: "win32", arch: "x64" },
    seed: 123,
    configDigest: digest,
    targetManifest: { manifestId: "approved-target", sha256: digest },
    corpus: { corpusId: "approved-corpus", version: "1.0.0", sha256: digest, targetRevision: "product-revision", caseConfigDigest: digest },
    expected: { outcome: "passed" },
    actual: { outcome: "passed", terminationReason: "completed", exitCode: 0 },
    oracleResultRefs: [artifact],
    artifactRefs: [artifact],
    verdict: "passed",
    ineligibilityReason: null,
    qegHandoff: { status: "pending_external", verdictGeneratedByLakda: false },
    generatedAt: "2026-07-15T00:00:00.000Z",
  };
  expect(validate(report)).toBe(true);
  expect(validate({ ...report, qegHandoff: { status: "go", verdictGeneratedByLakda: true } })).toBe(false);
});
