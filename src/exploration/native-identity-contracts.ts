import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";

export const NATIVE_IDENTITY_SOURCES = {
  windows: { appId: "windows-process-image", appBuild: "windows-executable-sha256", deviceDigest: "windows-machine-guid", platformVersion: "windows-version" },
  android: { appId: "android-package-manager", appBuild: "android-version-code", deviceDigest: "android-serialno", platformVersion: "android-release" },
  ios: { appId: "ios-installation-proxy", appBuild: "ios-bundle-version", deviceDigest: "ios-udid", platformVersion: "ios-product-version" },
} as const;
export type NativePlatform = keyof typeof NATIVE_IDENTITY_SOURCES;
export type NativeIdentityFieldName = keyof typeof NATIVE_IDENTITY_SOURCES.windows;
export type NativeIdentityField = { status: "observed"; source: typeof NATIVE_IDENTITY_SOURCES[NativePlatform][NativeIdentityFieldName]; value: string }
  | { status: "declared-only"; source: "operator-declaration"; value: null }
  | { status: "unavailable"; source: "unavailable"; value: null };
export type NativeIdentityProvider = { name: string; version: string };
export type NativeIdentityBinding = { bridgeDigest: string; capabilityDigest: string; connectionId: string };
export type NativeIdentityObservation = {
  schemaVersion: "lakda/native-identity-observation/v1"; observationId: string; challenge: string; platform: NativePlatform;
  bridgeBinding: NativeIdentityBinding; provider: NativeIdentityProvider; observedAt: string; expiresAt: string;
  fields: Record<NativeIdentityFieldName, NativeIdentityField>;
  declared: { appId: string | null; appRevision: string | null; deviceDigest: string | null; platformVersion: string | null };
};
export type NativeBuildMapping = {
  schemaVersion: "lakda/native-build-mapping/v1"; mappingId: string; platform: NativePlatform; provider: NativeIdentityProvider; appId: string;
  entries: Array<{ observedBuild: string; targetRevision: string }>;
};
export class NativeIdentityError extends Error {
  constructor(readonly code: string) { super("native-identity: " + code); this.name = "NativeIdentityError"; }
}

type Validator = (value: unknown) => boolean;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as new (options: object) => { compile(schema: object): Validator };
const ajv = new Ajv({ allErrors: false, strict: false, strictNumbers: true });
const compile = (name: string) => ajv.compile(JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "..", "schemas", name), "utf8")) as object);
const observationValidator = compile("lakda-native-identity-observation-v1.schema.json");
const mappingValidator = compile("lakda-native-build-mapping-v1.schema.json");
const keys: NativeIdentityFieldName[] = ["appId", "appBuild", "deviceDigest", "platformVersion"];
const declaredKey = (key: NativeIdentityFieldName) => key === "appBuild" ? "appRevision" : key;
export const nativeIdentityDigest = (value: unknown): string => "sha256:" + sha256(canonicalJson(value));
export function nativeIdentityTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}
function validText(value: string): boolean {
  return value.trim() === value && value.length > 0 && !/[\ud800-\udfff/\\]/u.test(value)
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
function validBuild(platform: NativePlatform, value: string): boolean {
  return validText(value) && (platform === "windows" ? /^sha256:[0-9a-f]{64}$/.test(value) : platform !== "android" || /^(?:0|[1-9][0-9]{0,19})$/.test(value));
}
function validAppId(value: string): boolean { return validText(value) && value !== "." && value !== ".." && !/[<>:"|?*]/u.test(value); }
function assertJson(value: unknown, validator: Validator, maxBytes: number, code: string): void {
  try {
    if (!validator(value)) throw new Error();
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > maxBytes || canonicalJson(JSON.parse(json)) !== canonicalJson(value)) throw new Error();
  } catch { throw new NativeIdentityError(code); }
}

export function assertNativeIdentityObservation(value: unknown): asserts value is NativeIdentityObservation {
  assertJson(value, observationValidator, 16_384, "observation-invalid");
  const observation = value as NativeIdentityObservation, sources = NATIVE_IDENTITY_SOURCES[observation.platform];
  const duration = nativeIdentityTime(observation.expiresAt) - nativeIdentityTime(observation.observedAt);
  if (!Number.isSafeInteger(duration) || duration < 1000 || duration > 300000) throw new NativeIdentityError("observation-invalid");
  for (const key of keys) {
    const field = observation.fields[key];
    if (field.status === "observed" && (field.source !== sources[key] || !validText(field.value)
      || key === "appBuild" && !validBuild(observation.platform, field.value) || key === "appId" && !validAppId(field.value))) throw new NativeIdentityError("observation-invalid");
    if (field.status === "declared-only" && observation.declared[declaredKey(key)] === null) throw new NativeIdentityError("observation-invalid");
  }
  if (Object.values(observation.declared).some(item => item !== null && !validText(item))) throw new NativeIdentityError("observation-invalid");
  if (observation.declared.appId !== null && !validAppId(observation.declared.appId)) throw new NativeIdentityError("observation-invalid");
}

export function assertNativeBuildMapping(value: unknown): asserts value is NativeBuildMapping {
  assertJson(value, mappingValidator, 65_536, "build-mapping-invalid");
  const mapping = value as NativeBuildMapping, seen = new Set<string>();
  if (!validAppId(mapping.appId)) throw new NativeIdentityError("build-mapping-invalid");
  for (const entry of mapping.entries) {
    if (seen.has(entry.observedBuild) || !validBuild(mapping.platform, entry.observedBuild) || !validText(entry.targetRevision)) throw new NativeIdentityError("build-mapping-invalid");
    seen.add(entry.observedBuild);
  }
}
export function nativeBuildMappingDigest(value: unknown): string { assertNativeBuildMapping(value); return nativeIdentityDigest(value); }
export function nativeDeviceDigest(platform: NativePlatform, source: string, identifier: string): string {
  if (!Object.hasOwn(NATIVE_IDENTITY_SOURCES, platform) || NATIVE_IDENTITY_SOURCES[platform].deviceDigest !== source
    || typeof identifier !== "string" || identifier.length > 512 || !validText(identifier)) throw new NativeIdentityError("device-identifier-invalid");
  return nativeIdentityDigest({ schemaVersion: "lakda/native-device-digest/v1", platform, source, identifier });
}
