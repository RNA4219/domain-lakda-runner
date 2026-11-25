import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertHateManifest } from "../../dist/core/hate.js";
import { canonicalJson } from "../../src/core/canonical-json.ts";
import { readArtifactSnapshot } from "../../dist/runs/artifact-snapshot.js";
import { MANIFEST_REF } from "../../dist/runs/manifest-snapshot.js";

function requireValue(value, message) { if (!value) throw new Error(message); }

// 照合済みの依頼を再表示するための読み取り。元の HATE / QEG 検証は再発行しない。
// 動画だけが欠けても、当時の manifest に固定された操作ログを独立して読める。
export async function readDecisionSnapshot(directory, evidence, logFiles, policy) {
  const root = await realpath(directory);
  const source = await readArtifactSnapshot(root, MANIFEST_REF, { retain: true });
  requireValue(evidence?.schemaVersion === "lakda/platform-evidence/v1" && evidence.status === "verified_private" &&
    evidence.manifestSha256 === source.sha256, "判断依頼とこの実行回の manifest が一致しません");
  const manifest = JSON.parse(source.bytes);
  assertHateManifest(manifest);
  requireValue(manifest.run_id === evidence.runId && manifest.run_attempt === evidence.attempt &&
    basename(root) === evidence.runId.replaceAll(":", "-"), "判断依頼と実行回が一致しません");
  const artifacts = manifest.artifacts;
  requireValue(new Set(artifacts.map(item => item.path)).size === artifacts.length, "証跡のパスが重複しています");
  const snapshots = new Map();
  for (const ref of logFiles) {
    const item = artifacts.find(a => a.path === ref);
    requireValue(item, "操作記録がありません " + ref);
    policy(item);
    snapshots.set(ref, await readArtifactSnapshot(root, ref, {
      retain: true, expected: { size: item.size_bytes, sha256: item.sha256 },
    }));
  }
  return { root, manifest, manifestSha256: source.sha256, artifacts, snapshots };
}

export function bindDecision(evidence, planned, recording, video, snapshot) {
  const request = evidence.decisionRequest;
  requireValue(evidence.caseId === planned.id && request?.caseRevision === planned.caseRevision &&
    request.oracleRevision === planned.oracleRevision && request.reviewSha256 === planned.reviewSha256 &&
    [...planned.traceTo, ...planned.oracleRefs].includes(request.acceptanceRef) &&
    typeof request.question === "string" && request.question.trim() && request.question.length <= 4000,
  "判断依頼のケース・受入条件・レビュー版を照合できません");
  const actions = recording.actions.map(({ sequence, actionId, offsetMs }) => ({ sequence, actionId, offsetMs }));
  requireValue(isDeepStrictEqual(evidence.actions, actions) && actions.some(a => isDeepStrictEqual(a, request.action)),
    "判断依頼の操作と時刻が記録に一致しません");
  const log = snapshot.artifacts.find(a => a.path === "action-execution.json");
  for (const item of [log, video]) {
    const matches = evidence.media?.filter(a => a.path === item.path);
    requireValue(matches?.length === 1 && matches[0].artifactId === item.artifact_id && matches[0].sha256 === item.sha256,
      "判断依頼の動画または操作ログの参照が一致しません");
  }
  return { question: request.question, acceptanceRef: request.acceptanceRef, action: request.action };
}

export async function acceptanceExcerpt(path, review, ref) {
  if (!path) return;
  const feature = JSON.parse(await readFile(path, "utf8"));
  const hash = createHash("sha256").update(canonicalJson(feature)).digest("hex");
  requireValue(hash === review.sourceFeatureSha256, "受入条件の仕様書がレビュー時の版と一致しません");
  const matches = (feature.source_refs ?? []).filter(source => source.kind === "ac" && source.id === ref);
  requireValue(matches.length === 1 && typeof matches[0].excerpt === "string" && matches[0].excerpt.trim(),
    "指定の受入条件の原文が見つかりません");
  return matches[0].excerpt;
}
