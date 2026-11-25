function requireValue(condition, code) { if (!condition) throw new Error(code); }

export function inspectPlatformRecording(snapshot, planned, runId, attempt) {
  const read = key => {
    const value = snapshot.snapshots.get(key);
    requireValue(value?.bytes, "missing_evidence");
    try { return JSON.parse(value.bytes.toString("utf8")); } catch { throw new Error("invalid_evidence"); }
  };
  const recording = read("platform-recording.json"), actions = read("action-execution.json");
  requireValue(recording.schemaVersion === "lakda/platform-recording/v1" && actions.schemaVersion === "lakda/action-execution/v1" &&
    recording.runId === runId && recording.attempt === attempt && actions.runId === runId && actions.attempt === attempt, "run_mismatch");
  for (const key of ["caseId", "caseRevision", "oracleRevision", "reviewSha256", "actionSha256", "configSha256"]) {
    requireValue(recording.plan?.[key] === (key === "caseId" ? planned.id : planned[key]), "case_mismatch");
  }
  requireValue(Array.isArray(recording.actions) && Array.isArray(actions.executions), "invalid_evidence");
  requireValue(recording.actions.length === actions.executions.length, "action_mismatch");
  requireValue(Number.isFinite(recording.measured?.durationMs) && recording.measured.durationMs > 0, "invalid_evidence");
  const firstFrameMs = Date.parse(recording.firstFrameAt), stoppedMs = Date.parse(recording.stoppedAt);
  requireValue(Number.isFinite(firstFrameMs) && Number.isFinite(stoppedMs) && stoppedMs > firstFrameMs &&
    [5, 15].includes(recording.plan?.fps), "invalid_evidence");
  const seen = new Set();
  for (const [index, action] of recording.actions.entries()) {
    requireValue(Number.isSafeInteger(action.sequence) && action.sequence > 0 && !seen.has(action.sequence) &&
      typeof action.actionId === "string" && Number.isFinite(action.offsetMs) && action.offsetMs >= 0 &&
      action.offsetMs <= recording.measured.durationMs, "action_mismatch");
    seen.add(action.sequence);
    const executed = actions.executions[index], startedMs = Date.parse(executed.startedAt);
    requireValue(executed.sequence === action.sequence && executed.actionId === action.actionId &&
      Number.isFinite(startedMs) && startedMs <= stoppedMs &&
      Math.abs(startedMs - firstFrameMs - action.offsetMs) <= 1000 / recording.plan.fps, "action_mismatch");
  }
  const videos = snapshot.artifacts.filter(item => item.kind === "video");
  requireValue(videos.length === 1, "missing_evidence");
  const video = videos[0];
  requireValue(String(video.sha256).replace(/^sha256:/, "") === String(recording.measured?.sha256).replace(/^sha256:/, "") &&
    video.size_bytes === recording.measured?.sizeBytes, "integrity_mismatch");
  return { recording, actions, video };
}
