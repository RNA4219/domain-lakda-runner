import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { findSensitive } from "../dist/core/redaction.js";

const rootArg = process.argv.find(value => value.startsWith("--path="))?.slice("--path=".length);
const outputArg = process.argv.find(value => value.startsWith("--out="))?.slice("--out=".length);
const profileArg = process.argv.find(value => value.startsWith("--release-profile="))?.slice("--release-profile=".length) ?? "release-profiles/current.json";
if (!rootArg) throw new Error("usage: scan-release-package --path=<unpacked-package> [--out=<result.json>] [--release-profile=<profile.json>]");
const root = resolve(rootArg);
const allowedTopLevels = new Set([
  "CHANGELOG.md", "LICENSE", "LICENSE.ja.md", "NOTICE", "LICENSING.md",
  "COMMERCIAL-LICENSE.md", "THIRD_PARTY_NOTICES.md", "README.md", "RUNBOOK.md",
  "dist", "examples", "package.json", "schemas", "vendor",
]);
const allowedExtensions = new Set([".js", ".ts", ".map", ".json", ".md"]);
const allowedExtensionless = new Set(["LICENSE", "NOTICE"]);
const requiredPaths = [
  "CHANGELOG.md", "LICENSE", "LICENSE.ja.md", "NOTICE", "LICENSING.md",
  "COMMERCIAL-LICENSE.md", "THIRD_PARTY_NOTICES.md", "README.md", "RUNBOOK.md",
  "dist/index.js", "dist/index.d.ts", "package.json",
  "schemas/adaptive-contracts-v1.schema.json", "schemas/lakda-config-v1.schema.json",
  "vendor/hate/LICENSE", "vendor/hate/v1/artifact-manifest.schema.json",
];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function list(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("release package must not contain symlinks: " + entry.name);
    const child = resolve(path, entry.name);
    files.push(...(entry.isDirectory() ? await list(child) : [child]));
  }
  return files;
}

const descriptors = [];
for (const path of await list(root)) {
  const portable = relative(root, path).replaceAll("\\", "/");
  const topLevel = portable.split("/")[0];
  if (!allowedTopLevels.has(topLevel)) throw new Error("release package contains an unexpected top-level path: " + portable);
  if (!allowedExtensionless.has(basename(path)) && !allowedExtensions.has(extname(path))) throw new Error("release package contains an unsupported file type: " + portable);
  const bytes = await readFile(path);
  if (bytes.includes(0)) throw new Error("release package contains a binary or NUL byte: " + portable);
  const text = bytes.toString("utf8");
  const sensitiveText = portable === "COMMERCIAL-LICENSE.md"
    ? text.replace(/^Contact:\s*.+$/m, "Contact: PUBLIC_COMMERCIAL_CONTACT")
    : text;
  const sensitive = findSensitive(sensitiveText);
  if (sensitive.length) throw new Error("release package sensitive scan failed: " + portable + " (" + sensitive.join(",") + ")");
  if (/[A-Za-z]:\\Users\\|\/home\/[^/]+\//i.test(text)) throw new Error("release package contains an absolute user path: " + portable);
  if (/https:\/\/[^\s/@:]+:[^\s/@]+@/i.test(text)) throw new Error("release package URL contains userinfo: " + portable);
  descriptors.push({ path: portable, size: (await stat(path)).size, sha256: sha256(bytes) });
}
descriptors.sort((left, right) => left.path.localeCompare(right.path));
const paths = new Set(descriptors.map(value => value.path));
for (const required of requiredPaths) if (!paths.has(required)) throw new Error("release package is missing a required file: " + required);
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const releaseProfile = JSON.parse(await readFile(resolve(profileArg), "utf8"));
if (releaseProfile.schemaVersion !== "lakda/release-profile/v1" || typeof releaseProfile.releaseVersion !== "string") throw new Error("release profile contract mismatch");
if (packageJson.version !== releaseProfile.releaseVersion || packageJson.private !== true || packageJson.main !== "./dist/index.js" || packageJson.types !== "./dist/index.d.ts" || packageJson.exports?.["."]?.import !== "./dist/index.js") {
  throw new Error("release package metadata contract mismatch");
}
const commercialLicense = await readFile(resolve(root, "COMMERCIAL-LICENSE.md"), "utf8");
if (commercialLicense.includes("[COMMERCIAL_CONTACT]")) {
  throw new Error("COMMERCIAL-LICENSE.md still contains [COMMERCIAL_CONTACT]");
}
if (!commercialLicense.includes("https://licensing.rna4219.com/")) {
  throw new Error("COMMERCIAL-LICENSE.md is missing the public licensing portal");
}
const readme = await readFile(resolve(root, "README.md"), "utf8");
const readmeVersion = readme.match(/現在の候補版は `([^`]+)`/)?.[1];
if (readmeVersion !== packageJson.version) {
  throw new Error(`README.md version mismatch: expected ${packageJson.version}, got ${readmeVersion ?? "missing"}`);
}
const result = { schemaVersion: "lakda/release-package-security-scan/v1", status: "passed", packageVersion: packageJson.version, files: descriptors };
if (outputArg) {
  const output = resolve(outputArg);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify({ schemaVersion: result.schemaVersion, status: result.status, packageVersion: result.packageVersion, fileCount: descriptors.length }));
