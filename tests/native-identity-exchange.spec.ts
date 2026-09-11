import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { LoopbackJsonBridge } from "../src/adapters/loopback-json.js";
import { nativeIdentityDigest, nativeBuildMappingDigest, nativeDeviceDigest, type NativeIdentityObservation } from "../src/exploration/native-identity-contracts.js";
import { verifyNativeIdentityObservation } from "../src/exploration/native-identity.js";

const caps = { schemaVersion: "lakda/adaptive-contracts/v1", adapterId: "airtest-poco", revision: "fixture", targetRevision: "approved-revision",
  platform: "android", targetKinds: ["device"], actionKinds: [], observationCapabilities: [], evidenceCapabilities: [], recoveryStrategies: [],
  liveness: { connected: true, responsive: true } };
const appId = "org.example.fixture", provider = { name: "fixture", version: "1" };
const deviceDigest = nativeDeviceDigest("android", "android-serialno", "fixture-device");
type Session = { schemaVersion: string; connectionId: string; challenge: string; platform: string;
  bridgeBinding: { bridgeDigest: string; capabilityDigest: string }; issuedAt: string; expiresAt: string };
type Reply = { status?: number; headers?: Record<string, string>; body?: string | Buffer; chunked?: boolean; delayMs?: number };
async function fixture(options: { session?: (value: Session) => void; observation?: (value: NativeIdentityObservation) => void;
  reply?: (operation: string) => Reply | undefined } = {}) {
  const calls: string[] = [], timers: ReturnType<typeof setTimeout>[] = [];
  let base = "", session: Session;
  const server = createServer((request, response) => {
    response.on("error", () => undefined);
    const parts: Buffer[] = [];
    request.on("data", (value: Buffer) => parts.push(value));
    request.on("end", () => {
      const operation = request.url!.slice(1); calls.push(operation);
      const input = JSON.parse(Buffer.concat(parts).toString("utf8")) as { challenge?: string };
      const now = Date.now();
      let value: unknown = caps;
      if (operation === "native-identity-open") {
        session = { schemaVersion: "lakda/native-identity-session/v1", connectionId: randomUUID(), challenge: input.challenge!, platform: "android",
          bridgeBinding: { capabilityDigest: nativeIdentityDigest(caps), bridgeDigest: nativeIdentityDigest({ transport: "loopback-json/v1", endpoint: base }) },
          issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30000).toISOString() };
        options.session?.(session); value = session;
      } else if (operation === "native-identity-observe") {
        const observation: NativeIdentityObservation = { schemaVersion: "lakda/native-identity-observation/v1", observationId: randomUUID(),
          challenge: input.challenge!, platform: "android", bridgeBinding: { ...session.bridgeBinding, connectionId: session.connectionId }, provider: { ...provider },
          observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(),
          declared: { appId, appRevision: "approved-revision", deviceDigest, platformVersion: "14" },
          fields: { appId: { status: "observed", source: "android-package-manager", value: appId }, appBuild: { status: "observed", source: "android-version-code", value: "42" },
            deviceDigest: { status: "observed", source: "android-serialno", value: deviceDigest }, platformVersion: { status: "observed", source: "android-release", value: "14" } } };
        options.observation?.(observation); value = observation;
      }
      const reply = options.reply?.(operation) ?? {}, body = reply.body ?? JSON.stringify(value);
      const send = () => { response.writeHead(reply.status ?? 200, { "content-type": "application/json", ...reply.headers }); if (reply.chunked) response.write(body); else response.end(body); if (reply.chunked) response.end(); };
      if (reply.delayMs) timers.push(setTimeout(send, reply.delayMs)); else send();
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  return { base, calls, close: async () => { timers.forEach(clearTimeout); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); } };
}

test("native bridge exchange binds two HTTP responses before the existing verifier accepts the observation", async () => {
  const target = await fixture();
  try {
    const bridge = await LoopbackJsonBridge.connect(target.base, "airtest-poco"), result = await bridge.observeNativeIdentity();
    const mapping = { schemaVersion: "lakda/native-build-mapping/v1" as const, mappingId: randomUUID(), platform: "android" as const,
      provider, appId, entries: [{ observedBuild: "42", targetRevision: "approved-revision" }] };
    const proof = verifyNativeIdentityObservation(result.observation, { platform: "android", appId, deviceDigest, targetRevision: "approved-revision",
      bridgeBinding: result.observation.bridgeBinding, challenge: result.observation.challenge, allowedProviders: [provider], mapping,
      mappingDigest: nativeBuildMappingDigest(mapping), requestedAt: result.requestedAt, now: result.now, elapsedMs: result.elapsedMs });
    expect(proof.targetRevision).toBe("approved-revision");
    expect(target.calls).toEqual(["capabilities", "native-identity-open", "native-identity-observe"]);
  } finally { await target.close(); }
});

test("an invalid native age policy is rejected before either identity endpoint is requested", async () => {
  const target = await fixture();
  try {
    const bridge = await LoopbackJsonBridge.connect(target.base, "airtest-poco");
    for (const age of [999, 300001, 1000.5, NaN]) await expect(bridge.observeNativeIdentity(age)).rejects.toThrow(/exchange-context-invalid/);
    expect(target.calls).toEqual(["capabilities"]);
  } finally { await target.close(); }
});

test("wrong, stale, and unknown session fields never reach the observe endpoint", async () => {
  const mutations: Array<(value: Session) => void> = [value => { value.challenge = randomUUID(); }, value => { value.connectionId = "not-a-uuid"; },
    value => { value.bridgeBinding.capabilityDigest = "sha256:" + "f".repeat(64); }, value => { value.bridgeBinding.bridgeDigest = "sha256:" + "f".repeat(64); },
    value => { value.platform = "ios"; }, value => { value.issuedAt = new Date(Date.now() + 10000).toISOString(); },
    value => { value.expiresAt = value.issuedAt; }, value => { Object.assign(value, { rawSerial: "private-canary" }); }];
  for (const mutate of mutations) {
    const target = await fixture({ session: mutate });
    try {
      const bridge = await LoopbackJsonBridge.connect(target.base, "airtest-poco");
      await expect(bridge.observeNativeIdentity()).rejects.toThrow(/native-identity:/);
      expect(target.calls).toEqual(["capabilities", "native-identity-open"]);
    } finally { await target.close(); }
  }
});

test("observation binding, challenge, and timestamps are rechecked after the server session", async () => {
  const mutations: Array<(value: NativeIdentityObservation) => void> = [value => { value.challenge = randomUUID(); },
    value => { value.bridgeBinding.connectionId = randomUUID(); }, value => { value.bridgeBinding.bridgeDigest = "sha256:" + "f".repeat(64); },
    value => { value.bridgeBinding.capabilityDigest = "sha256:" + "f".repeat(64); }, value => { value.observedAt = new Date(Date.now() + 10000).toISOString(); },
    value => { value.expiresAt = new Date(Date.now() - 1).toISOString(); }, value => { Object.assign(value, { privatePath: "private-canary" }); }];
  for (const mutate of mutations) {
    const target = await fixture({ observation: mutate });
    try {
      const bridge = await LoopbackJsonBridge.connect(target.base, "airtest-poco");
      await expect(bridge.observeNativeIdentity()).rejects.toThrow(/native-identity:/);
      expect(target.calls).toEqual(["capabilities", "native-identity-open", "native-identity-observe"]);
    }
    finally { await target.close(); }
  }
});

test("unavailable observations remain unavailable after transport validation", async () => {
  const target = await fixture({ observation: value => { value.fields.appBuild = { status: "declared-only", source: "operator-declaration", value: null }; } });
  try {
    const bridge = await LoopbackJsonBridge.connect(target.base, "airtest-poco"), result = await bridge.observeNativeIdentity();
    expect(result.observation.fields.appBuild).toEqual({ status: "declared-only", source: "operator-declaration", value: null });
  } finally { await target.close(); }
});

test("identity response limits apply while streaming both session and observation bodies", async () => {
  for (const [operation, size] of [["native-identity-open", 4097], ["native-identity-observe", 16385]] as const) {
    const target = await fixture({ reply: current => current === operation ? { body: " ".repeat(size), chunked: true } : undefined });
    try { const bridge = await LoopbackJsonBridge.connect(target.base, "airtest-poco"); await expect(bridge.observeNativeIdentity()).rejects.toThrow(/exchange-response-too-large/); }
    finally { await target.close(); }
  }
});

test("invalid JSON, UTF-8, content types, redirects, and server errors stay private", async () => {
  const replies: Reply[] = [{ body: "private-canary" }, { body: Buffer.from([255]) }, { headers: { "content-type": "text/html" }, body: "private-canary" },
    { status: 302, headers: { location: "http://example.invalid/" } }, { status: 500, body: "private-canary" }, { headers: { "content-length": "1000000" }, body: "{}" }];
  for (const reply of replies) {
    const target = await fixture({ reply: current => current === "native-identity-open" ? reply : undefined });
    try {
      const bridge = await LoopbackJsonBridge.connect(target.base, "airtest-poco");
      await expect(bridge.observeNativeIdentity()).rejects.toThrow(/native-identity: exchange-/);
      expect(target.calls).toEqual(["capabilities", "native-identity-open"]);
    } finally { await target.close(); }
  }
});

test("open and observe share one fifteen second network budget", async () => {
  const target = await fixture({ reply: operation => operation.startsWith("native-identity-") ? { delayMs: 8000 } : undefined });
  try {
    const bridge = await LoopbackJsonBridge.connect(target.base, "airtest-poco");
    await expect(bridge.observeNativeIdentity()).rejects.toThrow(/exchange-unavailable/);
    expect(target.calls).toEqual(["capabilities", "native-identity-open", "native-identity-observe"]);
  } finally { await target.close(); }
});
