import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateReport } from "../../dist/reporting/generation.js";
import { verifyReportBundle } from "../../dist/reporting/bundle-verifier.js";
import { appendSessionEvent, buildExplorationReport, createExplorationSession, registerRunManifest, writeFinding } from "../../dist/exploration/session.js";
import { createMediaCorpus } from "./media-corpus.mjs";
import { createArtificialMedia } from "./media-recording.mjs";
import { checkMediaBrowser } from "./media-browser.mjs";

export async function runMediaSuite(root) {
  await mkdir(root);
  const result = { artificialInputs: true, corpus: null, browsers: [], passed: false };
  const save = () => writeFile(join(root, "result.json"), JSON.stringify(result, null, 2));
  try {
    const bytes = await createArtificialMedia(); result.producerBrowserVersion = bytes.producerBrowserVersion;
    result.corpus = await createMediaCorpus(root, bytes, { generateReport, verifyReportBundle, appendSessionEvent, buildExplorationReport, createExplorationSession, registerRunManifest, writeFinding });
    await save();
    for (const channel of ["chrome", "msedge"]) {
      for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
        for (const zoom of [1, 2]) {
          const id = channel + "-" + viewport.width + "-" + zoom;
          const browser = await checkMediaBrowser(result.corpus, join(root, id), channel, viewport, zoom);
          result.browsers.push(browser); await save();
          console.log("media " + id + ": passed=" + browser.passed + ", failed=" + browser.checks.filter(item => !item.passed).map(item => item.id).join(","));
        }
      }
    }
    result.passed = result.browsers.length === 8 && result.browsers.every(browser => browser.passed);
  } catch (error) { result.error = error.stack ?? String(error); }
  finally { await save(); }
  return result;
}
