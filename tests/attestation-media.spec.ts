import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import { createAttestationRequest, attestationRequestDigest, type BinaryAttestationResponse, type AttestationReceipt } from "../src/exploration/attestation-contracts.js";
import { AttestationDirectory } from "../src/exploration/attestation-io.js";
import { createAttestationExchange } from "../src/exploration/attestation-exchange.js";
import { quarantineAttestationSource, adoptAttestationMedia } from "../src/exploration/attestation-media.js";

const roots: string[] = [];
test.afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("lakda-attestation-media-")) throw new Error("unexpected fixture root");
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(source = Buffer.from("fixture original pixels")) {
  const root = await mkdtemp(join(tmpdir(), "lakda-attestation-media-")); roots.push(root);
  const run = join(root, "run"); await mkdir(join(run, "artifacts"), { recursive: true });
  const sourcePath = "artifacts/failure.png", now = Date.now(), keys = generateKeyPairSync("ed25519");
  await writeFile(join(run, sourcePath), source);
  const request = createAttestationRequest({ runId: "fixture-run", targetManifestSha256: "sha256:" + "a".repeat(64),
    sourcePath, sourceSize: source.length, sourceSha256: "sha256:" + sha256(source), mediaType: "image/png",
    policyDigest: "sha256:" + "b".repeat(64) }, { now });
  const io = await AttestationDirectory.create(root, run);
  const context = { now: now + 1, allowedKeyIds: ["fixture"], trustKeys: [{ keyId: "fixture", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }] };
  async function response(decision: "sanitized" | "no-sensitive-content" = "sanitized", output = Buffer.from("fixture masked pixels")) {
    const payload: Omit<BinaryAttestationResponse, "signature"> = { schemaVersion: "lakda/binary-artifact-attestation/v2", request,
      requestSha256: attestationRequestDigest(request), sourcePath, sourceSize: request.sourceSize, sourceSha256: request.sourceSha256,
      decision, ...(decision === "sanitized" ? { outputPath: request.outputPath, outputSize: output.length, outputSha256: "sha256:" + sha256(output) } : {}),
      secretScan: "pass", piiScan: "pass", redactionRuleVersion: "fixture/v1", completedAt: request.createdAt,
      tool: { name: "fixture-scanner", version: "1", policyDigest: request.policyDigest } };
    const canonical = canonicalJson(payload);
    const signed: BinaryAttestationResponse = { ...payload, signature: { algorithm: "ed25519", keyId: "fixture", signedPayloadDigest: "sha256:" + sha256(canonical), valueBase64: sign(null, Buffer.from(canonical), keys.privateKey).toString("base64") } };
    if (decision === "sanitized") {
      await mkdir(dirname(join(io.root, "outputs", request.outputPath)), { recursive: true });
      await writeFile(join(io.root, "outputs", request.outputPath), output);
    }
    await io.write(`attestations/requests/${request.requestId}.json`, request);
    const saved = await io.write(`attestations/responses/${request.requestId}.json`, signed);
    const receipt: AttestationReceipt = { schemaVersion: "lakda/binary-attestation-receipt/v1", requestId: request.requestId, requestSha256: attestationRequestDigest(request),
      runId: request.runId, targetManifestSha256: request.targetManifestSha256, status: "response-verified", reason: null,
      responseSha256: saved.sha256, receivedAt: request.createdAt, finishedAt: request.createdAt };
    await io.write(`attestations/receipts/${request.requestId}.json`, receipt);
    return { signed, receipt, output };
  }
  return { root, run, io, source, request, context, response };
}

test("quarantine removes raw from the run only after preserving verified private bytes", async () => {
  const value = await fixture();
  await quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024 });
  expect(await readFile(join(value.io.root, "sources", value.request.sourcePath))).toEqual(value.source);
  await expect(readFile(join(value.run, value.request.sourcePath))).rejects.toThrow(/ENOENT/);
});

