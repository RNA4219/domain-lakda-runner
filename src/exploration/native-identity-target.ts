import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { ExplorationTargetManifestBase } from "./target-manifest.js";
import { assertNativeBuildMapping, nativeBuildMappingDigest, nativeIdentityTime, NativeIdentityError,
  type NativeBuildMapping, type NativeIdentityFieldName, type NativeIdentityProvider, type NativePlatform } from "./native-identity-contracts.js";
import type { NativeIdentityAcquisition } from "./native-identity-exchange.js";
import { verifyNativeIdentityObservation, type VerifiedNativeIdentity } from "./native-identity.js";

export const NATIVE_TARGET_MANIFEST_VERSION = "lakda/exploration-target-manifest/v2" as const;
export type NativeIdentityPolicy = {
  deviceDigest: string; allowedProviders: NativeIdentityProvider[]; requiredFields: NativeIdentityFieldName[]; maxAgeMs: number;
  buildMappings: Array<{ mapping: NativeBuildMapping; mappingDigest: string }>;
};
export type NativeExplorationTargetManifest = ExplorationTargetManifestBase & {
  schemaVersion: typeof NATIVE_TARGET_MANIFEST_VERSION; platform: NativePlatform; adapterId: "airtest-poco";
  target: ExplorationTargetManifestBase["target"] & { identity: { kind: "native"; appId: string } };
  nativeIdentity: NativeIdentityPolicy;
};

type Validator = (value: unknown) => boolean;
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as new (options: object) => { compile(schema: object): Validator };
const validate = new Ajv({ allErrors: false, strict: false, strictNumbers: true }).compile(JSON.parse(readFileSync(
  resolve(import.meta.dirname, "..", "..", "schemas", "lakda-exploration-target-manifest-v2.schema.json"), "utf8")) as object);
const providerKey = (provider: NativeIdentityProvider): string => JSON.stringify([provider.name, provider.version]);

export function assertNativeExplorationTargetManifest(value: unknown): asserts value is NativeExplorationTargetManifest {
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { throw new NativeIdentityError("target-schema-invalid"); }
  if (bytes > 262144) throw new NativeIdentityError("target-capacity-exceeded");
  if (!validate(value)) throw new NativeIdentityError("target-schema-invalid");
  const manifest = value as NativeExplorationTargetManifest, policy = manifest.nativeIdentity;
  const providers = new Set(policy.allowedProviders.map(providerKey));
  const mapped = new Set<string>();
  for (const entry of policy.buildMappings) {
    assertNativeBuildMapping(entry.mapping);
    const key = providerKey(entry.mapping.provider);
    if (!providers.has(key) || mapped.has(key) || nativeBuildMappingDigest(entry.mapping) !== entry.mappingDigest
      || entry.mapping.platform !== manifest.platform || entry.mapping.appId !== manifest.target.identity.appId
      || !entry.mapping.entries.some(item => item.targetRevision === manifest.targetRevision)) throw new NativeIdentityError("target-mapping-mismatch");
    mapped.add(key);
  }
  if (mapped.size !== providers.size) throw new NativeIdentityError("target-mapping-missing");
  const from = nativeIdentityTime(manifest.signature.validFrom), until = nativeIdentityTime(manifest.signature.validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) throw new Error("探索target manifestの承認期限が不正です");
}

/** The caller must verify the operator signature before using this policy to check an acquisition. */
export function verifyNativeIdentityForTarget(manifest: NativeExplorationTargetManifest, acquisition: NativeIdentityAcquisition): VerifiedNativeIdentity {
  assertNativeExplorationTargetManifest(manifest);
  if (acquisition.requestedAt < nativeIdentityTime(manifest.signature.validFrom)
    || acquisition.now >= nativeIdentityTime(manifest.signature.validUntil)) throw new NativeIdentityError("target-approval-expired");
  const policy = manifest.nativeIdentity, observation = acquisition.observation;
  const entry = policy.buildMappings.find(item => providerKey(item.mapping.provider) === providerKey(observation.provider));
  if (!entry) throw new NativeIdentityError("identity-provider-denied");
  return verifyNativeIdentityObservation(observation, {
    platform: manifest.platform, appId: manifest.target.identity.appId, targetRevision: manifest.targetRevision,
    deviceDigest: policy.deviceDigest, allowedProviders: policy.allowedProviders, requiredFields: policy.requiredFields, maxAgeMs: policy.maxAgeMs,
    mapping: entry.mapping, mappingDigest: entry.mappingDigest, bridgeBinding: { ...manifest.bridgeBinding, connectionId: observation.bridgeBinding.connectionId },
    challenge: observation.challenge, requestedAt: acquisition.requestedAt, now: acquisition.now, elapsedMs: acquisition.elapsedMs,
  });
}
