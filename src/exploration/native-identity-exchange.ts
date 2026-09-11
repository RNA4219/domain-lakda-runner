import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertLoopbackEndpoint } from "../core/safety.js";
import { assertNativeIdentityObservation, nativeIdentityDigest, nativeIdentityTime, NativeIdentityError,
  type NativeIdentityObservation, type NativePlatform } from "./native-identity-contracts.js";

type Binding = { capabilityDigest: string; bridgeDigest: string };

/** Defer once for short cross-clock UTC differences; validation and the shared budget remain unchanged. */
export async function waitForNativeTimestamp(timestamp: number, signal: AbortSignal): Promise<void> {
  const ahead = timestamp - Date.now();
  if (ahead > 0 && ahead <= 20) await delay(20, undefined, { signal });
}
type Session = { schemaVersion: "lakda/native-identity-session/v1"; connectionId: string; challenge: string;
  platform: NativePlatform; bridgeBinding: Binding; issuedAt: string; expiresAt: string };
export type NativeIdentityAcquisition = { observation: NativeIdentityObservation; requestedAt: number; now: number; elapsedMs: number };
type Validator = (value: unknown) => boolean;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as new (options: object) => { compile(schema: object): Validator };
const validate = new Ajv({ strict: false, strictNumbers: true }).compile(JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "..", "schemas", "lakda-native-identity-exchange-v1.schema.json"), "utf8")) as object);
const sameBinding = (first: Binding, second: Binding) => first.bridgeDigest === second.bridgeDigest && first.capabilityDigest === second.capabilityDigest;

export async function postNativeIdentityJson(base: URL, operation: "native-identity-open" | "native-identity-observe" | "native-action" | "native-capture", payload: unknown, signal: AbortSignal, limit: number): Promise<unknown> {
  assertLoopbackEndpoint(base.href);
  const response = await fetch(new URL(operation, base), { method: "POST", redirect: "error", signal,
    headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(payload) });
  const length = response.headers.get("content-length"), declared = length === null ? 0 : Number(length);
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
    || !Number.isSafeInteger(declared) || declared < 0 || declared > limit || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new NativeIdentityError("exchange-response-invalid");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new NativeIdentityError("exchange-response-too-large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown; }
  catch { throw new NativeIdentityError("exchange-response-invalid"); }
}

/** Collect a fresh observation; signature approval and required-field verification remain the caller's responsibility. */
export async function requestNativeIdentity(endpoint: URL, binding: Binding, platform: NativePlatform, maxAgeMs = 60000): Promise<NativeIdentityAcquisition> {
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1000 || maxAgeMs > 300000 || !["windows", "android", "ios"].includes(platform)
    || !/^sha256:[0-9a-f]{64}$/.test(binding.capabilityDigest) || !/^sha256:[0-9a-f]{64}$/.test(binding.bridgeDigest)) throw new NativeIdentityError("exchange-context-invalid");
  try {
    const base = assertLoopbackEndpoint(endpoint.href);
    if (!base.href.endsWith("/") || nativeIdentityDigest({ transport: "loopback-json/v1", endpoint: base.href }) !== binding.bridgeDigest) throw new NativeIdentityError("exchange-context-invalid");
    const signal = AbortSignal.timeout(15000), challenge = randomUUID(), openedAt = Date.now(), overallStart = performance.now();
    const value = await postNativeIdentityJson(base, "native-identity-open", { schemaVersion: "lakda/native-identity-open/v1", challenge, bridgeBinding: binding, maxAgeMs }, signal, 4096);
    if (!validate(value) || (value as Session).schemaVersion !== "lakda/native-identity-session/v1") throw new NativeIdentityError("exchange-session-invalid");
    const session = value as Session, issued = nativeIdentityTime(session.issuedAt), expires = nativeIdentityTime(session.expiresAt);
    await waitForNativeTimestamp(issued, signal);
    const sessionNow = Date.now();
    if (session.challenge !== challenge || session.platform !== platform || !sameBinding(session.bridgeBinding, binding)
      || !Number.isFinite(issued) || !Number.isFinite(expires) || expires - issued !== 30000 || issued < openedAt || issued > sessionNow || sessionNow >= expires) throw new NativeIdentityError("exchange-session-invalid");
    const requestedAt = Date.now(), observationStart = performance.now();
    const observation = await postNativeIdentityJson(base, "native-identity-observe", { schemaVersion: "lakda/native-identity-request/v1", connectionId: session.connectionId, challenge }, signal, 16384);
    assertNativeIdentityObservation(observation);
    const observed = nativeIdentityTime(observation.observedAt), observationExpiry = nativeIdentityTime(observation.expiresAt);
    await waitForNativeTimestamp(observed, signal);
    const now = Date.now(), elapsedMs = performance.now() - observationStart;
    if (observation.platform !== platform || observation.challenge !== challenge || observation.bridgeBinding.connectionId !== session.connectionId
      || !sameBinding(observation.bridgeBinding, binding)) throw new NativeIdentityError("exchange-observation-mismatch");
    if (observed < requestedAt || observed > now || now >= observationExpiry || observationExpiry - observed > maxAgeMs
      || elapsedMs >= Math.min(maxAgeMs, observationExpiry - requestedAt) || signal.aborted || performance.now() - overallStart >= 15000) throw new NativeIdentityError("exchange-observation-expired");
    return { observation, requestedAt, now, elapsedMs };
  } catch (error) {
    if (error instanceof NativeIdentityError) throw error;
    throw new NativeIdentityError("exchange-unavailable");
  }
}