test("sanitized adoption keeps only the signed output in the run and cannot be repeated", async () => {
  const value = await fixture(); await quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024 });
  const proof = await value.response();
  const adopted = await adoptAttestationMedia(value.io, value.request, proof.signed, proof.receipt, value.context, { maxBytes: 1_024 });
  expect(adopted).toEqual({ path: value.request.outputPath, size: proof.output.length, sha256: "sha256:" + sha256(proof.output) });
  expect(await readFile(join(value.run, adopted.path))).toEqual(proof.output);
  await expect(readFile(join(value.run, value.request.sourcePath))).rejects.toThrow(/ENOENT/);
  expect(await readFile(join(value.io.root, "sources", value.request.sourcePath))).toEqual(value.source);
  await expect(adoptAttestationMedia(value.io, value.request, proof.signed, proof.receipt, value.context, { maxBytes: 1_024 })).rejects.toThrow(/adoption-already-claimed/);
});

test("no-sensitive-content adopts exactly the inspected source at its original path", async () => {
  const value = await fixture(); await quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024 });
  const proof = await value.response("no-sensitive-content");
  const adopted = await adoptAttestationMedia(value.io, value.request, proof.signed, proof.receipt, value.context, { maxBytes: 1_024 });
  expect(adopted.path).toBe(value.request.sourcePath); expect(await readFile(join(value.run, adopted.path))).toEqual(value.source);
  await expect(readFile(join(value.run, value.request.outputPath))).rejects.toThrow(/ENOENT/);
});

test("an original that changed before quarantine is preserved without publishing a private final file", async () => {
  const value = await fixture(); const changed = Buffer.alloc(value.source.length, 33); await writeFile(join(value.run, value.request.sourcePath), changed);
  await expect(quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024 })).rejects.toThrow();
  expect(await readFile(join(value.run, value.request.sourcePath))).toEqual(changed);
  await expect(readFile(join(value.io.root, "sources", value.request.sourcePath))).rejects.toThrow(/ENOENT/);
});

test("a valid response cannot adopt changed output or changed quarantined source", async () => {
  for (const area of ["sources", "outputs"]) {
    const value = await fixture(); await quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024 }); const proof = await value.response();
    await writeFile(join(value.io.root, area, area === "sources" ? value.request.sourcePath : value.request.outputPath), Buffer.alloc(area === "sources" ? value.source.length : proof.output.length, 33));
    await expect(adoptAttestationMedia(value.io, value.request, proof.signed, proof.receipt, value.context, { maxBytes: 1_024 })).rejects.toThrow();
    await expect(readFile(join(value.run, value.request.outputPath))).rejects.toThrow(/ENOENT/);
  }
});

test("adoption rechecks the stored response and receipt instead of trusting an accepted type", async () => {
  const value = await fixture(); await quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024 }); const proof = await value.response();
  await writeFile(join(value.io.root, "attestations/responses", value.request.requestId + ".json"), canonicalJson({ ...proof.signed, completedAt: "2026-01-01T00:00:00.000Z" }) + "\n");
  await expect(adoptAttestationMedia(value.io, value.request, proof.signed, proof.receipt, value.context, { maxBytes: 1_024 })).rejects.toThrow(/response-changed/);
  await expect(readFile(join(value.run, value.request.outputPath))).rejects.toThrow(/ENOENT/);
});

test("adoption refuses an existing output or sealed run and preserves private source", async () => {
  for (const kind of ["existing", "sealed"]) {
    const value = await fixture(); await quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024 }); const proof = await value.response();
    if (kind === "sealed") { await mkdir(join(value.run, "exports")); await writeFile(join(value.run, "exports/artifact-manifest.json"), "{}"); }
    else { await mkdir(dirname(join(value.run, value.request.outputPath)), { recursive: true }); await writeFile(join(value.run, value.request.outputPath), "existing"); }
    await expect(adoptAttestationMedia(value.io, value.request, proof.signed, proof.receipt, value.context, { maxBytes: 1_024 })).rejects.toThrow(kind === "sealed" ? /run-sealed/ : /media-already-exists/);
    if (kind === "existing") expect(await readFile(join(value.run, value.request.outputPath), "utf8")).toBe("existing");
    expect(await readFile(join(value.io.root, "sources", value.request.sourcePath))).toEqual(value.source);
  }
});

