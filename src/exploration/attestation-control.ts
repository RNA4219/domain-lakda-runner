import { lstat, readdir, realpath, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { ArtifactCollector } from "../core/artifacts.js";
import { readArtifactSnapshot } from "../runs/artifact-snapshot.js";
import { AttestationContractError } from "./attestation-contracts.js";

/** Commands are immutable files published by the operator CLI. No capture is initiated here. */
export function createAttestationStopCheck(collector: ArtifactCollector, controlFile?: string): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined;
  const inspect = async () => {
    if (collector.metadata.operatorControl) return true;
    if (!controlFile) return false;
    const path = resolve(controlFile);
    let entry;
    try { entry = await lstat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
    if (entry.isSymbolicLink() || await realpath(path) !== path || !entry.isDirectory() && !entry.isFile()) throw new AttestationContractError("control-invalid");
    const root = entry.isDirectory() ? path : dirname(path);
    const names = entry.isDirectory() ? (await readdir(root)).filter(name => name.endsWith(".json")).sort() : [basename(path)];
    for (const name of names) {
      const snapshot = await readArtifactSnapshot(root, name, { retain: true, maxBytes: 65536 });
      if (snapshot.path !== resolve(root, name)) throw new AttestationContractError("control-invalid");
      const control: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes));
      if (!control || typeof control !== "object" || !("command" in control)) throw new AttestationContractError("control-invalid");
      if (control.command === "bookmark") continue;
      if (control.command !== "pause" && control.command !== "kill") throw new AttestationContractError("control-invalid");
      const requestId = "requestId" in control ? control.requestId : undefined;
      if (requestId !== undefined && (typeof requestId !== "string" || requestId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(requestId))) throw new AttestationContractError("control-invalid");
      await readArtifactSnapshot(root, name, { expected: snapshot, maxBytes: 65536 });
      collector.metadata.operatorControl = { command: control.command, ...(requestId === undefined ? {} : { requestId }) };
      if (entry.isDirectory()) await unlink(snapshot.path);
      return true;
    }
    return false;
  };
  return () => pending ??= inspect().catch(error => { throw error instanceof AttestationContractError ? error : new AttestationContractError("control-read-failed"); }).finally(() => { pending = undefined; });
}
