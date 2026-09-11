import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { mock } from "node:test";
import { LoopbackJsonBridge } from "../src/adapters/loopback-json.js";
import type { NativeActionRequest, NativeActionResult } from "../src/exploration/native-identity-actions.js";

const caps = { schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "fixture", targetRevision: "fixture-build",
  platform: "android", targetKinds: ["device"], actionKinds: ["tap"], observationCapabilities: [], evidenceCapabilities: [], recoveryStrategies: [],
  liveness: { connected: true, responsive: true } };

test("stored receipt expectations omit the request payload and verify candidate, lease and window", async () => {
  const api = await import("../src/exploration/native-identity-actions.js");
  const input = windowedRequest(), started = Date.now();
  if (input.operation !== "execute") throw new Error("fixture operation");
  input.payload.candidate.locatorRecipe.value = "fixture-private-locator";
  const expectation = api.nativeActionReceiptExpectation(input);
  expect(JSON.stringify(expectation)).not.toContain("fixture-private-locator");
  expect(expectation).not.toHaveProperty("payload");
  const receipt = structuredClone(response(input));
  expect(api.validateNativeActionReceiptExpectation(expectation, receipt, started)).toEqual(receipt);
  input.lease.challenge = "00000000-0000-4000-8000-000000000009";
  expect(api.validateNativeActionReceiptExpectation(expectation, receipt, started)).toEqual(receipt);
  for (const field of ["candidate", "lease", "window"]) {
    const changed = structuredClone(receipt);
    if (field === "candidate" && changed.operation === "execute") changed.result.candidateId = "other";
    if (field === "lease") changed.lease.challenge = input.lease.challenge;
    if (field === "window" && changed.schemaVersion === "lakda/native-action-result/v2") changed.approvalWindow.targetManifestSha256 = "sha256:" + "f".repeat(64);
    expect(() => api.validateNativeActionReceiptExpectation(expectation, changed, started)).toThrow();
  }
});

test("native timestamp deferral keeps the existing abort budget and does not wait for distant timestamps", async () => {
  const { waitForNativeTimestamp } = await import("../src/exploration/native-identity-exchange.js");
  const fixed = Date.now(), clock = mock.method(Date, "now", () => fixed);
  try {
    for (const ahead of [1, 5, 20]) {
      const controller = new AbortController();
      const near = waitForNativeTimestamp(fixed + ahead, controller.signal);
      controller.abort();
      await expect(near).rejects.toThrow();
    }
    for (const ahead of [-1, 0, 21, 1000]) {
      await expect(waitForNativeTimestamp(fixed + ahead, AbortSignal.abort())).resolves.toBeUndefined();
    }
  } finally { clock.mock.restore(); }
});

test("timestamp deferral never changes future or pre-request receipts into valid evidence", async () => {
  const { waitForNativeTimestamp } = await import("../src/exploration/native-identity-exchange.js");
  const { validateNativeActionReceipt } = await import("../src/exploration/native-identity-actions.js");
  const fixed = Date.now(), input = request(), receipt = response(input);
  const clock = mock.method(Date, "now", () => fixed);
  try {
    for (const offset of [5, -1]) {
      receipt.checkedAt = new Date(fixed + offset).toISOString();
      await waitForNativeTimestamp(fixed + offset, AbortSignal.timeout(1000));
      expect(() => validateNativeActionReceipt(input, receipt, fixed)).toThrow(/action-response-mismatch/);
      expect(receipt.checkedAt).toBe(new Date(fixed + offset).toISOString());
    }
  } finally { clock.mock.restore(); }
});
const request = (): NativeActionRequest => ({
  schemaVersion: "lakda/native-action-request/v1", operation: "execute", ordinal: 1,
  lease: { observationId: "00000000-0000-4000-8000-000000000001", observationDigest: "sha256:" + "a".repeat(64),
    connectionId: "00000000-0000-4000-8000-000000000002", challenge: "00000000-0000-4000-8000-000000000003" },
  payload: { candidate: { schemaVersion: "lakda/adaptive-contracts/v1", candidateId: "candidate-1", adapterId: "airtest-poco",
    targetRef: { targetId: "fixture-device", kind: "device" }, sourceFingerprint: "source-1", actionKind: "back",
    locatorRecipe: { strategy: "image", value: "back" }, generatedBy: { ruleId: "fixture", observationId: "observation-1", reason: "fixture back" },
    risk: { weight: 1 }, mutationKind: "none" }, context: { runId: "fixture-run", timeoutMs: 1000 } },
});
function response(input: NativeActionRequest): NativeActionResult {
  const version = input.schemaVersion === "lakda/native-action-request/v2"
    ? { schemaVersion: "lakda/native-action-result/v2" as const, approvalWindow: input.approvalWindow }
    : { schemaVersion: "lakda/native-action-result/v1" as const };
  const common = { ...version, lease: input.lease, ordinal: input.ordinal,
    checkedAt: new Date().toISOString(), actionAttempted: true };
  return input.operation === "recover" ? { ...common, operation: "recover", result: { recovered: true, strategy: "back", evidenceRefs: [] } }
    : { ...common, operation: "execute", result: { schemaVersion: "lakda/adaptive-contracts/v1", executionId: "execution-1",
      candidateId: input.payload.candidate.candidateId, preFingerprint: input.payload.candidate.sourceFingerprint,
      startedAt: common.checkedAt, endedAt: common.checkedAt, status: "executed", recoveryStatus: "not_required", targetChanges: [],
      settleResult: { policyVersion: "settle/v1", status: "settled", elapsedMs: 1, reasons: [] }, evidenceRefs: [] } };
}
type Reply = { status?: number; headers?: Record<string, string>; body?: string | Buffer; chunked?: boolean };
function windowedRequest(): NativeActionRequest {
  return { ...request(), schemaVersion: "lakda/native-action-request/v2", approvalWindow: {
    targetManifestSha256: "sha256:" + "e".repeat(64), validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 10000).toISOString(),
  } };
}

