import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { canonicalJson } from "../src/core/plan.js";
import { sha256 } from "../src/core/redaction.js";
import { createAttestationRequest, attestationRequestDigest } from "../src/exploration/attestation-contracts.js";
import { createAttestationExchange, type AttestationExchangeOptions } from "../src/exploration/attestation-exchange.js";

const directories: string[] = [];
test.afterEach(async () => {
  for (const root of directories.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("lakda-attestation-exchange-")) throw new Error("unexpected fixture root");
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(overrides: Partial<AttestationExchangeOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), "lakda-attestation-exchange-")); directories.push(root);
  const runDirectory = join(root, "run"); await mkdir(runDirectory);
  const now = Date.now(), keys = generateKeyPairSync("ed25519");
  const request = createAttestationRequest({ runId: "run-fixture", targetManifestSha256: "sha256:" + "a".repeat(64),
    sourcePath: "artifacts/failure.png", sourceSize: 12, sourceSha256: "sha256:" + "b".repeat(64),
    policyDigest: "sha256:" + "c".repeat(64), mediaType: "image/png" }, { now, timeoutMs: 5_000 });
  const context = { allowedKeyIds: ["fixture"], trustKeys: [{ keyId: "fixture", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }] };
  const exchange = await createAttestationExchange({ stagingRoot: root, runDirectory, request, context, ...overrides });
  const payload = { schemaVersion: "lakda/binary-artifact-attestation/v2", request, requestSha256: attestationRequestDigest(request),
    sourcePath: request.sourcePath, sourceSize: request.sourceSize, sourceSha256: request.sourceSha256, decision: "no-sensitive-content",
    secretScan: "pass", piiScan: "pass", redactionRuleVersion: "fixture/v1", completedAt: new Date(now).toISOString(),
    tool: { name: "fixture-scanner", version: "1", policyDigest: request.policyDigest } };
  const canonical = canonicalJson(payload);
  const response = { ...payload, signature: { algorithm: "ed25519", keyId: "fixture", signedPayloadDigest: "sha256:" + sha256(canonical), valueBase64: sign(null, Buffer.from(canonical), keys.privateKey).toString("base64") } };
  const responsePath = join(exchange.directory, "attestations/responses", request.requestId + ".json");
  async function publishResponse(bytes = canonicalJson(response) + "\n") {
    const temporary = responsePath + ".tmp";
    await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, responsePath);
  }
  return { root, runDirectory, request, response, context, exchange, publishResponse };
}

test("an exchange inherits the inventory's earlier monotonic deadline without renewing it", async () => {
  let mono = 100;
  const value = await fixture({ monotonic: () => mono, monotonicDeadline: 500 });
  mono = 500;
  await expect(value.exchange.publish(value.request)).rejects.toThrow(/request-expired/);
  await expect(readFile(join(value.exchange.directory, "attestations/requests", value.request.requestId + ".json"))).rejects.toThrow(/ENOENT/);
});

test("request and verified-response receipt are immutable, separate from the public run", async () => {
  const value = await fixture();
  await value.exchange.publish(value.request);
  const requestPath = join(value.exchange.directory, "attestations/requests", value.request.requestId + ".json");
  expect(await readFile(requestPath, "utf8")).toBe(canonicalJson(value.request) + "\n");
  await expect(value.exchange.publish(value.request)).rejects.toThrow(/already-published/);
  await value.publishResponse();
  const result = await value.exchange.receive(value.request.requestId);
  expect(result.receipt.status).toBe("response-verified");
  expect(result.response).toEqual(value.response);
  const saved = JSON.parse(await readFile(join(value.exchange.directory, "attestations/receipts", value.request.requestId + ".json"), "utf8"));
  expect(saved).toEqual(result.receipt);
  expect(saved.responseSha256).toBe("sha256:" + sha256(canonicalJson(value.response) + "\n"));
  await expect(value.exchange.receive(value.request.requestId)).rejects.toThrow(/already-claimed/);
});

