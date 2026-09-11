import { expect, test } from "@playwright/test";
import { assertNativeIdentityObservation, assertNativeBuildMapping, nativeBuildMappingDigest, nativeDeviceDigest,
  NATIVE_IDENTITY_SOURCES, type NativeIdentityObservation, type NativeBuildMapping, type NativePlatform } from "../src/exploration/native-identity-contracts.js";
import { verifyNativeIdentityObservation, type NativeIdentityContext } from "../src/exploration/native-identity.js";

const now = Date.parse("2026-09-10T00:00:00.000Z");
const digest = (character: string) => "sha256:" + character.repeat(64);
function fixture(platform: NativePlatform = "android") {
  const source = NATIVE_IDENTITY_SOURCES[platform], appId = platform === "windows" ? "fixture.exe" : "org.example.fixture";
  const appBuild = platform === "windows" ? digest("f") : platform === "android" ? "42" : "4.2.0";
  const provider = { name: "fixture-" + platform, version: "1.0" };
  const deviceDigest = nativeDeviceDigest(platform, source.deviceDigest, "fixture-device");
  const observation: NativeIdentityObservation = {
    schemaVersion: "lakda/native-identity-observation/v1", observationId: "00000000-0000-4000-8000-000000000001",
    challenge: "00000000-0000-4000-8000-000000000002", platform,
    bridgeBinding: { bridgeDigest: digest("a"), capabilityDigest: digest("b"), connectionId: "00000000-0000-4000-8000-000000000003" },
    provider, observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(),
    fields: {
      appId: { status: "observed", source: source.appId, value: appId },
      appBuild: { status: "observed", source: source.appBuild, value: appBuild },
      deviceDigest: { status: "observed", source: source.deviceDigest, value: deviceDigest },
      platformVersion: { status: "observed", source: source.platformVersion, value: "1.0" },
    },
    declared: { appId, appRevision: "approved-revision", deviceDigest, platformVersion: "1.0" },
  };
  const mapping: NativeBuildMapping = { schemaVersion: "lakda/native-build-mapping/v1", mappingId: "00000000-0000-4000-8000-000000000004",
    platform, provider: { ...provider }, appId, entries: [{ observedBuild: appBuild, targetRevision: "approved-revision" }] };
  const context: NativeIdentityContext = { platform, appId, targetRevision: "approved-revision", deviceDigest,
    bridgeBinding: { ...observation.bridgeBinding }, challenge: observation.challenge, requestedAt: now, now: now + 1,
    elapsedMs: 1, allowedProviders: [{ ...provider }], mapping, mappingDigest: nativeBuildMappingDigest(mapping) };
  return { observation, context, mapping };
}

test("native observations bind actual fields to an approved build mapping for all three platforms", () => {
  for (const platform of ["windows", "android", "ios"] as const) {
    const { observation, context } = fixture(platform);
    expect(() => assertNativeIdentityObservation(observation)).not.toThrow();
    const proof = verifyNativeIdentityObservation(observation, context);
    expect(proof).toMatchObject({ platform, appId: context.appId, deviceDigest: context.deviceDigest,
      targetRevision: context.targetRevision, mappingDigest: context.mappingDigest, connectionId: context.bridgeBinding.connectionId });
    expect(proof.observationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    observation.provider.name = "changed-later";
    expect(proof.provider.name).toBe("fixture-" + platform);
  }
});

test("operator declarations cannot substitute for the required native observations", () => {
  for (const field of ["appId", "appBuild", "deviceDigest"] as const) for (const status of ["declared-only", "unavailable"] as const) {
    const { observation, context } = fixture();
    observation.fields[field] = status === "declared-only" ? { status, source: "operator-declaration", value: null } : { status, source: "unavailable", value: null };
    expect(() => assertNativeIdentityObservation(observation)).not.toThrow();
    expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-unobserved/);
  }
});

