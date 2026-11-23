import { targetKey, type DomainMap } from "./model.js";
import type { Run } from "./observations.js";

export function coverageReport(map: DomainMap, run: Run | null, evidence: { file: string; sha256: string } | null) {
  const rows = map.behaviors.map(b => {
    const cases = map.cases.flatMap(c => {
      const items = c.checks.filter(h => h.behaviors.includes(b.id));
      if (!items.length) return [];
      const current = run?.cases.get(c.id);
      const checks = items.map(h => {
        const observation = current?.revision === c.revision ? current.checks.get(h.id) : undefined;
        return { id: h.id, result: observation?.result ?? "unreported", source: observation?.source ?? null,
          comparisons: observation?.comparisons ?? [] };
      });
      return [{ id: c.id, revision: c.revision, checks }];
    });
    let state: "excluded" | "undesigned" | "pending" | "failed" | "passed";
    if (b.excluded) state = "excluded";
    else if (!cases.length) state = "undesigned";
    else if (cases.some(c => c.checks.some(h => h.result === "failed"))) state = "failed";
    else if (cases.some(c => c.checks.every(h => h.result === "passed"))) state = "passed";
    else state = "pending";
    return { ...b, state, cases };
  });
  const targets = new Map<string,string[]>();
  for (const b of rows) for (const target of b.targets) {
    const key = targetKey(target);
    if (!targets.has(key)) targets.set(key,[]);
    targets.get(key)!.push(b.id);
  }
  const nodes = map.graph.nodes.map(n => ({ ...n, behaviors: targets.get(targetKey(n.id)) ?? [] }));
  const connections = map.graph.connections.map(e => ({ ...e, behaviors: targets.get(targetKey(e)) ?? [] }));
  const active = rows.filter(b => b.state !== "excluded");
  const designed = active.filter(b => b.cases.length).length;
  const passed = active.filter(b => b.state === "passed").length;
  const failed = active.filter(b => b.state === "failed").length;
  const total = active.length, judged = passed + failed;
  const mapped = new Map(map.cases.map(c => [c.id,c]));
  const unmappedCases = map.cases.filter(c => !c.checks.length).map(c => ({ id:c.id, revision:c.revision }));
  for (const [id,record] of run?.cases ?? []) {
    if (mapped.get(id)?.revision !== record.revision) unmappedCases.push({ id,revision:record.revision });
  }
  return { schema:"lakda/domain-coverage/v1", product:map.product, version:map.version, environment: map.environment,
    runId:run?.id ?? null, evidence, totals:{ total, designed, judged, passed, failed,
      designRate:total ? designed/total : null, judgedRate:total ? judged/total : null },
    architecture:{ name:map.graph.name, nodes, connections }, behaviors:rows, unmappedCases };
}
export type CoverageReport = ReturnType<typeof coverageReport>;
