import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../dist/core/plan.js";
import { findSensitive } from "../dist/core/redaction.js";
import { fileSha256 } from "./real-llm-evidence.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manualSchema = JSON.parse(await readFile(join(root, "schemas", "manual-bb-release-record-v1.schema.json"), "utf8"));
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default;
const validateManualSchema = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(manualSchema);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function portablePath(value) {
  assert(typeof value === "string" && value.length > 0, "evidence pathが空です");
  assert(!isAbsolute(value) && !value.split(/[\\/]/).includes(".."), "evidence pathがportableではありません: " + value);
  return value.replaceAll("\\", "/");
}

async function verifyDescriptor(root, descriptor) {
  const rel = portablePath(descriptor.path);
  const target = resolve(root, ...rel.split("/"));
  assert(relative(root, target).split(/[\\/]/)[0] !== "..", "evidence pathがroot外です: " + rel);
  const bytes = await readFile(target);
  assert((await stat(target)).size === descriptor.size, "evidence size不一致: " + rel);
  assert(await fileSha256(target) === descriptor.sha256, "evidence hash不一致: " + rel);
  assert(findSensitive(bytes.toString("utf8")).length === 0, "manual evidence security scan失敗: " + rel);
  return { rel, json: JSON.parse(bytes.toString("utf8")) };
}

export async function verifyManualReleaseEvidence({ recordPath, expectedRevision }) {
  const absoluteRecord = resolve(recordPath);
  const root = dirname(absoluteRecord);
  const recordText = await readFile(absoluteRecord, "utf8");
  assert(findSensitive(recordText).length === 0, "manual release record security scan失敗");
  const record = JSON.parse(recordText);
  assert(validateManualSchema(record), "manual release record schema不適合: " + validateManualSchema.errors?.map(error => error.instancePath + " " + error.message).join("; "));
  assert(record.schemaVersion === "lakda/manual-bb-release/v1", "manual release record schemaVersion不一致");
  assert(record.subjectRevision === expectedRevision, "manual evidenceの対象revision不一致");
  assert(record.testExecutionMode === "real", "manual evidenceはtestExecutionMode=realが必須です");
  assert(record.environment?.name === "staging", "manual evidenceはstaging実行が必須です");
  const target = new globalThis.URL(record.environment.baseUrlOrigin);
  assert(target.protocol === "https:", "staging URLはhttpsが必須です");
  assert(!target.username && !target.password && target.origin === record.environment.baseUrlOrigin, "staging originにuserinfo/path/queryを含めてはいけません");
  assert(record.environment.allowHosts?.includes(target.hostname), "staging hostがallowlistにありません");
  assert(["github-environment", "local-auth-state"].includes(record.environment.authSource), "authSourceが未対応です");
  assert(record.security?.credentialsPersisted === false, "認証情報を証跡へ保存してはいけません");
  assert(record.security?.sensitiveValuesPersisted === false, "sensitive valueを証跡へ保存してはいけません");
  assert(typeof record.operator === "string" && record.operator.length > 0, "operatorが必要です");  const startedAt = Date.parse(record.startedAt);
  const completedAt = Date.parse(record.completedAt);
  assert(Number.isFinite(startedAt) && Number.isFinite(completedAt) && startedAt <= completedAt, "manual evidenceの実行時刻が不正です");
  assert(Array.isArray(record.files?.executions) && record.files.executions.length > 0, "execution evidenceが必要です");

  const caseSetFile = await verifyDescriptor(root, record.files.caseSet);
  const gateFile = await verifyDescriptor(root, record.files.gateDecision);
  const executionFiles = [];
  for (const descriptor of record.files.executions) executionFiles.push({ descriptor, ...(await verifyDescriptor(root, descriptor)) });
  const caseSet = caseSetFile.json;
  const gate = gateFile.json;
  assert(gate.build_id === expectedRevision, "manual-bb gateのbuild_id不一致");
  assert(gate.profile === "strict", "manual-bb gateはstrictが必須です");
  assert(gate.status === "go", "manual-bb gateがgoではありません");
  assert((gate.blocking_risks?.length ?? 0) === 0 && (gate.unmet_conditions?.length ?? 0) === 0, "manual-bb gateにblocking riskまたは未達条件があります");
  assert(caseSet.feature_id === gate.feature_id, "manual-bb feature_id不一致");

  const cases = new Map((caseSet.manual_cases ?? []).map(value => [value.tc_id, value]));
  const manualEvidence = [];
  const executedCaseIds = new Set();
  for (const file of executionFiles) {
    const execution = file.json;
    const testCase = cases.get(execution.tc_id);
    assert(testCase, "case setにない実行証跡です: " + execution.tc_id);
    assert(!executedCaseIds.has(execution.tc_id), "manual caseが重複しています: " + execution.tc_id);
    executedCaseIds.add(execution.tc_id);
    assert(execution.build_id === expectedRevision, "execution build_id不一致: " + execution.tc_id);
    assert(execution.feature_id === caseSet.feature_id, "execution feature_id不一致: " + execution.tc_id);
    assert(execution.env === "staging", "execution envはstagingが必須です: " + execution.tc_id);
    assert(execution.tester === record.operator, "execution testerとoperatorが不一致です: " + execution.tc_id);
    assert(execution.result === "pass", "manual caseがpassではありません: " + execution.tc_id);
    const executedAt = Date.parse(execution.timestamp);
    assert(Number.isFinite(executedAt) && executedAt >= startedAt && executedAt <= completedAt, "execution timestampがrecord期間外です: " + execution.tc_id);
    assert(canonicalJson(execution.expected) === canonicalJson(testCase.expected_results), "manual expectedがcase setと一致しません: " + execution.tc_id);
    assert(Array.isArray(execution.actual) && execution.actual.length > 0, "manual actualがありません: " + execution.tc_id);
    assert(execution.oracle_type === "specified" && canonicalJson(execution.oracle_refs) === canonicalJson(testCase.oracle.refs), "manual oracleがcase setと一致しません: " + execution.tc_id);
    assert(Array.isArray(execution.expected) && execution.expected.length > 0, "expectedがありません: " + execution.tc_id);
    assert(Array.isArray(execution.oracle_refs) && execution.oracle_refs.length > 0, "oracle_refsがありません: " + execution.tc_id);
    manualEvidence.push({
      executedCaseId: "mbb:" + execution.tc_id,
      result: "pass",
      expectedResult: execution.expected.join(" / "),
      oracleRefs: execution.oracle_refs.map((ref, index) => ({ id: `mbb:oracle-${execution.tc_id}-${index + 1}`, path: "artifacts/manual-summary.json", evidenceKind: "spec", capturedAt: execution.timestamp, label: ref })),
      traceTo: ["qeg:ac-018"],
      evidenceRefs: [{ id: "mbb:evidence-" + execution.tc_id, path: "artifacts/manual-summary.json", evidenceKind: "human_review", capturedAt: execution.timestamp, label: file.rel }],
    });
  }
  assert(manualEvidence.length === cases.size, "manual caseの未実行または重複があります");
  const payload = { ...record };
  delete payload.recordPayloadSha256;
  assert(record.recordPayloadSha256 === sha256(canonicalJson(payload)), "manual record payload hash不一致");
  return { valid: true, eligible: true, record, manualEvidence, recordSha256: await fileSha256(absoluteRecord), gateSha256: record.files.gateDecision.sha256, executionCount: executionFiles.length };
}