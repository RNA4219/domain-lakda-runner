import { resolve } from "node:path";
import { verifyAcceptanceReport } from "./real-llm-evidence.mjs";

function flag(name) {
  return process.argv.slice(2).find(value => value.startsWith("--" + name + "="))?.slice(name.length + 3);
}

const report = flag("report");
const bundle = flag("bundle");
if (!report || !bundle) throw new Error("usage: acceptance:verify -- --report=<report.json> --bundle=<bundle-dir>");
const result = await verifyAcceptanceReport({
  reportPath: resolve(report),
  bundlePath: resolve(bundle),
  checkRevision: process.argv.includes("--check-revision"),
});
console.log(JSON.stringify(result, null, 2));
if (!result.valid || !result.overall) process.exitCode = 1;