test("two concurrent receivers cannot consume the same response twice", async () => {
  const value = await fixture(); await value.exchange.publish(value.request); await value.publishResponse();
  const results = await Promise.allSettled([value.exchange.receive(value.request.requestId), value.exchange.receive(value.request.requestId)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
});

test("incomplete or noncanonical response files are rejected without losing the request", async () => {
  for (const text of ["{", "{}\n", "{\"schemaVersion\":\"unknown\"}\n"]) {
    const value = await fixture(); await value.exchange.publish(value.request); await value.publishResponse(text);
    const result = await value.exchange.receive(value.request.requestId);
    expect(result.receipt.status).toBe("rejected"); expect(result.receipt.reason).toBe("response-invalid");
    expect(result.response).toBeUndefined();
  }
});

test("changing a published request is detected before accepting a response", async () => {
  const value = await fixture(); await value.exchange.publish(value.request); await value.publishResponse();
  await writeFile(join(value.exchange.directory, "attestations/requests", value.request.requestId + ".json"), canonicalJson(value.request) + "\n\n");
  await expect(value.exchange.receive(value.request.requestId)).rejects.toThrow(/request-changed/);
});

test("deadline applies to the exchange and missing responses remain timed out", async () => {
  let elapsed = 0;
  const value = await fixture({ monotonic: () => elapsed, wait: async ms => { elapsed += ms; } });
  await value.exchange.publish(value.request);
  const result = await value.exchange.receive(value.request.requestId);
  expect(result.receipt.status).toBe("timeout"); expect(result.response).toBeUndefined();
  expect(elapsed).toBeLessThanOrEqual(5_000);
});

test("an abort stops response waiting within one second", async () => {
  const controller = new AbortController();
  const value = await fixture({ signal: controller.signal }); await value.exchange.publish(value.request);
  const started = performance.now();
  const pending = value.exchange.receive(value.request.requestId);
  controller.abort();
  const result = await pending;
  expect(result.receipt.status).toBe("cancelled"); expect(performance.now() - started).toBeLessThan(1_000);
});

test("a finalized run cannot issue a new request", async () => {
  const value = await fixture(); await mkdir(join(value.runDirectory, "exports"));
  await writeFile(join(value.runDirectory, "exports/artifact-manifest.json"), "{}\n");
  await expect(value.exchange.publish(value.request)).rejects.toThrow(/run-sealed/);
});

test("a stop or deadline reached during response verification prevents acceptance", async () => {
  for (const status of ["cancelled", "timeout"]) {
    let polls = 0, elapsed = 0, armed = false;
    const value = await fixture({ monotonic: () => elapsed, shouldStop: () => {
      if (!armed || ++polls < 3) return false;
      if (status === "timeout") elapsed = 6_000;
      return status === "cancelled";
    } });
    await value.exchange.publish(value.request); await value.publishResponse(); armed = true;
    const result = await value.exchange.receive(value.request.requestId);
    expect(result.receipt.status).toBe(status); expect(result.response).toBeUndefined();
  }
});

test("multiple media share one deadline and an expired exchange cannot be extended", async () => {
  let elapsed = 0;
  const value = await fixture({ monotonic: () => elapsed, wait: async ms => { elapsed += ms; } });
  const next = createAttestationRequest({ runId: value.request.runId, targetManifestSha256: value.request.targetManifestSha256,
    sourcePath: "artifacts/second.png", sourceSize: 12, sourceSha256: value.request.sourceSha256,
    policyDigest: value.request.policyDigest, mediaType: "image/png" }, { now: Date.parse(value.request.createdAt), timeoutMs: 5_000 });
  await value.exchange.publish(value.request); await value.exchange.publish(next);
  expect((await value.exchange.receive(value.request.requestId)).receipt.status).toBe("timeout");
  const afterFirst = elapsed;
  expect((await value.exchange.receive(next.requestId)).receipt.status).toBe("timeout");
  expect(elapsed).toBe(afterFirst);
  await expect(value.exchange.publish({ ...next, runId: "other-run" })).rejects.toThrow(/binding-mismatch/);
});

test("a correctly signed response still requires canonical file bytes", async () => {
  const value = await fixture(); await value.exchange.publish(value.request);
  await value.publishResponse(JSON.stringify(value.response, null, 2) + "\n");
  const result = await value.exchange.receive(value.request.requestId);
  expect(result.receipt.status).toBe("rejected"); expect(result.receipt.reason).toBe("response-invalid");
});

test("private exchange files cannot be created inside the public run", async () => {
  const value = await fixture();
  await expect(createAttestationExchange({ stagingRoot: value.runDirectory, runDirectory: value.runDirectory,
    request: value.request, context: value.context })).rejects.toThrow(/private-staging-inside-run/);
});
