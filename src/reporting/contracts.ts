import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertAttestationResponse } from "../exploration/attestation-contracts.js";

export const REPORT_LIMITS = {
  sources: 100, runs: 100, actionsAndEvents: 10_000, failuresAndFindings: 1_000,
  textBytes: 32 * 1024 * 1024, artifactBytes: 2 * 1024 * 1024 * 1024,
  viewBytes: 16 * 1024 * 1024, mediaBytes: 256 * 1024 * 1024, bundleBytes: 1024 * 1024 * 1024,
} as const;
export type ReportProfile = "local" | "share";
export type ReportLanguage = "ja" | "en";
export type ReportConfig = {
  schemaVersion: "lakda/report-config/v1";
  auto: "html" | "off";
  outputRoot: string;
  profile: ReportProfile;
  language?: ReportLanguage;
  timeoutMs: number;
  trustStorePath?: string;
};
export class ReportInputError extends Error {
  readonly exitCode = 2;
  constructor(readonly issueCode: string, message: string) { super(message); }
}
type Validator = (input: unknown) => boolean;
type AjvConstructor = new (options: object) => { addSchema(schema: object): void; getSchema(id: string): Validator | undefined };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const ajv = new Ajv({ allErrors: true, strict: false, formats: { "date-time": true } });
const schemaRoot = resolve(import.meta.dirname, "../../schemas");
for (const name of readdirSync(schemaRoot).filter(name => /^lakda-(?:report-.+|action-execution|binary-artifact-attestation)-v1\.schema\.json$/.test(name))) {
  ajv.addSchema(JSON.parse(readFileSync(resolve(schemaRoot, name), "utf8")) as object);
}
export type ReportSchemaKind = "config" | "sources" | "batch-sources" | "view" | "receipt" | "bundle-manifest";
export function assertReportSchema(kind: ReportSchemaKind, value: unknown): void {
  const validate = ajv.getSchema("https://local.invalid/lakda/report-" + kind + "/v1");
  if (!validate) throw new Error("report schema is unavailable: " + kind);
  if (!validate(value)) throw new ReportInputError("invalid-" + kind, "レポート" + (kind === "config" ? "設定" : "入力") + "がschemaに適合しません");
}

export function assertReportConfig(value: unknown): asserts value is Partial<ReportConfig> & Pick<ReportConfig, "schemaVersion"> {
  assertReportSchema("config", value);
}

export function assertActionExecutionSchema(value: unknown): void {
  const validate = ajv.getSchema("https://local.invalid/lakda/action-execution/v1");
  if (!validate) throw new Error("action execution schema is unavailable");
  if (!validate(value)) throw new ReportInputError("invalid-execution-history", "操作の実行記録がschemaに適合しません");
}

export function assertBinaryAttestationSchema(value: unknown): void {
  if (value && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === "lakda/binary-artifact-attestation/v2") {
    try { assertAttestationResponse(value); return; }
    catch { throw new ReportInputError("invalid-media-proof", "媒体の検査記録がschemaに適合しません"); }
  }
  const validate = ajv.getSchema("https://local.invalid/lakda/binary-artifact-attestation/v1");
  if (!validate) throw new Error("binary attestation schema is unavailable");
  if (!validate(value)) throw new ReportInputError("invalid-media-proof", "媒体の検査記録がschemaに適合しません");
}
