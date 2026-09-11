import { createPublicKey } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { sha256 } from "../core/redaction.js";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import type { ExplorationCharter } from "./contracts.js";
import { NativeIdentityError, nativeIdentityDigest } from "./native-identity-contracts.js";
import { assertNativeExplorationTargetManifest } from "./native-identity-target.js";
import { readNativeEvidenceBytes } from "./native-identity-evidence-io.js";
import { readSessionNativeEvidence } from "./native-identity-evidence-store.js";
import { sessionPaths, type ExplorationSessionPaths } from "./session.js";
import { verifySignedExplorationTargetManifestSnapshot } from "./target-manifest.js";

type TrustKey = { keyId: string; publicKeyPem: string };
type Options = { charter: ExplorationCharter; configDigest: string; trustKeys?: readonly TrustKey[]; trustStorePath?: string; signal?: AbortSignal };
const refused = () => new NativeIdentityError("native-evidence-target-invalid");
const parse = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

function keys(value: unknown): TrustKey[] {
  const list = Array.isArray(value) ? value : value && typeof value === "object" && Object.keys(value).length === 1 && "keys" in value ? value.keys : undefined;
  if (!Array.isArray(list) || !list.length || list.length > 64) throw refused();
  const ids = new Set<string>();
  return list.map((item: unknown) => {
    if (!item || typeof item !== "object" || Object.keys(item).sort().join() !== "keyId,publicKeyPem") throw refused();
    const { keyId, publicKeyPem } = item as TrustKey;
    if (typeof keyId !== "string" || !keyId.trim() || keyId.length > 128 || [...keyId].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || ids.has(keyId)
      || typeof publicKeyPem !== "string" || publicKeyPem.length > 4096
      || !/^-----BEGIN PUBLIC KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(publicKeyPem)
      || createPublicKey(publicKeyPem).asymmetricKeyType !== "ed25519") throw refused();
    ids.add(keyId); return { keyId, publicKeyPem };
  });
}

/** Read operator-selected keys without following any path from saved evidence. */
export async function readNativeIdentityTrustKeys(path: string): Promise<TrustKey[]> {
  try {
    const absolute = resolve(path), signal = AbortSignal.timeout(5000);
    const snapshot = await readArtifactSnapshot(dirname(absolute), basename(absolute), { retain: true, maxBytes: 131072, signal });
    const trusted = keys(parse(snapshot.bytes!));
    await readArtifactSnapshot(dirname(absolute), basename(absolute), { maxBytes: 131072, expected: snapshot, signal });
    return trusted;
  } catch { throw refused(); }
}

/** Historical proof verification only; it never connects to a target or authorizes an action. */
export async function readSignedSessionNativeEvidence(suppliedPaths: ExplorationSessionPaths, supplied: Options) {
  try {
    const paths = sessionPaths(suppliedPaths.root);
    const { charter, configDigest, trustKeys, trustStorePath } = structuredClone({ charter: supplied.charter,
      configDigest: supplied.configDigest, trustKeys: supplied.trustKeys, trustStorePath: supplied.trustStorePath });
    const signal = AbortSignal.any([AbortSignal.timeout(5000), ...(supplied.signal ? [supplied.signal] : [])]);
    signal.throwIfAborted();
    if ((trustKeys !== undefined) === (trustStorePath !== undefined)) throw refused();
    const trustPath = trustStorePath === undefined ? undefined : resolve(trustStorePath);
    const trust = trustPath === undefined ? undefined : await readArtifactSnapshot(dirname(trustPath), basename(trustPath), { retain: true, maxBytes: 131072, signal });
    const trusted = keys(trust ? parse(trust.bytes!) : trustKeys);
    const bytes = await readNativeEvidenceBytes(paths.root, "target-manifest.json", 262144, signal);
    const manifest = parse(bytes); assertNativeExplorationTargetManifest(manifest);
    const evidence = await readSessionNativeEvidence(paths, { manifest, sha256: `sha256:${sha256(bytes)}` }, signal);
    const first = evidence.records[0]?.evidence;
    if (first?.kind !== "observation") throw refused();
    const target = await verifySignedExplorationTargetManifestSnapshot(bytes, charter, configDigest,
      { at: new Date(first.acquisition.now).toISOString(), trustKeys: trusted, nativeIdentityPolicy: "validate-only" });
    assertNativeExplorationTargetManifest(target.manifest);
    if (trust) await readArtifactSnapshot(dirname(trust.path), basename(trust.path), { maxBytes: 131072, expected: trust, signal });
    signal.throwIfAborted();
    return { ...evidence, target: { manifest: target.manifest, sha256: target.sha256 } };
  } catch { throw refused(); }
}

/** Bind a verified journal to the exact source and record bytes indexed by HATE. */
export function verifyNativeEvidenceArtifactIndex(evidence: Awaited<ReturnType<typeof readSessionNativeEvidence>>,
  artifacts: readonly { path: string; sha256?: unknown; size_bytes?: unknown }[]): void {
  const sources = ["session.json", "events.jsonl", "target-manifest.json", "charter.json"].map(path => {
    const matches = artifacts.filter(item => item.path === path);
    if (matches.length !== 1 || typeof matches[0]!.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(matches[0]!.sha256)) throw refused();
    return matches[0]!.sha256.slice(7);
  });
  if (nativeIdentityDigest(sources) !== evidence.sourceDigest) throw refused();
  const native = artifacts.filter(item => item.path.startsWith("native-identity/"));
  if (native.length !== evidence.references.length) throw refused();
  const indexed = new Map(native.map(item => [item.path, item]));
  if (indexed.size !== native.length) throw refused();
  for (const ref of evidence.references) {
    const artifact = indexed.get(ref.path);
    if (artifact?.sha256 !== ref.sha256 || artifact?.size_bytes !== ref.size) throw refused();
  }
}

/** Detect native proof inputs without accepting malformed target documents or following archived trust paths. */
export async function sessionHasNativeEvidence(suppliedPaths: ExplorationSessionPaths, requestedSignal?: AbortSignal): Promise<boolean> {
  const paths = sessionPaths(suppliedPaths.root);
  const signal = AbortSignal.any([AbortSignal.timeout(5000), ...(requestedSignal ? [requestedSignal] : [])]);
  signal.throwIfAborted();
  const exists = async (path: string) => {
    try { await lstat(path); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw refused(); }
  };
  if (await exists(resolve(paths.root, "native-identity"))) return true;
  const events = await readNativeEvidenceBytes(paths.root, "events.jsonl", 32 * 1024 * 1024, signal);
  if (events.toString("utf8").includes('"nativeEvidenceRef"')) return true;
  if (!(await exists(paths.targetManifest))) return false;
  try {
    const value = parse(await readNativeEvidenceBytes(paths.root, "target-manifest.json", 262144, signal));
    return !!value && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === "lakda/exploration-target-manifest/v2";
  } catch { throw refused(); }
}
