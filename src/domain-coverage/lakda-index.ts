import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import { hateArtifact, isContained, object, parseJson, type JsonObject } from "../runs/catalog-values.js";
import { readManifestSnapshot } from "../runs/manifest-snapshot.js";
import { label, list, requireValue, type DomainMap } from "./model.js";
import { addCase, verdict, type Observation, type Run } from "./observations.js";

export async function readCaseIndex(map: DomainMap, data: JsonObject, directory: string): Promise<Run> {
  requireValue(map.environment && data.callerSha === map.version, "製品コミットまたは対象環境を確認してください");
  const local = data.localRunId !== undefined;
  const series = local ? data.localRunId : data.workflowRunId;
  const attempt = local ? data.localRunAttempt : data.workflowRunAttempt;
  requireValue((typeof series === "string" && series.trim() || Number.isSafeInteger(series)) &&
    /^[1-9]\d*$/.test(String(attempt)) && Number.isSafeInteger(Number(attempt)), "実行系列・実行回を特定できません");
  const root = await realpath(directory);
  const run: Run = { id: String(series) + "/" + attempt, cases: new Map() };
  const refs = new Set<string>();
  for (const v of list(data.cases,"ケース索引")) {
    const row = object(v,"ケース行");
    if (row.environment !== map.environment) continue;
    const c = addCase(run,row.id,row.caseRevision);
    const planned = map.cases.find(p => p.id === row.id && p.revision === c.revision);
    if (!planned || !planned.checks.some(h => h.obligation !== undefined)) continue;
    requireValue(["passed","failed","partial","error","not_run","unreported"].includes(String(row.outcome)), "不明なケース結果です");
    if (!row.runRef && ["unreported","not_run","error"].includes(String(row.outcome))) continue;
    const ref = label(row.runRef,"runRef");
    requireValue(/^lakda-run-[a-zA-Z0-9-]+$/.test(ref) && !refs.has(ref), "実行証跡の参照が不正または重複しています");
    refs.add(ref);
    const path = await realpath(join(root,ref));
    requireValue(isContained(root,path), "実行証跡が runs-dir の範囲外です");
    const metadata = "run-metadata.json", consoleFile = "console.jsonl";
    const snapshot = await readManifestSnapshot(path,{
      retain: p => p === metadata || p === consoleFile,
      policy: (entry,i) => {
        if (entry.path === metadata || entry.path === consoleFile) hateArtifact(entry,i);
        if (entry.path === metadata) requireValue(entry.safe_for_summary === true, "実行メタデータが集計対象にできません");
      }
    });
    const file = snapshot.snapshots.get(metadata);
    requireValue(file?.bytes, "実行メタデータがありません");
    const meta = object(parseJson(file.bytes, metadata),metadata);
    const digest = sha256(canonicalJson(planned.obligations));
    requireValue(row.manifestSha256 === snapshot.manifestSha256 && row.runId === snapshot.manifest.run_id &&
      row.runId === meta.runId && ref === String(meta.runId).replaceAll(":","-") &&
      row.attempt === meta.attempt && meta.attempt === snapshot.manifest.run_attempt &&
      map.version === meta.commitSha && meta.commitSha === snapshot.manifest.commit_sha &&
      row.outcome === meta.outcome && row.reason === meta.terminationReason &&
      row.actionSha256 === meta.replayInputSha256 && /^[0-9a-f]{64}$/.test(String(row.actionSha256)) &&
      digest === row.reviewedObligationsSha256 && digest === meta.reviewedObligationsSha256 &&
      meta.schemaVersion === "lakda/run-metadata/v1" && meta.mode === "regression-replay" &&
      meta.executionMode === "real" && row.evidenceKind === "real",
      "ケース索引と実行証跡・判定条件が一致しません");
    const byIndex = new Map<number, Observation>();
    const log = snapshot.snapshots.get(consoleFile)?.bytes;
    for (const [i,line] of (log?.toString("utf8") ?? "").split(/\r?\n/).entries()) {
      if (!line) continue;
      const event = object(JSON.parse(line),"ログ");
      if (event.source !== "reviewed-oracle") continue;
      const check = object(JSON.parse(label(event.message,"判定ログ")),"判定ログ");
      const n = check.index;
      requireValue(typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= planned.obligations!.length &&
        !byIndex.has(n), "判定ログの番号が不正です");
      requireValue(check.acceptanceRef === planned.obligations![n-1].acceptanceRef &&
        check.actionId === planned.obligations![n-1].afterActionId, "判定ログの受入条件・操作が一致しません");
      byIndex.set(n,{ result: verdict(check.result), source: ref+"/"+consoleFile+"#L"+(i+1) });
    }
    for (const h of planned.checks) {
      if (!h.obligation) continue;
      for (const id of h.behaviors) {
        const criterion = map.behaviors.find(b => b.id === id)!.criterion;
        const ac = planned.obligations![h.obligation-1].acceptanceRef;
        requireValue((ac === undefined || ac === criterion) &&
          [...list(row.traceTo,"traceTo"), ...list(row.oracleRefs,"oracleRefs")].includes(criterion), "ケースと受入条件が一致しません");
      }
      const obs = byIndex.get(h.obligation);
      if (obs) c.checks.set(h.id,obs);
      else if (!byIndex.size && planned.obligations!.length === 1 &&
        (meta.outcome === "passed" && meta.terminationReason === "completed" ||
         meta.outcome === "failed" && meta.terminationReason === "obligations_unmet")) {
        c.checks.set(h.id,{ result: verdict(meta.outcome), source: ref+"/"+metadata+"#/terminationReason" });
      }
    }
  }
  return run;
}
