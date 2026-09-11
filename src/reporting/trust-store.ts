import { createPublicKey } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { readArtifactSnapshot, type ArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { ReportInputError } from "./contracts.js";

export type ReportTrustKey = { keyId: string; publicKeyPem: string };
export type ReportTrustStore = { requestedPath: string; snapshot: ArtifactSnapshot; keys: readonly ReportTrustKey[] };
const maxBytes = 128 * 1024;
const invalid = () => new ReportInputError("invalid-trust-store", "媒体署名の鍵一覧が不正、または上限を超えています");

/** Only an operator-selected file is read; archived metadata never selects trust. */
export async function loadReportTrustStore(path: string, signal?: AbortSignal): Promise<ReportTrustStore> {
  signal?.throwIfAborted();
  const requestedPath = resolve(path);
  try {
    const actual = await realpath(requestedPath);
    const snapshot = await readArtifactSnapshot(dirname(actual), basename(actual), { retain: true, maxBytes, signal });
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes));
    const list: unknown = Array.isArray(value) ? value : value && typeof value === "object" && Object.keys(value).length === 1 && "keys" in value ? value.keys : undefined;
    if (!Array.isArray(list) || !list.length || list.length > 64) throw invalid();
    const ids = new Set<string>();
    const keys: ReportTrustKey[] = [];
    for (const item of list) {
      signal?.throwIfAborted();
      if (!item || typeof item !== "object" || Object.keys(item).length !== 2 || typeof item.keyId !== "string" || typeof item.publicKeyPem !== "string") throw invalid();
      const { keyId, publicKeyPem } = item as ReportTrustKey;
      if (!keyId.trim() || keyId.length > 128 || [...keyId].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || ids.has(keyId)) throw invalid();
      if (publicKeyPem.length > 4096 || !/^-----BEGIN PUBLIC KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(publicKeyPem)
        || createPublicKey(publicKeyPem).asymmetricKeyType !== "ed25519") throw invalid();
      ids.add(keyId); keys.push({ keyId, publicKeyPem });
    }
    signal?.throwIfAborted();
    if (await realpath(requestedPath) !== actual) throw invalid();
    return { requestedPath, snapshot: { path: snapshot.path, size: snapshot.size, sha256: snapshot.sha256 }, keys };
  } catch (error) {
    signal?.throwIfAborted();
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code && ["EACCES", "EPERM", "EIO", "EMFILE", "ENFILE", "ENOMEM", "ENOSPC", "EROFS", "ENOENT", "ENOTDIR"].includes(code)) throw error;
    throw invalid();
  }
}

export async function verifyReportTrustStoreUnchanged(trust: ReportTrustStore, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  try {
    if (await realpath(trust.requestedPath) !== trust.snapshot.path) throw new Error("changed trust path");
    await readArtifactSnapshot(dirname(trust.snapshot.path), basename(trust.snapshot.path), { maxBytes, expected: trust.snapshot, signal });
  } catch {
    signal?.throwIfAborted();
    throw new ReportInputError("source-not-finalized", "生成中に媒体署名の鍵一覧が変更されたため公開できません");
  }
}
