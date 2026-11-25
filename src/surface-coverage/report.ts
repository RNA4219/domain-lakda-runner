import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { hateArtifact, isContained } from "../runs/catalog-values.js";
import { readManifestSnapshot } from "../runs/manifest-snapshot.js";
import { array, check, definition, digest, id, keys, lane, lanes, obj, relationId, scope, text, type Catalog, type Lane } from "./catalog.js";
import type { Measurement, Observation } from "./observer.js";

export interface Evidence {
  series: string; seriesAttempt: number; runId: string; attempt: number; testId: string; testRevision: string; outcome: string;
  manifestSha256: string; observationSha256: string; source: string; lane: Lane;
}
export interface TestMeasurement { measurement: Measurement | null; evidence: Omit<Evidence, "source" | "lane"> }
const observationFile = "surface-observations.json";
export function readMeasurement(value: unknown): Measurement {
  const r = obj(value);
  keys(r, ["schema", "product", "version", "environment", "revision", "catalogDigest", "scope", "runId", "attempt", "testId", "testRevision", "complete", "observations"]);
  check(r.schema === "lakda/surface-observations/v1" && typeof r.complete === "boolean");
  const s = obj(r.scope); keys(s, ["screens", "apis", "relations"]);
  const readScope = (kind: "screens" | "apis" | "relations") => {
    const entries = array(s[kind]).map(v => { const p = obj(v); keys(p, ["id", "digest"]); const name = text(p.id); check(kind === "relations" ? /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(name) : /^[A-Za-z0-9_-]+$/.test(name)); check(/^[a-f0-9]{64}$/.test(String(p.digest))); return { id: name, digest: p.digest as string }; });
    check(new Set(entries.map(p => p.id)).size === entries.length); return entries;
  };
  const publicScope = { screens: readScope("screens"), apis: readScope("apis"), relations: readScope("relations") };
  check(r.catalogDigest === digest(publicScope));
  const observations = array(r.observations).map(v => { const o = obj(v); keys(o, ["kind", "id", "lane"]); check(["screens", "apis", "relations"].includes(String(o.kind)));
    const kind = o.kind as Observation["kind"], name = text(o.id); check(publicScope[kind].some(p => p.id === name)); return { kind, id: name, lane: lane(o.lane) }; });
  check(new Set(observations.map(o => JSON.stringify(o))).size === observations.length);
  check(publicScope.relations.every(p => { const [screen, api] = p.id.split(":"); return publicScope.screens.some(s => s.id === screen) && publicScope.apis.some(a => a.id === api); }));
  check(typeof r.runId === "string" && /^lakda:run-[A-Za-z0-9-]+$/.test(r.runId) && Number.isSafeInteger(r.attempt) && Number(r.attempt) > 0);
  return { schema: "lakda/surface-observations/v1", product: text(r.product), version: text(r.version), environment: text(r.environment), revision: text(r.revision),
    catalogDigest: r.catalogDigest as string, scope: publicScope, runId: r.runId, attempt: r.attempt as number, testId: id(r.testId), testRevision: text(r.testRevision), complete: r.complete, observations };
}
/** Only digest-verified same-attempt test evidence is accepted. Errors never echo source values. */
export async function readSurfaceIndex(catalog: Catalog, value: unknown, directory: string | ((ref: string) => string)): Promise<TestMeasurement[]> {
  try {
    const index = obj(value), external = index.schemaVersion === "lakda/surface-run-index/v1";
    check((external || index.schemaVersion === "lakda/e2e-case-index/v1") && index.callerSha === catalog.version);
    if (external) check(index.executionOrigin === "local");
    const local = index.executionOrigin === "local", series = text(String(local ? index.localRunId : index.workflowRunId));
    check(/^[A-Za-z0-9_-]{1,80}$/.test(series));
    const seriesAttempt = local ? index.localRunAttempt : index.workflowRunAttempt;
    check(/^[1-9]\d*$/.test(String(seriesAttempt)) && Number.isSafeInteger(Number(seriesAttempt)));
    const seen = new Set<string>(), refs = new Set<string>();
    const tests: TestMeasurement[] = [];
    for (const value of array(index.cases)) {
      const row = obj(value), testId = id(row.id), testRevision = text(row.caseRevision);
      check(!seen.has(testId) && row.environment === catalog.environment); seen.add(testId);
      const outcome = text(row.outcome); check(["passed", "failed", "partial", "error", "not_run", "unreported"].includes(outcome));
      const evidence = { series, seriesAttempt: Number(seriesAttempt), testId, testRevision, outcome, runId: "", attempt: 0, manifestSha256: "", observationSha256: "" };
      if (!row.runRef) { check(["error", "not_run", "unreported"].includes(outcome)); tests.push({ measurement: null, evidence }); continue; }
      const ref = text(row.runRef); check(/^lakda-run-[A-Za-z0-9-]+$/.test(ref) && !refs.has(ref)); refs.add(ref);
      const root = await realpath(typeof directory === "string" ? directory : directory(ref)), path = await realpath(join(root, ref));
      check(isContained(root, path));
      const snapshot = await readManifestSnapshot(path, { textLimit: 16 * 1024 * 1024, artifactLimit: 1024 * 1024 * 1024,
        retain: p => p === observationFile || p === "run-metadata.json",
        policy: (entry, i) => { if (entry.path === observationFile || entry.path === "run-metadata.json") { hateArtifact(entry, i); check(entry.safe_for_summary === true); } } });
      const meta = obj(JSON.parse(snapshot.snapshots.get("run-metadata.json")!.bytes!.toString("utf8")));
      check(row.manifestSha256 === snapshot.manifestSha256 && row.runId === snapshot.manifest.run_id && row.runId === meta.runId &&
        ref === String(meta.runId).replaceAll(":", "-") && row.attempt === meta.attempt && meta.attempt === snapshot.manifest.run_attempt &&
        snapshot.manifest.commit_sha === meta.commitSha && row.outcome === meta.outcome && row.reason === meta.terminationReason);
      if (external) check(meta.schemaVersion === "lakda/external-surface-run/v1" && obj(meta.surfaceCoverage).source === "external-playwright");
      else check(row.actionSha256 === meta.replayInputSha256 && /^[a-f0-9]{64}$/.test(String(row.actionSha256)));
      const binding = meta.surfaceCoverage === undefined ? undefined : obj(meta.surfaceCoverage).target;
      if (binding !== undefined) {
        const target = obj(binding);
        check(target.product === catalog.product && target.version === catalog.version && target.environment === catalog.environment);
      } else check(meta.commitSha === catalog.version); // Legacy runs bind target and producer together.
      check(typeof meta.runId === "string" && /^lakda:run-[A-Za-z0-9-]+$/.test(meta.runId));
      Object.assign(evidence, { runId: meta.runId, attempt: meta.attempt, manifestSha256: snapshot.manifestSha256 });
      const file = snapshot.snapshots.get(observationFile);
      if (!file?.bytes) { tests.push({ measurement: null, evidence }); continue; }
      const measurement = readMeasurement(JSON.parse(file.bytes.toString("utf8")));
      check(measurement.runId === meta.runId && measurement.attempt === meta.attempt && measurement.testId === testId && measurement.testRevision === testRevision &&
        measurement.product === catalog.product && measurement.version === catalog.version && measurement.environment === catalog.environment);
      evidence.observationSha256 = file.sha256;
      tests.push({ measurement, evidence });
    }
    return tests;
  } catch { throw new Error("Cannot verify surface evidence for this execution attempt"); }
}

