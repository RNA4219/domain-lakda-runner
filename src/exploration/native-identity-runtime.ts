import { dirname, resolve } from "node:path";
import type { ExternalToolBridge } from "../adapters/external-bridges.js";
import type { ExplorationCharter } from "./contracts.js";
import { createNativeIdentityBridge } from "./native-identity-bridge.js";
import { NativeIdentityError } from "./native-identity-contracts.js";
import type { NativeEvidenceTarget } from "./native-identity-evidence.js";
import { readNativeEvidenceBytes } from "./native-identity-evidence-io.js";
import { createSessionNativeEvidenceSink, readSessionNativeEvidence } from "./native-identity-evidence-store.js";
import { readNativeIdentityTrustKeys } from "./native-identity-evidence-target.js";
import type { ExplorationSessionPaths } from "./session.js";
import { verifySignedExplorationTargetManifestSnapshot } from "./target-manifest.js";

/** Validate saved proof before bridge connection; obtain a new identity only when connecting. */
export async function prepareNativeIdentityRuntime(paths: ExplorationSessionPaths, charter: ExplorationCharter,
  configDigest: string, target: NativeEvidenceTarget, requirePrior: boolean) {
  try {
    if (!charter.targetManifestPath || !charter.trustStorePath) throw new Error();
    const trustStorePath = resolve(dirname(resolve(charter.targetManifestPath)), charter.trustStorePath);
    const trustKeys = await readNativeIdentityTrustKeys(trustStorePath);
    const targetBytes = await readNativeEvidenceBytes(paths.root, "target-manifest.json", 262144, AbortSignal.timeout(5000));
    const loaded = await verifySignedExplorationTargetManifestSnapshot(targetBytes, charter, configDigest, { trustKeys, nativeIdentityPolicy: "validate-only" });
    if (loaded.sha256 !== target.sha256) throw new Error();
    const proof = await readSessionNativeEvidence(paths, target);
    if ((requirePrior || proof.records.length > 0) && !proof.complete) throw new Error();
    return { trustStorePath, async connect(bridge: ExternalToolBridge) {
      const evidence = await createSessionNativeEvidenceSink(paths, target);
      return createNativeIdentityBridge({ charter, configDigest, targetBytes, trustKeys, bridge, evidence });
    } };
  } catch { throw new NativeIdentityError("native-runtime-preflight-invalid"); }
}
