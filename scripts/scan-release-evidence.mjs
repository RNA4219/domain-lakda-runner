import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { findSensitive } from "../dist/core/redaction.js";

const args = process.argv.slice(2);
const roots = args.filter(value => value.startsWith("--path=")).map(value => resolve(value.slice("--path=".length)));
const output = args.find(value => value.startsWith("--out="))?.slice("--out=".length);
if (roots.length === 0) throw new Error("usage: scan-release-evidence --path=<file-or-dir> [--path=...] [--out=<result.json>]");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const allowedExtensions = /\.(?:json|jsonl|md|txt|xml|info|ya?ml)$/i;

async function list(path) {
  const metadata = await stat(path);
  if (metadata.isFile()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("evidenceにsymlinkを含めてはいけません: " + entry.name);
    files.push(...await list(resolve(path, entry.name)));
  }
  return files;
}

const descriptors = [];
for (const root of roots) {
  for (const path of await list(root)) {
    if (!allowedExtensions.test(path)) throw new Error("未対応evidence形式です: " + path);
    const bytes = await readFile(path);
    if (bytes.includes(0)) throw new Error("binary evidenceをsanitized packageへ含めてはいけません: " + path);
    const text = bytes.toString("utf8");
    const findings = findSensitive(text);
    if (findings.length) throw new Error("evidence security scan失敗: " + path + " (" + findings.join(",") + ")");
    if (/[A-Za-z]:\\Users\\|\/home\/[^/]+\//i.test(text)) throw new Error("evidenceに絶対user pathがあります: " + path);
    if (/https:\/\/[^\s/@:]+:[^\s/@]+@/i.test(text)) throw new Error("evidence URLにuserinfoがあります: " + path);
    if (/"(?:rawPrompt|raw_request|rawResponse|authorization|cookie|set-cookie)"\s*:/i.test(text)) throw new Error("evidenceに禁止raw/credential fieldがあります: " + path);
    const rootMetadata = await stat(root);
    const rel = rootMetadata.isFile() ? basename(path) : relative(root, path).replaceAll("\\", "/");
    descriptors.push({ root: basename(root), path: rel, size: bytes.length, sha256: sha256(bytes) });
  }
}
descriptors.sort((left, right) => left.root.localeCompare(right.root) || left.path.localeCompare(right.path));
const result = { schemaVersion: "lakda/release-evidence-security-scan/v1", status: "passed", files: descriptors };
if (output) {
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(result, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify(result, null, 2));