test("observation structure rejects unknown data and impossible source/status combinations", () => {
  const mutations: Array<(value: NativeIdentityObservation) => void> = [
    value => Object.assign(value, { serial: "raw-device-canary" }),
    value => Object.assign(value.fields.deviceDigest, { serial: "raw-device-canary" }),
    value => { value.fields.appId.source = "operator-declaration"; },
    value => { value.fields.appId.source = NATIVE_IDENTITY_SOURCES.ios.appId; },
    value => { value.fields.appId.value = "C:\\private\\app.exe"; },
    value => { value.fields.appId.value = "C:private.exe"; },
    value => { value.fields.deviceDigest.value = "raw-device-canary"; },
    value => { value.fields.appBuild.value = "not-a-version-code"; },
    value => { value.fields.appBuild.value = null; },
    value => { value.observedAt = "2026-09-10T00:00:00Z"; },
    value => { value.expiresAt = value.observedAt; },
    value => { value.fields.appId.value = "\ud800"; },
    value => { value.fields.appId = { status: "declared-only", source: "operator-declaration", value: null }; value.declared.appId = null; },
  ];
  for (const mutate of mutations) {
    const { observation } = fixture(); mutate(observation);
    expect(() => assertNativeIdentityObservation(observation)).toThrow(/observation-invalid/);
  }
});

test("a different connection, bridge, capability, challenge, or platform cannot reuse an observation", () => {
  const mutations: Array<(context: NativeIdentityContext) => void> = [
    value => { value.bridgeBinding.connectionId = "00000000-0000-4000-8000-000000000005"; },
    value => { value.bridgeBinding.bridgeDigest = digest("c"); },
    value => { value.bridgeBinding.capabilityDigest = digest("c"); },
    value => { value.challenge = "00000000-0000-4000-8000-000000000006"; },
    value => { value.platform = "ios"; },
  ];
  for (const mutate of mutations) {
    const { observation, context } = fixture(); mutate(context);
    expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-binding-mismatch/);
  }
});

test("identity leases enforce one, sixty, and three hundred second limits with monotonic expiry", () => {
  for (const duration of [1000, 60000, 300000]) {
    const { observation, context } = fixture();
    observation.expiresAt = new Date(now + duration).toISOString(); context.maxAgeMs = duration;
    context.now = now + duration - 1; context.elapsedMs = duration - 1;
    expect(() => verifyNativeIdentityObservation(observation, context)).not.toThrow();
    context.now = now + duration;
    expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-expired/);
    context.now = now + 1; context.elapsedMs = duration;
    expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-expired/);
  }
  const { observation, context } = fixture(); observation.expiresAt = new Date(now + 1000).toISOString();
  context.elapsedMs = 0.5;
  expect(() => verifyNativeIdentityObservation(observation, context)).not.toThrow();
  context.elapsedMs = 1000;
  expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-expired/);
});

test("invalid clocks, future observations, and invalid age policies never qualify an identity", () => {
  for (const mutate of [
    (c: NativeIdentityContext) => { c.now = now - 1; },
    (c: NativeIdentityContext) => { c.requestedAt = now + 1; },
    (c: NativeIdentityContext) => { c.now = NaN; },
    (c: NativeIdentityContext) => { c.elapsedMs = Infinity; },
    (c: NativeIdentityContext) => { c.elapsedMs = -1; },
    (c: NativeIdentityContext) => { c.maxAgeMs = 999; },
    (c: NativeIdentityContext) => { c.maxAgeMs = 1000.5; },
    (c: NativeIdentityContext) => { c.maxAgeMs = 300001; },
  ]) {
    const { observation, context } = fixture(); mutate(context);
    expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-clock-invalid|identity-context-invalid/);
  }
});

test("native provider approval pins both its name and version", () => {
  for (const kind of ["name", "version", "empty"] as const) {
    const { observation, context } = fixture();
    if (kind === "empty") context.allowedProviders = [];
    else context.allowedProviders[0][kind] = "different";
    expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-provider-denied|identity-context-invalid/);
  }
});

