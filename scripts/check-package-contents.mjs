import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const commercialLicense = readFileSync(resolve(root, "COMMERCIAL-LICENSE.md"), "utf8");
if (commercialLicense.includes("[COMMERCIAL_CONTACT]")) {
  throw new Error("COMMERCIAL-LICENSE.md still contains [COMMERCIAL_CONTACT]");
}
if (!commercialLicense.includes("https://licensing.rna4219.com/")) {
  throw new Error("COMMERCIAL-LICENSE.md is missing the public licensing portal");
}
const readmeVersion = readme.match(/現在の候補版は `([^`]+)`/)?.[1];
if (readmeVersion !== packageJson.version) {
  throw new Error(`README.md version mismatch: expected ${packageJson.version}, got ${readmeVersion ?? "missing"}`);
}
for (const [label, version] of [
  ["package-lock.json top level", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
]) {
  if (version !== packageJson.version) throw new Error(`${label} version mismatch: expected ${packageJson.version}, got ${version}`);
}
for (const path of ["src/index.ts", "src/core/artifacts.ts", "src/core/hate.ts"]) {
  const versions = new Set(readFileSync(resolve(root, path), "utf8").match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/g) ?? []);
  if (versions.size !== 1 || !versions.has(packageJson.version)) {
    throw new Error(`${path} version mismatch: expected only ${packageJson.version}, got ${[...versions].join(", ") || "missing"}`);
  }
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable");
const output = execFileSync(process.execPath, [npmCli, "pack", "--dry-run", "--json"], { encoding: "utf8" });
const records = JSON.parse(output);
if (!Array.isArray(records) || records.length !== 1 || !Array.isArray(records[0].files)) {
  throw new Error("npm pack dry-run output is invalid");
}
if (records[0].version !== packageJson.version) {
  throw new Error(`npm pack version mismatch: expected ${packageJson.version}, got ${records[0].version}`);
}
const files = new Set(records[0].files.map(entry => String(entry.path).replaceAll("\\", "/")));
const requiredRuntimeFiles = [
  "dist/cli.js",
  "dist/core/hate.js",
  "schemas/lakda-config-v1.schema.json",
  "vendor/hate/v1/artifact-manifest.schema.json",
];
for (const path of requiredRuntimeFiles) {
  if (!files.has(path)) throw new Error("runtime package is missing required file: " + path);
}
const publicSchemas = readdirSync(resolve(root, "schemas"), { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith(".schema.json"))
  .map(entry => "schemas/" + entry.name)
  .sort();
for (const path of publicSchemas) {
  if (!files.has(path)) throw new Error("runtime package is missing public schema: " + path);
}
const packagedExamples = readdirSync(resolve(root, "examples"), { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => "examples/" + entry.name)
  .sort();
if (packagedExamples.length === 0) throw new Error("examples directory is empty");
for (const path of packagedExamples) {
  if (!files.has(path)) throw new Error("runtime package is missing example: " + path);
}
const requiredLicenseFiles = [
  "LICENSE",
  "LICENSE.ja.md",
  "NOTICE",
  "LICENSING.md",
  "COMMERCIAL-LICENSE.md",
  "THIRD_PARTY_NOTICES.md",
  "vendor/hate/LICENSE",
];
for (const path of requiredLicenseFiles) {
  if (!files.has(path)) throw new Error("runtime package is missing required license file: " + path);
}
console.log(JSON.stringify({ status: "passed", fileCount: files.size, requiredRuntimeFiles, publicSchemas, packagedExamples, requiredLicenseFiles }));
