import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { verify } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../core/plan.js";
import { sha256 } from "../core/redaction.js";
import type { ExplorationCharter, ExplorationExecutionMode, ExplorationPlatform } from "./contracts.js";
import type { NativeExplorationTargetManifest } from "./native-identity-target.js";

export const EXPLORATION_TARGET_MANIFEST_VERSION = "lakda/exploration-target-manifest/v1" as const;
export type ExplorationTargetManifestBase = {
  manifestId: string;
  status: "ready";
  owner: string;
  charterDigest: string;
  configDigest: string;
  targetRevision: string;
  platform: ExplorationPlatform;
  adapterId: "playwright" | "airtest-poco";
  executionMode: "real";
  target: { identity: { kind: "web" | "native"; origin?: string; pathPrefixes?: string[]; appId?: string; appRevision?: string; deviceAliasDigest?: string; serialDigest?: string; revisionProbe?: { kind: "response-header" | "dom-meta"; name: string } }; templateCorpusDigest?: string };
  safety: { allowMutationKinds: string[]; resetProcedureRef: string; killSwitchRef: string };
  bridgeBinding: { capabilityDigest: string; bridgeDigest: string };
  artifactAttestorKeyIds?: string[];
  signature: { algorithm: "ed25519"; keyId: string; validFrom: string; validUntil: string; approvalEvidenceRef: string; signedPayloadDigest: string; valueBase64: string };
};
export type ExplorationTargetManifest = (ExplorationTargetManifestBase & { schemaVersion: typeof EXPLORATION_TARGET_MANIFEST_VERSION; nativeIdentity?: never }) | NativeExplorationTargetManifest;
type TrustKey = { keyId: string; publicKeyPem: string };
type Validator = ((value: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> };
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default as new (options: object) => { compile(schema: object): Validator };
const schemaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestValidator = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(awaitSchema()) as object);

function awaitSchema(): string {
  // The schema is loaded synchronously during module initialization so a malformed
  // input contract cannot be treated as a pending external approval.
  const fs = createRequire(import.meta.url);
  return fs("node:fs").readFileSync(resolve(schemaRoot, "schemas", "lakda-exploration-target-manifest-v1.schema.json"), "utf8");
}

const digest = (value: string): string => `sha256:${sha256(value)}`;
function signingPayload(value: ExplorationTargetManifest): string {
  const copy = structuredClone(value) as unknown as Record<string, unknown>;
  if (value.schemaVersion === "lakda/exploration-target-manifest/v2") {
    const signature = copy.signature as Record<string, unknown>;
    delete signature.signedPayloadDigest;
    delete signature.valueBase64;
  } else delete copy.signature;
  return canonicalJson(copy);
}

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch { throw new Error(`探索target manifestを読み込めません: ${path}`); }
}

async function readTrustKeys(path: string): Promise<TrustKey[]> {
  const value = await readJson(path);
  const list = Array.isArray(value) ? value : (value && typeof value === "object" && Array.isArray((value as { keys?: unknown }).keys) ? (value as { keys: unknown[] }).keys : undefined);
  if (!list) throw new Error("exploration trust storeはkeys配列が必要です");
  return list.filter((item): item is TrustKey => Boolean(item && typeof item === "object" && typeof (item as TrustKey).keyId === "string" && typeof (item as TrustKey).publicKeyPem === "string"));
}

function uniqueTrustKey(keys: readonly TrustKey[], keyId: string): TrustKey | undefined {
  const matches = keys.filter(item => item.keyId === keyId);
  if (matches.length > 1) throw new Error("探索target manifestの署名keyIdがtrust storeで重複しています");
  return matches[0];
}

export async function verifyTrustedEd25519Payload(payload: string, signature: { algorithm: "ed25519"; keyId: string; signedPayloadDigest: string; valueBase64: string }, trustStorePath: string): Promise<boolean> {
  if (signature.algorithm !== "ed25519" || signature.signedPayloadDigest !== digest(payload)) return false;
  const key = (await readTrustKeys(resolve(trustStorePath))).find(item => item.keyId === signature.keyId);
  if (!key) return false;
  try { return verify(null, Buffer.from(payload, "utf8"), key.publicKeyPem, Buffer.from(signature.valueBase64, "base64")); } catch { return false; }
}

export async function loadSignedExplorationTargetManifest(path: string, charter: ExplorationCharter, configDigest: string, options: { at?: string; trustStorePath?: string; nativeIdentityPolicy?: "validate-only" } = {}): Promise<{ manifest: ExplorationTargetManifest; sha256: string }> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute).catch(() => { throw new Error("探索target manifestが存在しません"); });
  return verifyTargetManifestBytes(bytes, charter, configDigest, { at: options.at, nativeIdentityPolicy: options.nativeIdentityPolicy, key: async keyId => {
    const trustPath = options.trustStorePath ?? charter.trustStorePath;
    if (!trustPath) throw new Error("real探索にはoperator trustStorePathが必要です");
    return uniqueTrustKey(await readTrustKeys(resolve(dirnameOf(absolute), trustPath)), keyId);
  } });
}

/** Validate an already-read snapshot without following any source-supplied paths. */
export async function verifySignedExplorationTargetManifestSnapshot(bytes: Uint8Array, charter: ExplorationCharter, configDigest: string, options: { at?: string; trustKeys: readonly TrustKey[]; nativeIdentityPolicy?: "validate-only" }): Promise<{ manifest: ExplorationTargetManifest; sha256: string }> {
  return verifyTargetManifestBytes(Buffer.from(bytes), charter, configDigest, { at: options.at, nativeIdentityPolicy: options.nativeIdentityPolicy, key: async keyId => uniqueTrustKey(options.trustKeys, keyId) });
}