test("app, device, and operator declarations are compared independently", () => {
  for (const field of ["appId", "appRevision", "deviceDigest", "platformVersion"] as const) {
    const { observation, context } = fixture();
    observation.declared[field] = field === "deviceDigest" ? digest("c") : "different";
    expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-declaration-mismatch/);
  }
  for (const field of ["appId", "deviceDigest"] as const) {
    const { observation, context } = fixture(); context[field] = field === "deviceDigest" ? digest("c") : "different";
    expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-app-mismatch|identity-device-mismatch/);
  }
});

test("build mappings cannot be substituted, ambiguous, or applied to a different revision", () => {
  for (const kind of ["digest", "app", "platform", "provider", "missing-build", "revision"] as const) {
    const { observation, context, mapping } = fixture();
    if (kind === "digest") context.mappingDigest = digest("c");
    else {
      if (kind === "app") mapping.appId = "another.app";
      if (kind === "platform") { mapping.platform = "ios"; mapping.entries[0].observedBuild = "1.0"; }
      if (kind === "provider") mapping.provider.version = "2.0";
      if (kind === "missing-build") mapping.entries[0].observedBuild = "43";
      if (kind === "revision") mapping.entries[0].targetRevision = "another-revision";
      context.mappingDigest = nativeBuildMappingDigest(mapping);
    }
    expect(() => verifyNativeIdentityObservation(observation, context), kind).toThrow(/identity-mapping-mismatch|identity-build-mismatch/);
  }
  const { mapping } = fixture(); mapping.entries.push({ ...mapping.entries[0] });
  expect(() => assertNativeBuildMapping(mapping)).toThrow(/build-mapping-invalid/);
});

test("build mappings enforce entry limits, required values, and private-data exclusion", () => {
  const { mapping } = fixture();
  for (const count of [0, 513]) {
    const value = { ...mapping, entries: Array.from({ length: count }, (_, index) => ({ observedBuild: String(index), targetRevision: "revision" })) };
    expect(() => assertNativeBuildMapping(value)).toThrow(/build-mapping-invalid/);
  }
  const valid = { ...mapping, entries: Array.from({ length: 512 }, (_, index) => ({ observedBuild: String(index), targetRevision: "revision" })) };
  expect(() => assertNativeBuildMapping(valid)).not.toThrow();
  expect(() => assertNativeBuildMapping({ ...mapping, localPath: "C:\\private" })).toThrow(/build-mapping-invalid/);
  expect(() => assertNativeBuildMapping({ ...valid, entries: valid.entries.map(entry => ({ ...entry, targetRevision: "r".repeat(256) })) })).toThrow(/build-mapping-invalid/);
});

test("optional platform version remains unavailable without weakening mandatory identity fields", () => {
  const { observation, context } = fixture();
  observation.fields.platformVersion = { status: "unavailable", source: "unavailable", value: null }; observation.declared.platformVersion = null;
  expect(() => verifyNativeIdentityObservation(observation, context)).not.toThrow();
  context.requiredFields = ["appId", "appBuild", "deviceDigest", "platformVersion"];
  expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-unobserved/);
  context.requiredFields = [];
  expect(() => verifyNativeIdentityObservation(observation, context)).toThrow(/identity-context-invalid/);
});

test("device digest is deterministic, platform-bound, and never emits its raw identifier", () => {
  const raw = "raw-device-canary", values = new Set<string>();
  expect(nativeDeviceDigest("android", "android-serialno", raw)).toBe("sha256:2ed25b90cc813d5fb19ada61d2a6a4a8c7a541f50dd3a0d5bd22844f8ba15089");
  for (const platform of ["windows", "android", "ios"] as const) {
    const source = NATIVE_IDENTITY_SOURCES[platform].deviceDigest, first = nativeDeviceDigest(platform, source, raw);
    expect(first).toBe(nativeDeviceDigest(platform, source, raw)); expect(first).not.toContain(raw); values.add(first);
    for (const invalid of ["", " " + raw, raw + "\n", "\ud800"]) {
      expect(() => nativeDeviceDigest(platform, source, invalid)).toThrow(/^native-identity: device-identifier-invalid$/);
    }
  }
  expect(values.size).toBe(3);
  expect(() => nativeDeviceDigest("android", "windows-machine-guid", raw)).toThrow(/device-identifier-invalid/);
});
