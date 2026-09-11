import { assertAdaptiveContract } from "../adaptive/contracts.js";
import type { ExternalToolBridge } from "../adapters/external-bridges.js";
import { NativeIdentityError, nativeIdentityDigest } from "./native-identity-contracts.js";
import { createNativeIdentityExecutor, NativeExecutionError, type NativeExecutionAction, type NativeExecutionEvidenceSink } from "./native-identity-executor.js";
import { assertNativeExplorationTargetManifest } from "./native-identity-target.js";

type Input = Parameters<typeof createNativeIdentityExecutor>[0] & { bridge: ExternalToolBridge; evidence: NativeExecutionEvidenceSink };
const refused = () => new NativeIdentityError("native-bridge-unavailable");

/** Runner facade: input and recovery always use the signed, persisted execution path. */
export async function createNativeIdentityBridge(input: Input): Promise<ExternalToolBridge> {
  try {
    if (typeof input.evidence?.record !== "function" || !(input.targetBytes instanceof Uint8Array) || input.targetBytes.length > 262144) throw refused();
    const original = input.bridge, bytes = Buffer.from(input.targetBytes);
    const manifest: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    assertNativeExplorationTargetManifest(manifest);
    const capabilities = structuredClone(original.capabilities()); assertAdaptiveContract(capabilities);
    if (capabilities.adapterId !== "airtest-poco" || !original.binding) throw refused();
    const binding = original.binding.bind(original), expected = structuredClone(manifest.bridgeBinding);
    const checkBinding = () => { if (nativeIdentityDigest(binding()) !== nativeIdentityDigest(expected)) throw refused(); };
    const observe = original.observe.bind(original), generate = original.generateCandidates.bind(original);
    const discover = original.discoverCandidates?.bind(original);
    checkBinding();
    const executor = await createNativeIdentityExecutor({ ...input, targetBytes: bytes });
    let busy = false, stopped = false;
    const exclusive = async <T>(operation: () => Promise<T>, cleanup = false): Promise<T> => {
      if (busy || (stopped && !cleanup)) throw new NativeExecutionError(busy ? "native-bridge-busy" : "native-bridge-stopped", false);
      busy = true;
      try { return await operation(); }
      catch (error) { stopped = true; throw error instanceof NativeIdentityError ? error : refused(); }
      finally { busy = false; }
    };
    const read = <T>(operation: () => Promise<T>) => exclusive(async () => {
      checkBinding(); await executor.checkActive();
      const result = await operation();
      checkBinding(); await executor.checkActive();
      return result;
    });
    const perform = (action: NativeExecutionAction) => exclusive(async () => {
      checkBinding();
      const receipt = await executor.perform(action);
      try { checkBinding(); }
      catch { throw new NativeExecutionError("native-bridge-binding-changed", receipt.actionAttempted, receipt); }
      return receipt;
    });
    const result: ExternalToolBridge = {
      capabilities: () => structuredClone(capabilities), binding: () => structuredClone(expected),
      observe: (target, context) => { const args = structuredClone({ target, context }); return read(() => observe(args.target, args.context)); },
      generateCandidates: observation => { const value = structuredClone(observation); return read(() => generate(value)); },
      captureEvidence: request => {
        const value = structuredClone(request);
        if (!value.kinds.includes("screenshot")) return read(async () => []);
        return exclusive(async () => {
          if (!value.stagingDir) throw refused();
          const receipt = await executor.capture({ operation: "screenshot", payload: { runId: value.runId, stagingDir: value.stagingDir } });
          return receipt.result.artifactRefs;
        });
      },
      async execute(candidate, context) {
        const receipt = await perform({ operation: "execute", payload: { candidate, context } });
        if (receipt.operation !== "execute") throw refused();
        return receipt.result;
      },
      async recover(failure, context) {
        const receipt = await perform({ operation: "recover", payload: { failure, context } });
        if (receipt.operation !== "recover") throw refused();
        return receipt.result;
      },
    };
    if (discover) result.discoverCandidates = (observation, fingerprint) => {
      const args = structuredClone({ observation, fingerprint }); return read(() => discover(args.observation, args.fingerprint));
    };
    result.captureControl = request => {
      const { action, ...payload } = structuredClone(request);
      return exclusive(async () => {
        const receipt = await executor.capture({ operation: action, payload });
        if (receipt.result.mode === "screenshot") throw refused();
        return { ...receipt.result, mode: receipt.result.mode };
      }, action === "stop" || action === "discard");
    };
    return Object.freeze(result);
  } catch { throw refused(); }
}
