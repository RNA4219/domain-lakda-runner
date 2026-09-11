import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadReportTrustStore, verifyReportTrustStoreUnchanged } from "../src/reporting/trust-store.js";

test("operator trust snapshots reject ambiguous keys, private keys, excessive input and changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lakda-report-trust-"));
  const path = join(root, "keys.json");
  const pair = generateKeyPairSync("ed25519");
  const key = { keyId: "fixture", publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString() };
  try {
    for (const value of [[key], { keys: [key] }]) {
      await writeFile(path, JSON.stringify(value));
      const trust = await loadReportTrustStore(path);
      expect(trust.keys).toEqual([key]); expect(trust.snapshot.bytes).toBeUndefined();
      await verifyReportTrustStoreUnchanged(trust);
      await writeFile(path, JSON.stringify(value) + " ");
      await expect(verifyReportTrustStoreUnchanged(trust)).rejects.toMatchObject({ issueCode: "source-not-finalized" });
    }
    const invalid = [[], [key, key], { keys: [key], revoked: ["fixture"] }, [{ ...key, revoked: true }],
      [{ ...key, publicKeyPem: "not a public key" }], [{ ...key, publicKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }],
      Array.from({ length: 65 }, (_, index) => ({ ...key, keyId: "key-" + index })), [{ ...key, keyId: "bad\nkey" }]];
    for (const value of invalid) {
      await writeFile(path, JSON.stringify(value));
      await expect(loadReportTrustStore(path)).rejects.toMatchObject({ issueCode: "invalid-trust-store" });
    }
    await writeFile(path, Buffer.alloc(128 * 1024 + 1, 0x20));
    await expect(loadReportTrustStore(path)).rejects.toMatchObject({ issueCode: "invalid-trust-store" });
    await writeFile(path, Buffer.from([0xff, 0xfe]));
    await expect(loadReportTrustStore(path)).rejects.toMatchObject({ issueCode: "invalid-trust-store" });
    const abort = new AbortController(); abort.abort(new Error("stop trust read"));
    await expect(loadReportTrustStore(path, abort.signal)).rejects.toThrow("stop trust read");
  } finally { await rm(root, { recursive: true, force: true }); }
});
