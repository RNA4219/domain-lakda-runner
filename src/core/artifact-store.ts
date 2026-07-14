import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { redact, sha256 } from "./redaction.js";
import { canonicalJson } from "./plan.js";

export type ArtifactSecurityRecord = {
  redactionStatus: "not_required" | "redacted" | "pending" | "failed";
  secretsScan: "pass" | "fail" | "not_applicable";
  piiScan: "pass" | "fail" | "not_applicable";
};

export async function writeCanonicalJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${redact(canonicalJson(value))}
`, "utf8");
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${redact(JSON.stringify(value, null, 2))}
`, "utf8");
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try { await writeJson(temporary, value); await rename(temporary, path); }
  finally { try { await stat(temporary); await rm(temporary, { force: true }); } catch { /* already renamed or unavailable */ } }
}

export function serializeTextArtifact(value: string): string {
  const redacted = redact(value);
  return redacted.endsWith("\n") ? redacted : `${redacted}\n`;
}

export async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeTextArtifact(value), "utf8");
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

export async function fileDigest(path: string): Promise<{ size: number; sha256: string }> {
  const buffer = await readFile(path);
  return { size: (await stat(path)).size, sha256: sha256(buffer) };
}

export async function runSizeBytes(runDir: string): Promise<number> {
  const sizes = await Promise.all((await listFiles(runDir)).map(async path => (await stat(path)).size));
  return sizes.reduce((total, size) => total + size, 0);
}

export async function runSizeExceeds(runDir: string, maximum: number): Promise<boolean> {
  return (await runSizeBytes(runDir)) > maximum;
}

export function isRunDirectory(path: string): boolean {
  return existsSync(join(path, "run-metadata.json"));
}

export function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}