test("native action v2 binds the approval window in both operations", async () => {
  const context = await fixture();
  try {
    const first = windowedRequest();
    expect(await context.bridge.nativeAction(first)).toMatchObject({ schemaVersion: "lakda/native-action-result/v2", approvalWindow: first.approvalWindow });
    const second: NativeActionRequest = { ...first, operation: "recover", ordinal: 2,
      payload: { failure: { category: "timeout", messageRef: "failure-1" }, context: { runId: "fixture-run", strategy: "back" } } };
    expect(await context.bridge.nativeAction(second)).toMatchObject({ operation: "recover", approvalWindow: first.approvalWindow, result: { recovered: true } });
  } finally { await context.close(); }
});

test("native action v2 rejects malformed or expired windows before HTTP", async () => {
  const context = await fixture();
  try {
    for (const replacement of [{ validUntil: new Date(Date.now() - 1).toISOString() }, { validFrom: "2026-02-30T00:00:00.000Z" },
      { targetManifestSha256: "private-raw" }, { extra: true }, { validUntil: "2026-09-10T12:00:00Z" }]) {
      const input = windowedRequest();
      Object.assign(input.approvalWindow!, replacement);
      await expect(context.bridge.nativeAction(input)).rejects.toThrow("action-request-invalid");
    }
    expect(context.routes).toEqual(["/operator/capabilities"]);
  } finally { await context.close(); }
});

