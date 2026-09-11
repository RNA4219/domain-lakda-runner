import { assertNativeBuildMapping, assertNativeIdentityObservation, nativeBuildMappingDigest, nativeIdentityDigest, nativeIdentityTime,
  NativeIdentityError, type NativeBuildMapping, type NativeIdentityBinding, type NativeIdentityFieldName, type NativeIdentityProvider, type NativePlatform } from "./native-identity-contracts.js";

export type NativeIdentityContext = {
  platform: NativePlatform; appId: string; targetRevision: string; deviceDigest: string;
  bridgeBinding: NativeIdentityBinding; challenge: string; requestedAt: number; now: number; elapsedMs: number;
  allowedProviders: NativeIdentityProvider[]; mapping: NativeBuildMapping; mappingDigest: string;
  maxAgeMs?: number; requiredFields?: readonly NativeIdentityFieldName[];
};
export type VerifiedNativeIdentity = {
  platform: NativePlatform; observationId: string; observationDigest: string; mappingDigest: string;
  appId: string; appBuild: string; deviceDigest: string; targetRevision: string;
  provider: NativeIdentityProvider; connectionId: string; challenge: string; observedAt: string; expiresAt: string;
};
const mandatory: NativeIdentityFieldName[] = ["appId", "appBuild", "deviceDigest"];
const sameProvider = (first: NativeIdentityProvider, second: NativeIdentityProvider) => first.name === second.name && first.version === second.version;
const isDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value
  && !/[\ud800-\udfff/\\]/u.test(value) && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Validate observations against already-approved context; this does not obtain device data or grant approval. */
export function verifyNativeIdentityObservation(value: unknown, context: NativeIdentityContext): VerifiedNativeIdentity {
  assertNativeIdentityObservation(value);
  const maxAge = context.maxAgeMs ?? 60000, required = context.requiredFields ?? mandatory;
  if (!["windows", "android", "ios"].includes(context.platform) || !isText(context.appId) || !isText(context.targetRevision)
    || !isDigest(context.deviceDigest) || !isDigest(context.mappingDigest) || !context.bridgeBinding
    || !isDigest(context.bridgeBinding.bridgeDigest) || !isDigest(context.bridgeBinding.capabilityDigest)
    || !isUuid(context.bridgeBinding.connectionId) || !isUuid(context.challenge)
    || !Number.isSafeInteger(maxAge) || maxAge < 1000 || maxAge > 300000
    || !Array.isArray(required) || new Set(required).size !== required.length || mandatory.some(key => !required.includes(key))
    || required.some(key => ![...mandatory, "platformVersion"].includes(key))
    || !Array.isArray(context.allowedProviders) || context.allowedProviders.length < 1 || context.allowedProviders.length > 16
    || context.allowedProviders.some(item => !item || typeof item.name !== "string" || typeof item.version !== "string")) throw new NativeIdentityError("identity-context-invalid");
  if (value.platform !== context.platform || value.challenge !== context.challenge
    || value.bridgeBinding.connectionId !== context.bridgeBinding.connectionId || value.bridgeBinding.bridgeDigest !== context.bridgeBinding.bridgeDigest
    || value.bridgeBinding.capabilityDigest !== context.bridgeBinding.capabilityDigest) throw new NativeIdentityError("identity-binding-mismatch");
  if (!context.allowedProviders.some(item => sameProvider(item, value.provider))) throw new NativeIdentityError("identity-provider-denied");
  const observed = nativeIdentityTime(value.observedAt), expires = nativeIdentityTime(value.expiresAt);
  if (!Number.isSafeInteger(context.now) || !Number.isSafeInteger(context.requestedAt) || !Number.isFinite(context.elapsedMs)
    || context.elapsedMs < 0 || context.requestedAt > observed || observed > context.now) throw new NativeIdentityError("identity-clock-invalid");
  if (context.now >= expires || expires - observed > maxAge || context.now - observed >= maxAge
    || context.elapsedMs >= Math.min(maxAge, expires - context.requestedAt)) throw new NativeIdentityError("identity-expired");
  if (required.some((key: NativeIdentityFieldName) => value.fields[key].status !== "observed")) throw new NativeIdentityError("identity-unobserved");
  const appId = value.fields.appId.value!, appBuild = value.fields.appBuild.value!, deviceDigest = value.fields.deviceDigest.value!;
  if (appId !== context.appId) throw new NativeIdentityError("identity-app-mismatch");
  if (deviceDigest !== context.deviceDigest) throw new NativeIdentityError("identity-device-mismatch");
  assertNativeBuildMapping(context.mapping);
  if (nativeBuildMappingDigest(context.mapping) !== context.mappingDigest || context.mapping.platform !== context.platform
    || context.mapping.appId !== appId || !sameProvider(context.mapping.provider, value.provider)) throw new NativeIdentityError("identity-mapping-mismatch");
  const build = context.mapping.entries.find(entry => entry.observedBuild === appBuild);
  if (!build || build.targetRevision !== context.targetRevision) throw new NativeIdentityError("identity-build-mismatch");
  const expected = { appId, appRevision: build.targetRevision, deviceDigest,
    platformVersion: value.fields.platformVersion.status === "observed" ? value.fields.platformVersion.value : null };
  for (const key of ["appId", "appRevision", "deviceDigest", "platformVersion"] as const) {
    if (value.declared[key] !== null && expected[key] !== null && value.declared[key] !== expected[key]) throw new NativeIdentityError("identity-declaration-mismatch");
  }
  return { platform: value.platform, observationId: value.observationId, observationDigest: nativeIdentityDigest(value), mappingDigest: context.mappingDigest,
    appId, appBuild, deviceDigest, targetRevision: build.targetRevision, provider: { ...value.provider }, connectionId: value.bridgeBinding.connectionId,
    challenge: value.challenge, observedAt: value.observedAt, expiresAt: value.expiresAt };
}
