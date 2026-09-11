import type { ReportSourceCollection } from "./source-collection.js";
import { buildEvidenceIndex, type EvidenceTarget } from "./evidence-index.js";
import type { VerifiedMediaReplacement } from "./media-replacements.js";
import type { Classification, ReportIssue } from "./types.js";

export type EvidenceNotes = "unavailable" | "not-media";
export type ReportEvidenceLinks = {
  records: Map<string, { ids: string[]; notes: EvidenceNotes[] }>;
  classifications: Map<string, Classification>;
  issues: ReportIssue[];
};

/** Resolve only recorded references inside already-bound source identities. No source is modified. */
export function prepareReportEvidenceLinks(collection: ReportSourceCollection, replacements: readonly VerifiedMediaReplacement[] = []): ReportEvidenceLinks {
  const result: ReportEvidenceLinks = { records: new Map(), classifications: new Map(), issues: [] };
  const inputs = [...collection.runs, ...collection.sessions].filter(input => input.source.status !== "restricted");
  const bySource = new Map<string, VerifiedMediaReplacement[]>();
  for (const replacement of replacements) {
    const matches = bySource.get(replacement.sourceId) ?? []; matches.push(replacement); bySource.set(replacement.sourceId, matches);
  }
  const indexes = new Map(inputs.map(input => [input.source.id, buildEvidenceIndex(input, bySource.get(input.source.id))]));
  const warned = new Set<string>();
  const warn = (sourceId: string, restricted: boolean) => {
    const code = restricted ? "restricted-evidence" : "evidence-unavailable";
    if (warned.has(sourceId + code)) return;
    warned.add(sourceId + code);
    result.issues.push({ sourceId, code, severity: "warning", message: restricted ? "取扱い制限のある証跡の対応を表示しません" : "対応する証跡を確認できない項目があります" });
  };
  const record = (id: string, sourceId: string, targets: Array<EvidenceTarget | undefined>) => {
    const ids = new Set<string>(); const notes = new Set<EvidenceNotes>();
    for (const target of targets) {
      if (!target) { notes.add("unavailable"); warn(sourceId, false); }
      else if (target.classification === "restricted") warn(sourceId, true);
      else if (!target.mediaId) notes.add("not-media");
      else ids.add(target.mediaId);
    }
    result.records.set(id, { ids: [...ids].sort(), notes: [...notes].sort() });
  };
  for (const input of inputs) {
    const index = indexes.get(input.source.id)!;
    for (const [id, refs] of input.evidence?.records ?? []) record(id, input.source.id, refs.map(index.resolve));
  }
  for (const session of collection.sessions) {
    if (!session.summary || session.source.status === "restricted") continue;
    const allowed = [session.source.id, ...session.summary.runKeys].map(id => indexes.get(id)).filter(index => index !== undefined);
    for (const [id, refs] of session.findingEvidence) {
      const oracleIds = new Set(session.findingOracles?.get(id) ?? []);
      const requested = new Set(refs); const missing = new Set<string>();
      const matches = new Map<string, Map<string, EvidenceTarget>>();
      let conflicting = false;
      for (const index of allowed) for (const oracleId of oracleIds) {
        const oracles = index.oracles.get(oracleId);
        if (!oracles) continue;
        if (oracles.size !== 1) { conflicting = true; continue; }
        for (const evidence of oracles.values().next().value!.evidenceRefs) {
          if (!requested.has(evidence.artifactId)) continue;
          const target = index.resolve(evidence);
          if (!target) { missing.add(evidence.artifactId); continue; }
          if (!matches.has(evidence.artifactId)) matches.set(evidence.artifactId, new Map());
          matches.get(evidence.artifactId)!.set(target.key, target);
        }
      }
      const resolved = [...requested].map(ref => {
        const candidates = matches.get(ref);
        return !conflicting && !missing.has(ref) && candidates?.size === 1 ? candidates.values().next().value : undefined;
      });
      record(id, session.source.id, resolved);
    }
    for (const event of session.timeline) {
      const related = event.relatedIds.filter(id => session.findingEvidence.has(id));
      if (!related.length) continue;
      result.records.set(event.id, { ids: [...new Set(related.flatMap(id => result.records.get(id)?.ids ?? []))].sort(), notes: [...new Set(related.flatMap(id => result.records.get(id)?.notes ?? []))].sort() });
    }
  }
  for (const index of indexes.values()) for (const target of index.targets.values()) if (target.mediaId) result.classifications.set(target.mediaId, target.classification);
  return result;
}
