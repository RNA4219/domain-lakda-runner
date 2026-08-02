import { expect, test } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { AirtestPocoAdapter } from "../src/adapters/external-bridges.js";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFile(resolve(root, path), "utf8");

test("Airtest template example is explicitly non-executable and has no bundled images", async () => {
  const corpus = JSON.parse(await read("examples/airtest-templates.json")) as {
    schemaVersion: string;
    baseDir: string;
    operatorReplacementRequired: boolean;
    templates: Array<{ path: string }>;
  };
  expect(corpus.schemaVersion).toBe("lakda/airtest-template-corpus/v1");
  expect(corpus.baseDir).toBe("manifest-parent");
  expect(corpus.operatorReplacementRequired).toBe(true);
  for (const template of corpus.templates) {
    await expect(stat(resolve(root, "examples", template.path))).rejects.toThrow();
  }
});

test("Airtest/Poco bridge keeps capture stop outside the recording lock", async () => {
  const source = await read("tools/airtest-poco-bridge/server.py");
  expect(source).toContain("Never hold _recording_lock while waiting for the sampler");
  expect(source).toMatch(/sampler\.join\(timeout=timeout\)\s+if sampler\.is_alive\(\):/);
  expect(source).toContain("operator-approved");
  expect(source).toContain('"reason": "unsupported-control"');
});

test("Poco bridge candidates require explicit none mutation and fresh visual identity", async () => {
  const source = await read("tools/airtest-poco-bridge/server.py");
  expect(source).toContain('item.get("operatorApproved") is not True');
  expect(source).toContain('item.get("mutationKind") != "none"');
  expect(source).toContain('entry.get("mutationKind") != "none"');
  expect(source).toContain('raise CandidateDenied("stale_candidate")');
  expect(source).toContain("_candidate_registry");
  expect(source).toContain('"adapterDataRef": adapter_data_ref');
  expect(source).toContain("if existing == entry:");
  expect(source).toContain('self._candidate_registry[candidate_id] = {"collision": True}');
  expect(source).toContain('raise CandidateDenied("candidate_id_collision")');
  expect(source).toContain('candidate.get("mutationKind") != "none" or entry.get("mutationKind") != "none"');
  expect(source).toContain('current_observation.get("adapterDataRef") != entry.get("adapterDataRef")');
  expect(source).not.toContain('current_fingerprint != candidate.get("sourceFingerprint")');
  expect(source).not.toContain('"postFingerprint": post_fingerprint');
  expect(source).toContain('attrs.get("clickable") is True and attrs.get("enabled") is not False');
  expect(source).toContain("actual_digest = f\"sha256:{digest_bytes(resolved.read_bytes())}\"");
  expect(source).toContain("template {item['id']} bytes do not match declared sha256");
  expect(source).toContain("math.isfinite(float(confidence))");
  expect(source).toContain("threshold=float(template.get(\"confidence\", 0.9))");
  expect(source).toContain("template/poco id is duplicated");
  expect(source).toContain('"stopped": True');
  expect(source).toContain("sampled-frame capture parameters must be positive integers");
  expect(source).not.toContain("_active_staging");
  expect(source).toContain("def _safe_artifact_path");
  expect(source).toContain("resolved = candidate.resolve()");
  expect(source).toContain("if current.is_symlink()");
  expect(source).toContain("self._safe_artifact_path(staging, f\"artifacts/{name}\")");
  expect(source).toContain('self._safe_artifact_path(staging, "artifacts/video/0001.webm")');
  expect(source).toContain("def _artifact_ref(self, path: Path, staging: Path)");
  expect(source).toContain("def _validated_video_artifact");
  expect(source).toContain("path.is_symlink() or not path.is_file()");
  expect(source).toContain("if size <= 0");
  expect(source).toContain("size > max_bytes");
  expect(source).toContain('"artifactRefs": [artifact_ref]');
  expect(source).toContain("self.template_corpus_digest = f\"sha256:{digest_bytes(self.template_manifest_path.read_bytes())}\"");
  expect(source).toContain('"templateCorpusDigest": self.template_corpus_digest');
  expect(source).toContain('content_parts[0].lower() != "application/json"');
  expect(source).toContain('"Content-Type must be application/json"}, 415');
  expect(source).toContain('allowed_origins =');
  expect(source).toContain('"cross-origin requests are not allowed"');
  expect(source).toContain('"cross-origin requests are not allowed"}, 403');
});

test("sampled-frame stop timeout is carried by the adaptive runtime contract", async () => {
  const runtime = await read("src/adaptive/coordinator/runtime.ts");
  const bridges = await read("src/adapters/external-bridges.ts");
  expect(runtime).toContain("stopTimeoutMs: environment.capture.stopTimeoutMs");
  expect(runtime).toContain("stopTimeoutMs: frames?.stopTimeoutMs");
  expect(runtime).toContain("screenshotAvailable?: boolean");
  expect(runtime).not.toContain("environment.adapter.capabilities().evidenceCapabilities.includes(\"screenshot\")");
  expect(bridges).toContain("sampled-frame stop/discard requires a positive stopTimeoutMs");
});

test("requirements input does not enable pip global hash checking accidentally", async () => {
  const requirements = await read("tools/airtest-poco-bridge/requirements.txt");
  const attestation = await read("tools/airtest-poco-bridge/requirements.top-level-attestation.txt");
  expect(requirements).not.toContain("requirements.lock");
  expect(attestation).toContain("not a pip-installable lock");
});

test("capture-control API rejects incomplete sampled-frame start parameters", async () => {
  const adapter = new AirtestPocoAdapter({
    captureControl: async () => ({ accepted: true, mode: "sampled-frames/v1", artifactRefs: [] }),
  } as never);
  await expect(adapter.captureControl({ runId: "run", stagingDir: ".lakda/runs/run", action: "start", mode: "sampled-frames/v1", intervalMs: 1_000, maxFrames: 10, maxBytes: 10_000, stopTimeoutMs: 0 })).rejects.toThrow(/positive intervalMs/);
});

test("capture-control API rejects accepted stop without stopped/frame counters", async () => {
  const adapter = new AirtestPocoAdapter({
    captureControl: async () => ({ accepted: true, mode: "sampled-frames/v1", artifactRefs: [] }),
  } as never);
  await expect(adapter.captureControl({ runId: "run", stagingDir: ".lakda/runs/run", action: "stop", mode: "sampled-frames/v1", stopTimeoutMs: 5_000 })).rejects.toThrow(/stopped=true/);
});

test("capture-control API rejects accepted video stop without an artifact reference", async () => {
  const adapter = new AirtestPocoAdapter({
    captureControl: async () => ({ accepted: true, mode: "video", artifactRefs: [], stopped: true }),
  } as never);
  await expect(adapter.captureControl({ runId: "run", stagingDir: ".lakda/runs/run", action: "stop", mode: "video" })).rejects.toThrow(/artifactRef/);
});
