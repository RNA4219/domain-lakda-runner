import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./plan.js";
import { findSensitive } from "./redaction.js";
import type { LakdaConfig } from "./types.js";

export const RUN_START_REF = "run-start.json";
export const RUN_START_MAX_BYTES = 4096;
export type RunStartRecord = {
  schemaVersion: "lakda/run-start/v1"; runId: string; attempt: number; startedAt: string;
  mode: string; seed: number; workerIndex: number; batchId?: string;
  producerVersion: string; producerRevision: string; classification: LakdaConfig["artifacts"]["classification"];
};
type AjvConstructor = new (options: object) => { compile(schema: object): (value: unknown) => boolean };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as AjvConstructor;
const schema = JSON.parse(readFileSync(new URL("../../schemas/lakda-run-start-v1.schema.json", import.meta.url), "utf8")) as object;
const validate = new Ajv({ strict: false, formats: { "date-time": true } }).compile(schema);

export function assertRunStartRecord(value: unknown): asserts value is RunStartRecord {
  if (!validate(value)) throw new Error("run開始記録がschemaに適合しません");
  const record = value as RunStartRecord;
  const at = new Date(record.startedAt);
  if (!Number.isFinite(at.getTime()) || at.toISOString() !== record.startedAt) throw new Error("run開始日時が不正です");
  const text = canonicalJson(record);
  if (Buffer.byteLength(text + "\n") > RUN_START_MAX_BYTES || findSensitive(text).length) throw new Error("run開始記録の容量または秘密値検査に失敗しました");
}

/** Persist only the start observation; it does not assert an execution outcome. */
export async function writeRunStartRecord(root: string, record: RunStartRecord): Promise<void> {
  assertRunStartRecord(record);
  await writeFile(join(root, RUN_START_REF), canonicalJson(record) + "\n", { encoding: "utf8", flag: "wx" });
}