export type State = "observed" | "not_observed" | "unmeasured";
export interface SurfaceRow { kind: Observation["kind"]; id: string; name: string; channel: string; location: string; frequency: number; screen?: string; api?: string;
  states: Record<Lane | "all", State>; evidence: Evidence[] }
export function surfaceReport(catalog: Catalog, tests: TestMeasurement[] = []) {
  const currentScope = scope(catalog);
  const project = (kind: Observation["kind"], item: { id: string; name: string; channel: string; location: string; frequency: number; screen?: string; api?: string }, itemDigest: string): SurfaceRow => {
    const evidence: Evidence[] = [];
    let measured = tests.length > 0;
    for (const test of tests) {
      const m = test.measurement;
      const same = m && m.revision === catalog.revision && m.scope[kind].some(p => p.id === item.id && p.digest === itemDigest);
      if (!same || !m!.complete) measured = false;
      if (!same) continue;
      m!.observations.forEach(o => { if (o.kind === kind && o.id === item.id) evidence.push({ ...test.evidence, lane: o.lane, source: observationFile + "#" + kind + "/" + item.id + "/" + o.lane }); });
    }
    const state = (selected: Lane | "all"): State => evidence.some(e => selected === "all" || e.lane === selected) ? "observed" : measured ? "not_observed" : "unmeasured";
    return { kind, ...item, states: { all: state("all"), mock: state("mock"), real: state("real"), unknown: state("unknown") }, evidence };
  };
  const screens = catalog.screens.map(s => project("screens", { id: s.id, name: s.name, channel: s.channel, location: s.origin + s.path + (s.hashRoute ? "#" + s.hashRoute : ""), frequency: s.frequency }, definition(s)));
  const apis = catalog.apis.map(a => project("apis", { id: a.id, name: a.name, channel: "", location: a.method + " " + a.origin + a.path, frequency: a.frequency }, definition(a)));
  const relations = catalog.relations.map(r => {
    const screen = catalog.screens.find(s => s.id === r.screen)!, api = catalog.apis.find(a => a.id === r.api)!;
    return project("relations", { id: relationId(r.screen, r.api), name: screen.name + " → " + api.name, channel: screen.channel, location: api.method + " " + api.origin + api.path, frequency: screen.frequency,
      screen: r.screen, api: r.api }, currentScope.relations.find(p => p.id === relationId(r.screen, r.api))!.digest);
  });
  const summary = Object.fromEntries(([['screens', screens], ['apis', apis], ['relations', relations]] as const).map(([kind, rows]) => [kind,
    Object.fromEntries((["all", ...lanes] as const).map(l => [l, { total: rows.length, observed: rows.filter(r => r.states[l] === "observed").length,
      notObserved: rows.filter(r => r.states[l] === "not_observed").length, unmeasured: rows.filter(r => r.states[l] === "unmeasured").length,
      ratio: rows.length ? rows.filter(r => r.states[l] === "observed").length / rows.length : null }]))]));
  return { schema: "lakda/surface-report/v1", product: catalog.product, version: catalog.version, environment: catalog.environment, revision: catalog.revision,
    catalogDigest: digest(currentScope), summary, screens, apis, relations };
}
export type SurfaceReport = ReturnType<typeof surfaceReport>;
