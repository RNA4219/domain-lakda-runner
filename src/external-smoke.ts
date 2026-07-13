import { loadConfig } from "./core/config.js";
import { runLakda } from "./core/runner.js";

export type ExternalSmokeResult =
  | { command: "smoke:external"; skipped: true; reason: string }
  | { command: "smoke:external"; baseUrl: string; outcome: string; runId: string; artifactManifestPath?: string };

export async function runExternalSmoke(baseUrl = process.env.LAKDA_EXTERNAL_BASE_URL, outputDir = ".lakda/external-smoke"): Promise<ExternalSmokeResult> {
  if (!baseUrl) return { command: "smoke:external", skipped: true, reason: "LAKDA_EXTERNAL_BASE_URL is not set" };
  const target = new URL(baseUrl);
  const config = loadConfig(undefined, {
    baseUrl: target.toString(), mode: "smoke", outputDir, maxActions: 1,
    safety: { allowHosts: [target.hostname] },
  });
  const result = await runLakda(config);
  return { command: "smoke:external", baseUrl: target.origin, outcome: result.outcome, runId: result.runId, artifactManifestPath: result.artifactManifestPath };
}