async function verifyTargetManifestBytes(bytes: Buffer, charter: ExplorationCharter, configDigest: string, options: { at?: string; nativeIdentityPolicy?: "validate-only"; key: (keyId: string) => Promise<TrustKey | undefined> }): Promise<{ manifest: ExplorationTargetManifest; sha256: string }> {
  let value: ExplorationTargetManifest;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as ExplorationTargetManifest; } catch { throw new Error("探索target manifestが不正なJSONです"); }
  const nativeV2 = value?.schemaVersion === "lakda/exploration-target-manifest/v2";
  if (nativeV2) {
    if (options.nativeIdentityPolicy !== "validate-only") throw new Error("native identity v2の観測証跡読取は未接続です");
    if (bytes.length > 262144) throw new Error("native target capacity exceeded");
    const nativeTarget: typeof import("./native-identity-target.js") = await import("./native-identity-target.js");
    nativeTarget.assertNativeExplorationTargetManifest(value);
  } else {
    if (!manifestValidator(value)) throw new Error(`探索target manifest schemaが不正です: ${manifestValidator.errors?.map(error => `${error.instancePath} ${error.message}`).join("; ")}`);
    if (value?.schemaVersion !== EXPLORATION_TARGET_MANIFEST_VERSION || value.status !== "ready") throw new Error("探索target manifestのversion/statusが不正です");
  }
  if (value.charterDigest !== `sha256:${sha256(canonicalJson(charter))}`) throw new Error("探索target manifestのCharter bindingが不一致です");
  if (value.configDigest !== configDigest) throw new Error("探索target manifestのconfig bindingが不一致です");
  if (value.targetRevision !== charter.targetRevision || value.platform !== charter.platform || value.adapterId !== charter.adapter.id || value.executionMode !== charter.executionMode) throw new Error("探索target manifestのtarget/platform/adapter bindingが不一致です");
  const key = await options.key(value.signature.keyId);
  if (!key) throw new Error("探索target manifestの署名keyIdがtrust storeにありません");
  const payload = signingPayload(value);
  if (value.signature.signedPayloadDigest !== digest(payload)) throw new Error("探索target manifestのsigned payload digestが不一致です");
  const from = new Date(value.signature.validFrom).getTime();
  const until = new Date(value.signature.validUntil).getTime();
  const verificationTime = options.at ? new Date(options.at).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(until) || !Number.isFinite(verificationTime) || verificationTime < from || (nativeV2 ? verificationTime >= until : verificationTime > until)) throw new Error("探索target manifestの承認期限が不正または失効しています");
  const valid = (() => {
    try { return verify(null, Buffer.from(payload, "utf8"), key.publicKeyPem, Buffer.from(value.signature.valueBase64, "base64")); }
    catch { return false; }
  })();
  if (!valid) throw new Error("探索target manifestの署名検証に失敗しました");
  if (charter.baseUrl && value.target.identity.origin !== new URL(charter.baseUrl).origin) throw new Error("探索target manifestのoriginがCharterと不一致です");
  if ((charter.platform === "windows" || charter.platform === "android" || charter.platform === "ios") && value.target.identity.kind !== "native") throw new Error("native探索にはnative target identityが必要です");
  if ((charter.platform === "pc-web" || charter.platform === "mobile-web") && value.target.identity.kind !== "web") throw new Error("Web探索にはweb target identityが必要です");
  if (charter.platform === "windows" || charter.platform === "android" || charter.platform === "ios") {
    if (!value.target.identity.appId || (!nativeV2 && (!value.target.identity.appRevision || !value.target.identity.deviceAliasDigest))) throw new Error("native探索target manifestにはappId、v1ではappRevisionとdeviceAliasDigestが必要です");
    if (!charter.scope.native || charter.scope.native.appId !== value.target.identity.appId) throw new Error("native探索target manifestのappIdがCharter native scopeと不一致です");
  }
  if (charter.templateCorpus && value.target.templateCorpusDigest !== charter.templateCorpus.sha256) throw new Error("探索target manifestのtemplate corpus digestがCharterと不一致です");
  const allowedMutations = new Set(["none"]);
  if (value.safety.allowMutationKinds.some(kind => !allowedMutations.has(kind))) throw new Error("探索target manifestのmutation allowlistがCharterと不一致です");
  if (value.target.identity.pathPrefixes && charter.scope.pathPrefixes && value.target.identity.pathPrefixes.some(prefix => !charter.scope.pathPrefixes!.some(allowed => allowed === "/" || prefix === allowed || prefix.startsWith(`${allowed}/`)))) throw new Error("探索target manifestのpath scopeがCharter外です");
  if ("deviceAlias" in value.target.identity) throw new Error("探索target manifestにraw device aliasは保存できません。deviceAliasDigestを使用してください");
  if (value.target.identity.appId && value.target.identity.appId.length < 1) throw new Error("探索target manifestのappIdが空です");
  return { manifest: value, sha256: `sha256:${sha256(bytes)}` };
}

function dirnameOf(path: string): string { const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")); return index < 0 ? "." : path.slice(0, index); }

export function targetManifestSigningPayload(manifest: ExplorationTargetManifest): string { return signingPayload(manifest); }
export function targetManifestDigest(manifest: ExplorationTargetManifest): string { return digest(signingPayload(manifest)); }
export type ExplorationTargetBinding = { targetRevision: string; platform: ExplorationPlatform; adapterId: string; executionMode: ExplorationExecutionMode; capabilityDigest?: string; bridgeDigest?: string };
