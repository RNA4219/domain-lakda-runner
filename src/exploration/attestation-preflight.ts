import { lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isContained } from "../runs/catalog-values.js";
import { AttestationContractError } from "./attestation-contracts.js";
import { readAttestationTrustSnapshot, type AttestationBinding } from "./attestation-evidence.js";
import { AttestationDirectory } from "./attestation-io.js";
import { assertAttestationTrust } from "./attestation-response.js";

export type BinaryAttestationRunOptions = { stagingRoot: string; targetManifestSha256: string; policyDigest: string; sessionId?: string; timeoutMs?: number };
const id = (value: unknown) => typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);

async function assertPrivateStorage(stagingRoot: string, publicRoots: readonly string[]) {
  const reject = () => new AttestationContractError("private-staging-in-public-storage");
  for (const root of publicRoots) {
    const expected = resolve(root);
    let actual: string;
    try { actual = await realpath(expected); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; actual = expected; }
    if (isContained(expected, stagingRoot) || isContained(actual, stagingRoot)) throw reject();
  }
  for (let directory = stagingRoot; ; directory = dirname(directory)) {
    for (const ref of ["exports/artifact-manifest.json", "run-start.json"]) {
      try { await lstat(join(directory, ref)); throw reject(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (dirname(directory) === directory) break;
  }
}

/** Static setup is also checked before the exploration command probes its target. */
export async function validateBinaryAttestationSetup(options: BinaryAttestationRunOptions, trustStorePath?: string, allowedKeyIds?: readonly string[], publicRoots: readonly string[] = []) {
  try {
    options = { ...options };
    if (!options || Object.keys(options).some(key => !["stagingRoot", "targetManifestSha256", "policyDigest", "sessionId", "timeoutMs"].includes(key))
      || typeof options.stagingRoot !== "string" || !options.stagingRoot.trim() || options.stagingRoot.length > 4096
      || ![options.policyDigest, options.targetManifestSha256].every(value => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value))
      || options.sessionId !== undefined && !id(options.sessionId)
      || !Number.isSafeInteger(options.timeoutMs ?? 30000) || (options.timeoutMs ?? 30000) < 1000 || (options.timeoutMs ?? 30000) > 300000
      || typeof trustStorePath !== "string" || !trustStorePath || !allowedKeyIds) throw new AttestationContractError("setup-invalid");
    const stagingRoot = resolve(options.stagingRoot), entry = await lstat(stagingRoot);
    if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(stagingRoot) !== stagingRoot) throw new AttestationContractError("staging-root-invalid");
    await assertPrivateStorage(stagingRoot, publicRoots);
    const trust = await readAttestationTrustSnapshot(trustStorePath), context = { trustKeys: trust.keys, allowedKeyIds: [...allowedKeyIds] };
    assertAttestationTrust(context);
    return { options: { ...options, stagingRoot, timeoutMs: options.timeoutMs ?? 30000 }, trust, context };
  } catch (error) { throw error instanceof AttestationContractError ? error : new AttestationContractError("preflight-failed"); }
}

export async function prepareBinaryAttestationRun(options: BinaryAttestationRunOptions, runDirectory: string, runId: string,
  trustStorePath?: string, allowedKeyIds?: readonly string[], required = false) {
  try {
    if (!required || !id(runId)) throw new AttestationContractError("setup-invalid");
    const setup = await validateBinaryAttestationSetup(options, trustStorePath, allowedKeyIds, [dirname(resolve(runDirectory))]);
    const io = await AttestationDirectory.create(setup.options.stagingRoot, runDirectory);
    const binding: AttestationBinding = { runId, ...(setup.options.sessionId === undefined ? {} : { sessionId: setup.options.sessionId }),
      targetManifestSha256: setup.options.targetManifestSha256, policyDigest: setup.options.policyDigest };
    return { ...setup, io, binding };
  } catch (error) { throw error instanceof AttestationContractError ? error : new AttestationContractError("preflight-failed"); }
}

export type PreparedBinaryAttestationRun = Awaited<ReturnType<typeof prepareBinaryAttestationRun>>;
