import { readResultTemplate } from "./result-template.mjs";
import { lstat, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { URL } from "node:url";
import { inspectReleaseReview } from "./e2e-platform-evidence.mjs";
import { readGateCaseReview } from "./e2e-case-review.mjs";
import { bindPlayback } from "./case-review/playback.mjs";
import { writeOverview } from "./gate-review/overview.mjs";

const outputMarkers = new Set(["gate-verdict.json", "quality-evidence-record.json", "output-manifest.json", "output-record.json",
  "quality-evidence-record.md", "test-placement-plan.json", "qeg.bundle.json", ".qeg-current.json", ".qeg-generations"]);

async function review(base, entry, stage, position) {
  const caseDir = await realpath(resolve(base, entry.caseDir));
  const scenarioDir = dirname(caseDir);
  const actionPlan = JSON.parse(await readFile(join(caseDir, "action-sequence.json"), "utf8"));
  const qegDir = await realpath(resolve(base, entry.qegDir));
  const issued = (await readdir(qegDir)).some(name => outputMarkers.has(name));
  if (issued !== Boolean(entry.qegManifestSha256)) {
    throw new Error(issued ? "QEG 出力の照合用 SHA-256 が必要です" : "指定された QEG 出力が見つかりません");
  }
  const runDir = entry.runDir && resolve(base, entry.runDir);
  const { evidence, ...record } = await inspectReleaseReview({
    workspace: dirname(scenarioDir), scenarioDir, baseUrl: actionPlan.baseUrl, caseId: basename(caseDir),
    index: resolve(base, entry.index), runDir, qegDir, qegManifestSha256: entry.qegManifestSha256,
    hateArtifactId: entry.hateArtifactId,
  }, issued);
  let caseModel;
  if (evidence) {
    const page = "case-" + position + ".html";
    const { summary, model } = await readGateCaseReview({ "case-dir": caseDir, run: [runDir], out: join(stage, page) },
      { ...evidence, recordNumber: position });
    record.trace = { review:summary, page, mode:evidence.selection.mode, blockers:evidence.selection.blockers };
    caseModel = model;
  }
  const { state, caseId, revision, environment, origin, reasons, profile, trace, disqualifications } = record;
  return { caseModel, record: { state, caseId, revision, environment, origin, reasons, profile, trace, disqualifications,
    canOpenLocalCase: record.canOpenLocalCase, target: { projectId: record.target?.projectId }, scope: { notEvaluated: record.scope?.notEvaluated } } };
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: "string" }, out: { type: "string" } } });
  if (!values.input || !values.out) throw new Error("使い方: --input <記録の参照一覧.json> --out <新規ディレクトリ>");
  const input = resolve(values.input), out = resolve(values.out);
  const config = JSON.parse(await readFile(input, "utf8"));
  if (!Array.isArray(config.records) || !config.records.length) throw new Error("表示する記録がありません");
  try { await lstat(out); throw new Error("出力先は既に存在します"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const stage = await mkdtemp(join(dirname(out), ".lakda-gate-review-"));
  try {
    const entries = [];
    for (const [i, item] of config.records.entries()) entries.push(await review(dirname(input), item, stage, i + 1));
    if (config.overview) await writeOverview(config, dirname(input), entries, stage);
    const records = entries.map(entry => entry.record);
    const template = (await readResultTemplate(new URL("./gate-review/view.html", import.meta.url)))
      .replace("/*REVIEW_PAGE*/", () => JSON.stringify(config.overview ? "review.html" : "index.html"))
      .replace("<!--OVERVIEW_LINK-->", config.overview ? '<a class="home-link" href="index.html">← テスト概要</a>' : "")
      .replace("/*PLAYBACK*/", () => bindPlayback.toString());
    const json = data => JSON.stringify(data).replaceAll("<", "\\u003c");
    const summaryData = json(records);
    async function writePage(name, initial, model = null) {
      const html = template.replace('data-entry="1/conclusion"', 'data-entry="'+initial+'"')
        .replace(/\/\*(CASE_DATA|GATE_RECORDS)\*\//g, (_, key) => key === "CASE_DATA" ? json(model) : summaryData);
      await writeFile(join(stage, name), html, { flag:"wx" });
    }
    await writePage(config.overview ? "review.html" : "index.html","1/conclusion");
    for (const [i, entry] of entries.entries()) {
      if (entry.caseModel) await writePage(entry.record.trace.page, (i+1)+"/evidence", entry.caseModel);
    }
    const comparison = records.findIndex(record => record.state === "no_go" && record.trace);
    if (comparison >= 0) {
      for (const view of ["conclusion", "steps"]) {
        await writePage(view+".html", (comparison+1)+"/"+view);
      }
    }
    await rename(stage, out);
    console.log(join(out, "index.html"));
  } finally { await rm(stage, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.message); process.exitCode = 2; });