test("quarantine enforces byte limits and an aborted copy retains the original", async () => {
  const value = await fixture(Buffer.alloc(262_144, 42));
  await expect(quarantineAttestationSource(value.io, value.request, { maxBytes: 1 })).rejects.toThrow(/media-byte-limit/);
  const controller = new AbortController(); let checks = 0;
  await expect(quarantineAttestationSource(value.io, value.request, { maxBytes: 524_288, signal: controller.signal, check: async () => { if (++checks === 4) controller.abort(); } })).rejects.toThrow();
  expect(await readFile(join(value.run, value.request.sourcePath))).toEqual(value.source);
  await expect(readFile(join(value.io.root, "sources", value.request.sourcePath))).rejects.toThrow(/ENOENT/);
});

test("a source changed after its final digest check is not deleted", async () => {
  const value = await fixture(); let originalVerified = false;
  const read = value.io.readMedia.bind(value.io);
  value.io.readMedia = async (...args) => {
    const snapshot = await read(...args);
    if (args[0] === "retained" && args[1] === value.request.sourcePath) originalVerified = true;
    return snapshot;
  };
  const changed = Buffer.alloc(value.source.length, 43);
  await expect(quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024, check: async () => {
    if (originalVerified) { originalVerified = false; await writeFile(join(value.run, value.request.sourcePath), changed); }
  } })).rejects.toThrow(/media-bytes-changed|mismatch/);
  const preserved = await readFile(join(value.run, value.request.sourcePath)).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readFile(join(value.io.root, "originals", value.request.requestId, value.request.sourcePath));
  });
  expect(preserved).toEqual(changed);
  expect(await readFile(join(value.io.root, "sources", value.request.sourcePath))).toEqual(value.source);
});

test("stop or expiry at the final adoption check removes only the newly copied output", async () => {
  for (const kind of ["stop", "expiry"]) {
    const value = await fixture(); await quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024 }); const proof = await value.response();
    const controller = new AbortController(); let now = Date.parse(value.request.createdAt) + 1;
    await expect(adoptAttestationMedia(value.io, value.request, proof.signed, proof.receipt, value.context, {
      maxBytes: 1_024, signal: controller.signal, clock: () => now, check: async () => {
        try { await readFile(join(value.run, value.request.outputPath)); } catch { return; }
        if (kind === "stop") controller.abort(); else now = Date.parse(value.request.expiresAt);
      },
    })).rejects.toThrow();
    await expect(readFile(join(value.run, value.request.outputPath))).rejects.toThrow(/ENOENT/);
    expect(await readFile(join(value.io.root, "sources", value.request.sourcePath))).toEqual(value.source);
  }
});

