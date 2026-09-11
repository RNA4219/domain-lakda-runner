import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { LoopbackJsonBridge } from "../src/adapters/loopback-json.js";
import { assertNativeCaptureRequest, validateNativeCaptureResult, type NativeCaptureRequest } from "../src/exploration/native-identity-capture.js";
import { nativeIdentityDigest } from "../src/exploration/native-identity-contracts.js";

function request(): NativeCaptureRequest {
  return { schemaVersion: "lakda/native-capture-request/v1", operation: "screenshot", ordinal: 1, captureOrdinal: 1,
    lease: { observationId: randomUUID(), observationDigest: "sha256:" + "a".repeat(64), connectionId: randomUUID(), challenge: randomUUID() },
    approvalWindow: { targetManifestSha256: "sha256:" + "b".repeat(64), validFrom: "2020-01-01T00:00:00.000Z", validUntil: "2020-01-02T00:00:00.000Z" },
    payload: { runId: "fixture-run", stagingDir: "C:/fixture/run" } };
}

test("native capture contract has independent ordinals and permits the expired window needed for cleanup", () => {
  const value = request();
  expect(() => assertNativeCaptureRequest(value)).not.toThrow();
  const stop: NativeCaptureRequest = { ...value, operation: "stop", ordinal: 3, captureOrdinal: 1,
    payload: { ...value.payload, mode: "video", stopTimeoutMs: 500 } };
  expect(() => assertNativeCaptureRequest(stop)).not.toThrow();
  for (const mutate of [() => { stop.captureOrdinal = 4; }, () => { Object.assign(stop, { privatePath: "canary" }); },
    () => { stop.payload.stopTimeoutMs = 300001; }, () => { stop.approvalWindow.validUntil = stop.approvalWindow.validFrom; }]) {
    const copy = structuredClone(stop); mutate();
    expect(() => assertNativeCaptureRequest(stop)).toThrow(/capture-request-invalid/);
    Object.keys(stop).forEach(key => { delete (stop as unknown as Record<string, unknown>)[key]; }); Object.assign(stop, copy);
  }
});

test("native capture receipts must bind the complete request and cannot publish failed or unstopped captures", () => {
  const value: NativeCaptureRequest = { ...request(), operation: "start", payload: { runId: "fixture-run", stagingDir: "C:/fixture/run", mode: "video" } };
  const result = { schemaVersion: "lakda/native-capture-result/v1", operation: "start", ordinal: 1, captureOrdinal: 1,
    requestSha256: nativeIdentityDigest(value), completedAt: new Date().toISOString(), result: { accepted: true, mode: "video", artifactRefs: [] } };
  expect(() => validateNativeCaptureResult(result, value)).not.toThrow();
  for (const changes of [{ ordinal: 2 }, { captureOrdinal: 2 }, { requestSha256: "sha256:" + "f".repeat(64) },
    { completedAt: "not-a-time" }, { privatePath: "canary" }, { result: { ...result.result, artifactRefs: [{}] } },
    { result: { ...result.result, stopped: true } }]) {
    expect(() => validateNativeCaptureResult({ ...result, ...changes }, value)).toThrow(/capture-response-invalid/);
  }
  const stop: NativeCaptureRequest = { ...value, operation: "stop", ordinal: 2, payload: { ...value.payload, stopTimeoutMs: 500 } };
  const receipt = { ...result, operation: "stop", ordinal: 2, requestSha256: nativeIdentityDigest(stop) };
  expect(() => validateNativeCaptureResult(receipt, stop)).toThrow(/capture-response-invalid/);
  expect(() => validateNativeCaptureResult({ ...receipt, result: { accepted: false, mode: "video", stopped: false,
    reason: "native-capture-stop-timeout", artifactRefs: [] } }, stop)).not.toThrow();
});

test("native capture transport snapshots caller input before asynchronous work and does not retry", async () => {
  const calls: NativeCaptureRequest[] = [];
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []; incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      outgoing.setHeader("content-type", "application/json");
      if (incoming.url === "/capabilities") {
        outgoing.end(JSON.stringify({ schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "fixture",
          platform: "android", targetKinds: ["device"], actionKinds: [], observationCapabilities: [], evidenceCapabilities: [],
          recoveryStrategies: [], liveness: { connected: true, responsive: true } })); return;
      }
      const value = JSON.parse(Buffer.concat(chunks).toString()) as NativeCaptureRequest; calls.push(value);
      outgoing.end(JSON.stringify({ schemaVersion: "lakda/native-capture-result/v1", operation: value.operation, ordinal: value.ordinal,
        captureOrdinal: value.captureOrdinal, requestSha256: nativeIdentityDigest(value), completedAt: new Date().toISOString(),
        result: { accepted: false, mode: "screenshot", artifactRefs: [], reason: "fixture-refused" } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const bridge = await LoopbackJsonBridge.connect(base, "airtest-poco"), value = request();
    const pending = bridge.nativeCapture(value); value.payload.runId = "changed-after-call";
    expect((await pending).result.accepted).toBe(false);
    expect(calls).toHaveLength(1); expect(calls[0]!.payload.runId).toBe("fixture-run");
    await expect(bridge.nativeCapture({ ...request(), ordinal: 0 })).rejects.toThrow(/capture-request-invalid/);
    expect(calls).toHaveLength(1);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
});
