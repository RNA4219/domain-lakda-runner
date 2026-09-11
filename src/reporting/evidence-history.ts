import { assertAdaptiveContract, type EvidenceArtifactRef, type OracleResult } from "../adaptive/contracts.js";
import { hateArtifact } from "../runs/catalog-values.js";
import type { ManifestSnapshot } from "../runs/manifest-snapshot.js";
import { REPORT_LIMITS, ReportInputError } from "./contracts.js";
import { maximumClassification } from "./projection-values.js";
import type { Classification, ReportIssue, ReportSource } from "./types.js";

export type ReportEvidenceRef = string | EvidenceArtifactRef;
export type ReportEvidence = { records: Map<string, ReportEvidenceRef[]>; oracles: OracleResult[] };
const invalid = () => new ReportInputError("invalid-evidence-reference", "保存済み証跡の参照形式が不正です");

export function readReportOracle(value: unknown): OracleResult {
  assertAdaptiveContract(value);
  if (!("oracleId" in value)) throw invalid();
  return value;
}

export function readHistoryEvidence(entry: Record<string, unknown>): { evidenceRefs: ReportEvidenceRef[]; oracle?: OracleResult } {
  if (entry.type === "execution") {
    const result = entry.executionResult; assertAdaptiveContract(result);
    if (!("executionId" in result)) throw invalid();
    return { evidenceRefs: result.evidenceRefs };
  }
  if (entry.type === "oracle" || entry.type === "candidate-denied" && entry.oracleResult !== undefined) {
    const oracle = readReportOracle(entry.type === "oracle" ? entry.result : entry.oracleResult);
    return { evidenceRefs: oracle.evidenceRefs, oracle };
  }
  if (["operator-bookmark", "timeout-evidence", "security-kill-switch", "security-cleanup"].includes(String(entry.type)) && entry.evidenceRefs !== undefined) {
    const refs = entry.evidenceRefs;
    if (!Array.isArray(refs) || refs.length > REPORT_LIMITS.actionsAndEvents || refs.some(ref => typeof ref !== "string" || !ref)) throw invalid();
    return { evidenceRefs: refs as string[] };
  }
  return { evidenceRefs: [] };
}

/** Only read bytes already retained and verified by the source snapshot reader. */
export function readSourceOracles(snapshot: ManifestSnapshot, source: ReportSource, issues: ReportIssue[]): OracleResult[] {
  const artifact = snapshot.artifacts.find(artifact => artifact.path === "adaptive/oracle-results.jsonl");
  if (!artifact) return [];
  if (artifact.classification === "restricted") {
    issues.push({ code: "restricted-input", severity: "warning", sourceId: source.id, message: "取扱い制限のある証跡対応記録を除外しました" });
    return [];
  }
  hateArtifact(artifact, 0);
  source.classification = maximumClassification([source.classification, artifact.classification as Classification]);
  const bytes = snapshot.snapshots.get(artifact.path)?.bytes;
  if (!bytes) throw invalid();
  let lines: string[];
  try { lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split(/\r?\n/).filter(line => line.trim()); }
  catch { throw invalid(); }
  if (lines.length > REPORT_LIMITS.actionsAndEvents) throw new ReportInputError("record-limit", "証跡対応記録の件数上限を超えています");
  return lines.map(line => {
    let value: unknown; try { value = JSON.parse(line); } catch { throw invalid(); }
    return readReportOracle(value);
  });
}
