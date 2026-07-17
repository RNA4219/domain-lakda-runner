import { execFileSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable");
const output = execFileSync(process.execPath, [npmCli, "pack", "--dry-run", "--json"], { encoding: "utf8" });
const records = JSON.parse(output);
if (!Array.isArray(records) || records.length !== 1 || !Array.isArray(records[0].files)) {
  throw new Error("npm pack dry-run output is invalid");
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
console.log(JSON.stringify({ status: "passed", fileCount: files.size, requiredRuntimeFiles, requiredLicenseFiles }));
