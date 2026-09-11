import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { cpus, machine, release, totalmem, type, version } from "node:os";
import { join, resolve } from "node:path";
import { createCorpus } from "./report-acceptance/corpus.mjs";
import { measureGeneration } from "./report-acceptance/generation.mjs";
import { measureBrowser } from "./report-acceptance/browser.mjs";
import { runMediaSuite } from "./report-acceptance/media-suite.mjs";

if (process.argv.length !== 2) throw new Error("This acceptance command takes no options");
const git = args => execFileSync("git", args, { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 }).trim();
await mkdir(".lakda", { recursive: true });
const root = await mkdtemp(resolve(".lakda/report-acceptance-"));
const result = { schemaVersion: "lakda/report-acceptance/v1", startedAt: new Date().toISOString(), sourceRevision: git(["rev-parse", "HEAD"]), worktree: git(["status", "--porcelain"]), environment: { node: process.version, os: type(), version: version(), release: release(), arch: machine(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem() }, artificialInputs: true, mediaAcceptance: "included", media: null, outputRoot: root, corpora: [], passed: false };
const save = () => writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
console.log("Report acceptance artifacts: " + root);
try {
  const sourceFiles = [...new Set(git(["ls-files", "-co", "--exclude-standard", "-z", "--", "src", "schemas", "scripts", "package.json", "package-lock.json", "tsconfig.build.json", "tsconfig.json"]).split("\0").filter(Boolean))].sort();
  result.sourceFiles = [];
  for (const path of sourceFiles) result.sourceFiles.push({ path, sha256: "sha256:" + createHash("sha256").update(await readFile(path)).digest("hex") });
  result.sourceSnapshotSha256 = "sha256:" + createHash("sha256").update(JSON.stringify(result.sourceFiles)).digest("hex");
  await save();
  for (const distribution of ["distributed", "concentrated"]) {
    const corpusRoot = join(root, distribution); await mkdir(corpusRoot);
    const corpus = await createCorpus(corpusRoot, distribution);
    const entry = { corpus, generation: null, browsers: [] }; result.corpora.push(entry); await save();
    entry.generation = await measureGeneration(corpusRoot, corpus); await save();
    if (!entry.generation.viewerBundle) continue;
    const manifestBytes = await readFile(join(entry.generation.viewerBundle, "report-manifest.json"));
    entry.bundleManifestSha256 = "sha256:" + createHash("sha256").update(manifestBytes).digest("hex");
    entry.bundleFiles = JSON.parse(manifestBytes).files;
    for (const channel of ["chrome", "msedge"]) {
      for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
        for (const zoom of [1, 2]) {
          const id = channel + "-" + viewport.width + "-" + zoom;
          const browser = await measureBrowser(entry.generation.viewerBundle, join(corpusRoot, id), channel, viewport, zoom);
          entry.browsers.push(browser); await save();
          console.log(distribution + " " + id + ": passed=" + browser.passed + (browser.error ? ", " + browser.error.split("\n")[0] : ""));
        }
      }
    }
  }
  result.media = await runMediaSuite(join(root, "media")); await save();
  result.passed = result.corpora.length === 2 && result.corpora.every(entry => entry.generation?.passed && entry.browsers.length === 8 && entry.browsers.every(browser => browser.passed)) && result.media.passed;
} catch (error) { result.error = error.stack ?? String(error); }
finally { result.finishedAt = new Date().toISOString(); await save(); }
console.log(JSON.stringify({ passed: result.passed, result: join(root, "result.json") }));
process.exitCode = result.passed ? 0 : 1;
