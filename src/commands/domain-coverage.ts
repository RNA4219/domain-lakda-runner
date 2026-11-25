import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { stringFlag, type Flags } from "../cli/parser.js";
import { sha256 } from "../core/redaction.js";
import { object, parseJson } from "../runs/catalog-values.js";
import { label, readMap, requireValue } from "../domain-coverage/model.js";
import { readObservations, type Run } from "../domain-coverage/observations.js";
import { readCaseIndex } from "../domain-coverage/lakda-index.js";
import { coverageReport } from "../domain-coverage/report.js";
import { reserveReportOutput } from "../reporting/output-transaction.js";

export async function domainCoverageCommand(flags: Flags): Promise<number> {
  const config = stringFlag(flags,"config"), input = stringFlag(flags,"input"), dir = stringFlag(flags,"runs-dir");
  const format = stringFlag(flags,"format") ?? "json", out = stringFlag(flags,"out");
  requireValue(config && ["json","html"].includes(format), "--config と出力形式 json / html を確認してください");
  const raw = object(parseJson(await readFile(config),"マッピング"),"マッピング");
  const path = resolve(dirname(config),label(raw.architecture,"構成ファイル"));
  const architecture = parseJson(await readFile(path),"構成図");
  const map = readMap(raw,architecture);
  let run: Run | null = null, evidence = null;
  if (input) {
    const bytes = await readFile(input), data = object(parseJson(bytes,"実行記録"),"実行記録");
    if (data.schemaVersion === "lakda/e2e-case-index/v1") {
      requireValue(dir, "ケース索引には --runs-dir が必要です");
      run = await readCaseIndex(map,data,dir);
    } else {
      requireValue(!dir, "--runs-dir はケース索引の入力と組み合わせてください");
      run = readObservations(map,data);
    }
    evidence = { file:basename(input), sha256:"sha256:"+sha256(bytes) };
  } else requireValue(!dir, "--input が必要です");
  const report = coverageReport(map,run,evidence);
  const pathToInput = input && relative(out ? dirname(resolve(out)) : process.cwd(),resolve(input));
  const href = pathToInput && (isAbsolute(pathToInput) ? pathToFileURL(resolve(input!)).href
    : "./" + pathToInput.split(sep).map(encodeURIComponent).join("/"));
  const output = (format === "json" ? JSON.stringify(report,null,2)
    : (await import("../domain-coverage/html.js")).renderCoverage(report,href,architecture)) + "\n";
  if (!out) process.stdout.write(output);
  else {
    const sources = [config,path,...(input ? [input] : []),...(dir ? [dir] : [])];
    const transaction = await reserveReportOutput(out,sources);
    try {
      await writeFile(join(transaction.stage,"coverage"),output,{ flag:"wx" });
      await transaction.publishFile("coverage");
    } finally { await transaction.dispose(); }
  }
  return 0;
}