test("stop and expiry interrupt quarantine and adoption rereads without deleting original evidence", async () => {
  for (const phase of ["quarantine-private", "quarantine-original", "adopt-source", "adopt-output"] as const) for (const reason of ["stop", "expiry"] as const) {
    const value = await fixture(Buffer.alloc(262_144, 42)), adoption = phase.startsWith("adopt-");
    if (adoption) await quarantineAttestationSource(value.io, value.request, { maxBytes: 524_288 });
    const proof = adoption ? await value.response("sanitized", Buffer.alloc(262_144, 43)) : undefined;
    const targetArea = phase === "quarantine-private" || phase === "adopt-source" ? "source" : "retained";
    const targetRef = phase === "adopt-output" ? value.request.outputPath : value.request.sourcePath;
    const read = value.io.readMedia.bind(value.io), controller = new AbortController();
    let active = false, checks = 0, now = Date.parse(value.request.createdAt) + 1, stoppedAt = 0;
    value.io.readMedia = async (...args) => {
      active = args[0] === targetArea && args[1] === targetRef;
      try { return await read(...args); } finally { active = false; }
    };
    const options = { maxBytes: 524_288, signal: controller.signal, clock: () => now, check: async () => {
      if (active && ++checks === 4) { stoppedAt = performance.now(); if (reason === "stop") controller.abort(); else now = Date.parse(value.request.expiresAt); }
    } };
    const operation = adoption ? adoptAttestationMedia(value.io, value.request, proof!.signed, proof!.receipt, value.context, options)
      : quarantineAttestationSource(value.io, value.request, options);
    await expect(operation, phase + ":" + reason).rejects.toThrow();
    expect(stoppedAt).toBeGreaterThan(0); expect(performance.now() - stoppedAt).toBeLessThan(1000);
    if (adoption) {
      expect(await readFile(join(value.io.root, "sources", value.request.sourcePath))).toEqual(value.source);
      await expect(readFile(join(value.run, value.request.outputPath))).rejects.toThrow(/ENOENT/);
    } else expect(await readFile(join(value.run, value.request.sourcePath))).toEqual(value.source);
  }
});

test("a junction substituted for a retained directory is not followed during adoption", async () => {
  const value = await fixture(); await quarantineAttestationSource(value.io, value.request, { maxBytes: 1_024 }); const proof = await value.response();
  const original = join(value.run, "artifacts"), moved = join(value.root, "moved-artifacts");
  await rename(original, moved); await symlink(moved, original, "junction");
  await expect(adoptAttestationMedia(value.io, value.request, proof.signed, proof.receipt, value.context, { maxBytes: 1_024 })).rejects.toThrow(/directory-invalid/);
  await expect(readFile(join(moved, "attested", basename(value.request.outputPath)))).rejects.toThrow(/ENOENT/);
});

test("exchange stages the source before issuing a request and retains the response's output", async () => {
  const value = await fixture();
  const exchange = await createAttestationExchange({ stagingRoot: value.root, runDirectory: value.run, request: value.request, context: value.context });
  await exchange.stage(value.request, 1_024);
  expect(await readFile(join(exchange.directory, "sources", value.request.sourcePath))).toEqual(value.source);
  expect(JSON.parse(await readFile(join(exchange.directory, "attestations/requests", value.request.requestId + ".json"), "utf8"))).toEqual(value.request);
  const proof = await value.response();
  await writeFile(join(exchange.directory, "outputs", value.request.outputPath), proof.output, { flag: "wx" });
  await writeFile(join(exchange.directory, "attestations/responses", value.request.requestId + ".json"), canonicalJson(proof.signed) + "\n", { flag: "wx" });
  const result = await exchange.retain(value.request.requestId, 1_024);
  expect(result.adoption).toBe("adopted");
  if (result.adoption !== "adopted") throw new Error("expected adoption");
  expect(result.artifact.path).toBe(value.request.outputPath);
  expect(await readFile(join(value.run, result.artifact.path))).toEqual(proof.output);
  const published = await exchange.exportRetained(1_048_576);
  expect(published.map(file => file.path).sort()).toEqual(["attestations/binary-artifacts.jsonl", `attestations/receipts/${value.request.requestId}.json`, `attestations/results/${value.request.requestId}.json`]);
  expect(await readFile(join(value.run, "attestations/binary-artifacts.jsonl"), "utf8")).toBe(canonicalJson(proof.signed) + "\n");
  expect(await readFile(join(value.run, "attestations/receipts", value.request.requestId + ".json"), "utf8")).toBe(canonicalJson(result.receipt) + "\n");
  await expect(exchange.exportRetained(1_048_576)).rejects.toThrow(/already-exported/);
});