test("native action v2 refuses changed windows and response version downgrade", async () => {
  for (const mode of ["digest", "expiry", "version"]) {
    const context = await fixture((_input, result) => {
      const changed = structuredClone(result) as unknown as Record<string, unknown>;
      if (mode === "version") { changed.schemaVersion = "lakda/native-action-result/v1"; delete changed.approvalWindow; }
      else (changed.approvalWindow as Record<string, unknown>)[mode === "digest" ? "targetManifestSha256" : "validUntil"] = mode === "digest" ? "sha256:" + "f".repeat(64) : new Date(Date.now() + 20000).toISOString();
      return { body: JSON.stringify(changed) };
    });
    try { await expect(context.bridge.nativeAction(windowedRequest())).rejects.toThrow("action-response-mismatch"); }
    finally { await context.close(); }
  }
});
async function fixture(reply: (input: NativeActionRequest, result: NativeActionResult) => Reply | Promise<Reply> = () => ({})) {
  const routes: string[] = [];
  const server = createServer(async (incoming, outgoing) => {
    routes.push(incoming.url!);
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const value = JSON.parse(Buffer.concat(chunks).toString()) as NativeActionRequest;
    if (incoming.url === "/operator/capabilities") {
      outgoing.writeHead(200, { "content-type": "application/json" }); outgoing.end(JSON.stringify(caps)); return;
    }
    const result = response(value), custom = await reply(value, result);
    outgoing.writeHead(custom.status ?? 200, { "content-type": "application/json", ...custom.headers });
    const body = custom.body ?? JSON.stringify(result);
    if (custom.chunked) { outgoing.write(body); outgoing.end(" ".repeat(65536)); } else outgoing.end(body);
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture listener unavailable");
  const bridge = await LoopbackJsonBridge.connect("http://127.0.0.1:" + address.port + "/operator/", "airtest-poco");
  return { bridge, routes, close: async () => { server.closeAllConnections(); await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); } };
}

test("native action receipts bind execution and recovery to the sent lease and ordinal", async () => {
  const context = await fixture();
  try {
    const first = request();
    expect(await context.bridge.nativeAction(first)).toMatchObject({ ordinal: 1, lease: first.lease, actionAttempted: true, result: { status: "executed" } });
    const recovery: NativeActionRequest = { ...first, operation: "recover", ordinal: 2,
      payload: { failure: { category: "timeout", messageRef: "failure-1" }, context: { runId: "fixture-run", strategy: "back" } } };
    expect(await context.bridge.nativeAction(recovery)).toMatchObject({ operation: "recover", ordinal: 2, actionAttempted: true, result: { recovered: true } });
    expect(context.routes).toEqual(["/operator/capabilities", "/operator/native-action", "/operator/native-action"]);
  } finally { await context.close(); }
});

test("invalid or oversized native action requests fail before the action HTTP route", async () => {
  const context = await fixture();
  try {
    for (const input of [{ ...request(), ordinal: 0 }, { ...request(), ordinal: true }, { ...request(), unknown: "private" }]) {
      await expect(context.bridge.nativeAction(input as NativeActionRequest)).rejects.toThrow();
    }
    const large = request();
    if (large.operation !== "execute") throw new Error();
    large.payload.candidate.generatedBy = { ...large.payload.candidate.generatedBy, extra: "x".repeat(65536) } as typeof large.payload.candidate.generatedBy;
    await expect(context.bridge.nativeAction(large)).rejects.toThrow();
    expect(context.routes).toEqual(["/operator/capabilities"]);
  } finally { await context.close(); }
});

test("native action receipts cannot change lease, ordinal, operation or checked time", async () => {
  for (const mutate of [
    (value: NativeActionResult) => { value.lease.challenge = "00000000-0000-4000-8000-000000000099"; },
    (value: NativeActionResult) => { value.ordinal += 1; },
    (value: NativeActionResult) => { value.checkedAt = "2000-01-01T00:00:00.000Z"; },
    (value: NativeActionResult) => { value.checkedAt = "2099-01-01T00:00:00.000Z"; },
  ]) {
    const context = await fixture((_input, result) => { mutate(result); return {}; });
    try {
      await expect(context.bridge.nativeAction(request())).rejects.toThrow(/action-response/);
      expect(context.routes).toHaveLength(2);
    } finally { await context.close(); }
  }
});

test("execution mismatches and successful results with no SDK attempt are rejected", async () => {
  for (const mutate of [
    (value: NativeActionResult) => { value.actionAttempted = false; },
    (value: NativeActionResult) => { if (value.operation === "execute") value.result.candidateId = "other-candidate"; },
    (value: NativeActionResult) => { if (value.operation === "execute") value.result.preFingerprint = "other-screen"; },
  ]) {
    const context = await fixture((_input, result) => { mutate(result); return {}; });
    try {
      await expect(context.bridge.nativeAction(request())).rejects.toThrow(/action-result/);
      expect(context.routes).toHaveLength(2);
    } finally { await context.close(); }
  }
});

test("SDK failure retains attempted state as diagnostic data", async () => {
  const context = await fixture((_input, result) => {
    if (result.operation === "execute") { result.result.status = "infrastructure_error"; result.result.failureSignature = "native-identity: lease-expired"; }
    return {};
  });
  try { expect(await context.bridge.nativeAction(request())).toMatchObject({ actionAttempted: true, result: { status: "infrastructure_error" } }); }
  finally { await context.close(); }
});

test("native action transport rejects invalid media types, errors, JSON, UTF-8 and streamed excess without retry", async () => {
  const replies: Reply[] = [{ status: 409, body: "private-sdk-error" }, { headers: { "content-type": "text/plain" } },
    { body: "{" }, { body: Buffer.from([0xff]) }, { chunked: true }, { status: 302, headers: { location: "/operator/native-action" } }];
  for (const reply of replies) {
    const context = await fixture(() => reply);
    try {
      await expect(context.bridge.nativeAction(request())).rejects.toThrow(/native-identity:/);
      expect(context.routes).toHaveLength(2);
    } finally { await context.close(); }
  }
});

test("caller mutation during HTTP does not change the receipt binding", async () => {
  const input = request();
  const context = await fixture(() => { input.ordinal = 9; input.lease.challenge = "00000000-0000-4000-8000-000000000099"; return {}; });
  try { expect(await context.bridge.nativeAction(input)).toMatchObject({ ordinal: 1, lease: { challenge: "00000000-0000-4000-8000-000000000003" } }); }
  finally { await context.close(); }
});

test("the facade fixes the request before its lazy import yields", async () => {
  const input = request(), context = await fixture();
  try {
    const pending = context.bridge.nativeAction(input);
    input.ordinal = 9;
    expect(await pending).toMatchObject({ ordinal: 1 });
  } finally { await context.close(); }
});

test("uncloneable requests do not expose caller content in facade errors", async () => {
  const context = await fixture();
  try {
    const input = { ...request(), extra: () => "private-clone-canary" };
    await expect(context.bridge.nativeAction(input)).rejects.toThrow(/^native-identity: action-request-invalid$/);
    expect(context.routes).toEqual(["/operator/capabilities"]);
  } finally { await context.close(); }
});