test("a stop between response verification and retention remains a separate adoption failure", async () => {
  const value = await fixture(); let armed = false, polls = 0;
  const exchange = await createAttestationExchange({ stagingRoot: value.root, runDirectory: value.run, request: value.request, context: value.context,
    shouldStop: () => armed && ++polls >= 4 });
  await exchange.stage(value.request, 1_024); const proof = await value.response();
  await writeFile(join(exchange.directory, "outputs", value.request.outputPath), proof.output, { flag: "wx" });
  await writeFile(join(exchange.directory, "attestations/responses", value.request.requestId + ".json"), canonicalJson(proof.signed) + "\n", { flag: "wx" });
  armed = true;
  const result = await exchange.retain(value.request.requestId, 1_024);
  expect(result.receipt.status).toBe("response-verified"); expect(result.adoption).toBe("failed"); expect(result.reason).toBe("request-cancelled");
  await expect(readFile(join(value.run, value.request.outputPath))).rejects.toThrow(/ENOENT/);
  expect(await readFile(join(exchange.directory, "sources", value.request.sourcePath))).toEqual(value.source);
});

test("timeout diagnostics can be exported after the deadline without adopting late media", async () => {
  const value = await fixture(); let elapsed = 0;
  const exchange = await createAttestationExchange({ stagingRoot: value.root, runDirectory: value.run, request: value.request, context: value.context,
    monotonic: () => elapsed, wait: async ms => { elapsed += ms; } });
  await exchange.stage(value.request, 1_024);
  expect((await exchange.retain(value.request.requestId, 1_024)).receipt.status).toBe("timeout");
  const published = await exchange.exportRetained(1_048_576);
  expect(published.map(file => file.path)).toEqual([`attestations/receipts/${value.request.requestId}.json`, `attestations/results/${value.request.requestId}.json`]);
  await expect(readFile(join(value.run, "attestations/binary-artifacts.jsonl"))).rejects.toThrow(/ENOENT/);
  expect(await readFile(join(exchange.directory, "sources", value.request.sourcePath))).toEqual(value.source);
});

test("diagnostic publication can stop during private-source verification after receipt timeout", async () => {
  const value = await fixture(Buffer.alloc(262_144, 42)); let elapsed = 0;
  const exchange = await createAttestationExchange({ stagingRoot: value.root, runDirectory: value.run, request: value.request, context: value.context,
    monotonic: () => elapsed, wait: async ms => { elapsed += ms; } }, value.io);
  await exchange.stage(value.request, 524_288);
  expect((await exchange.retain(value.request.requestId, 524_288)).receipt.status).toBe("timeout");
  const read = value.io.readMedia.bind(value.io), stopped = new Error("publication-stop"); let active = false, checks = 0, stoppedAt = 0;
  value.io.readMedia = async (...args) => { active = args[0] === "source"; try { return await read(...args); } finally { active = false; } };
  await expect(exchange.exportRetained(524_288, { check: async () => {
    if (active && ++checks === 4) { stoppedAt = performance.now(); throw stopped; }
  } })).rejects.toBe(stopped);
  expect(performance.now() - stoppedAt).toBeLessThan(1000);
  expect(await readFile(join(value.io.root, "sources", value.request.sourcePath))).toEqual(value.source);
  await expect(readFile(join(value.run, "attestations/receipts", value.request.requestId + ".json"))).rejects.toThrow(/ENOENT/);
});

test("exchange publication enforces its own budget and stop policy without caller overrides", async () => {
  for (const reason of ["expired", "stop"] as const) {
    const value = await fixture(Buffer.alloc(262_144, 42)); let elapsed = 0, publication = false, checks = 0, stopped = false;
    const exchange = await createAttestationExchange({ stagingRoot: value.root, runDirectory: value.run, request: value.request, context: value.context,
      clock: () => Date.parse(value.request.createdAt), monotonic: () => elapsed, wait: async ms => { elapsed += ms; }, shouldStop: () => {
        if (publication && ++checks === 4) { if (reason === "expired") elapsed += 30_000; else stopped = true; }
        return stopped;
      } }, value.io);
    await exchange.stage(value.request, 524_288); await exchange.retain(value.request.requestId, 524_288);
    const read = value.io.readMedia.bind(value.io);
    value.io.readMedia = async (...args) => { publication = args[0] === "source"; try { return await read(...args); } finally { publication = false; } };
    await expect(exchange.exportRetained(524_288)).rejects.toThrow(reason === "expired" ? /publication-expired/ : /request-cancelled/);
    expect(await readFile(join(value.io.root, "sources", value.request.sourcePath))).toEqual(value.source);
    await expect(readFile(join(value.run, "attestations/receipts", value.request.requestId + ".json"))).rejects.toThrow(/ENOENT/);
  }
});

test("publication detects changes to adopted bytes before writing any public proof", async () => {
  const value = await fixture();
  const exchange = await createAttestationExchange({ stagingRoot: value.root, runDirectory: value.run, request: value.request, context: value.context });
  await exchange.stage(value.request, 1_024); const proof = await value.response();
  await writeFile(join(exchange.directory, "outputs", value.request.outputPath), proof.output, { flag: "wx" });
  await writeFile(join(exchange.directory, "attestations/responses", value.request.requestId + ".json"), canonicalJson(proof.signed) + "\n", { flag: "wx" });
  expect((await exchange.retain(value.request.requestId, 1_024)).adoption).toBe("adopted");
  await writeFile(join(value.run, value.request.outputPath), Buffer.alloc(proof.output.length, 33));
  await expect(exchange.exportRetained(1_048_576)).rejects.toThrow();
  await expect(readFile(join(value.run, "attestations/receipts", value.request.requestId + ".json"))).rejects.toThrow(/ENOENT/);
});

test("timeout publication requires unchanged quarantine and no public raw alias", async () => {
  for (const damage of ["quarantine", "alias"] as const) {
    const value = await fixture(); let elapsed = 0;
    const exchange = await createAttestationExchange({ stagingRoot: value.root, runDirectory: value.run, request: value.request, context: value.context,
      monotonic: () => elapsed, wait: async ms => { elapsed += ms; } });
    await exchange.stage(value.request, 1_024); await exchange.retain(value.request.requestId, 1_024);
    if (damage === "quarantine") await writeFile(join(exchange.directory, "sources", value.request.sourcePath), Buffer.alloc(value.source.length, 33));
    else await writeFile(join(value.run, "artifacts/alias.png"), value.source);
    await expect(exchange.exportRetained(1_048_576)).rejects.toThrow();
    await expect(readFile(join(value.run, "attestations/receipts", value.request.requestId + ".json"))).rejects.toThrow(/ENOENT/);
  }
});

test("sanitized publication rejects another retained name for the original bytes", async () => {
  const value = await fixture();
  const exchange = await createAttestationExchange({ stagingRoot: value.root, runDirectory: value.run, request: value.request, context: value.context });
  await exchange.stage(value.request, 1_024); const proof = await value.response();
  await writeFile(join(exchange.directory, "outputs", value.request.outputPath), proof.output, { flag: "wx" });
  await writeFile(join(exchange.directory, "attestations/responses", value.request.requestId + ".json"), canonicalJson(proof.signed) + "\n", { flag: "wx" });
  expect((await exchange.retain(value.request.requestId, 1_024)).adoption).toBe("adopted");
  await writeFile(join(value.run, "artifacts/alias.png"), value.source);
  await expect(exchange.exportRetained(1_048_576)).rejects.toThrow(/raw-media-retained/);
  await expect(readFile(join(value.run, "attestations/binary-artifacts.jsonl"))).rejects.toThrow(/ENOENT/);
});
