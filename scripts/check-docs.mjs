import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".git", "dist"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : extname(path) === ".md" ? [path] : [];
  });
}

for (const path of walk(root)) {
  const text = readFileSync(path, "utf8");
  if ((text.match(/^```/gm) ?? []).length % 2 !== 0) failures.push(`${basename(path)}: unclosed code fence`);
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = decodeURIComponent(match[1].replace(/[<>]/g, "").split("#")[0]);
    if (target && !/^(https?:|mailto:)/.test(target) && !statSync(resolve(dirname(path), target), { throwIfNoEntry: false })) {
      failures.push(`${basename(path)}: broken link ${target}`);
    }
  }
  for (const json of text.matchAll(/^```json\s*\r?\n([\s\S]*?)^```/gm)) {
    try { JSON.parse(json[1]); } catch { failures.push(`${basename(path)}: invalid JSON fence`); }
  }
}

const requirements = readFileSync(resolve(root, "REQUIREMENTS.md"), "utf8");
const specification = readFileSync(resolve(root, "SPECIFICATION.md"), "utf8");
const evaluation = readFileSync(resolve(root, "EVALUATION.md"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (packageJson.version !== "0.2.1") failures.push("package.json: expected version 0.2.1, got " + packageJson.version);
for (const id of [...new Set(requirements.match(/AC-\d{8}-\d{2}|AC-\d{3}/g) ?? [])]) {
  if (!specification.includes(id)) failures.push("SPECIFICATION.md: missing " + id);
  if (!evaluation.includes(id)) failures.push("EVALUATION.md: missing " + id);
}
for (const requiredPath of ["docs/tasks/TASK.20260713-06.md", "docs/acceptance/AC-20260713-05.v021-hardening-fixture.json", "docs/acceptance/AC-20260713-06.v021-hardening-real-llm.json"]) {
  if (!statSync(resolve(root, requiredPath), { throwIfNoEntry: false })) failures.push("missing required evidence " + requiredPath);
}
const require = createRequire(import.meta.url);
const hateSchema = JSON.parse(readFileSync(resolve(root, "vendor/hate/v1/artifact-manifest.schema.json"), "utf8"));
const Ajv = require("ajv/dist/2020").default;
const hateValidate = new Ajv({ allErrors: true, strict: false }).compile(hateSchema);
for (const path of walk(root)) {
  const text = readFileSync(path, "utf8");
  for (const json of text.matchAll(/^```json\s*\r?\n([\s\S]*?)^```/gm)) {
    let value;
    try { value = JSON.parse(json[1]); } catch { continue; }
    if (value && value.schema_version === "HATE/v1" && !hateValidate(value)) failures.push(basename(path) + ": HATE/v1 example does not match vendor schema");
  }
}
for (const id of [...new Set(requirements.match(/REQ-(?:FN|LLM|NF|SEC)-\d+/g) ?? [])]) {
  if (!specification.includes(id)) failures.push(`SPECIFICATION.md: missing ${id}`);
  if (!evaluation.includes(id)) failures.push(`EVALUATION.md: missing ${id}`);
}
for (const [label, pattern] of [["opaque citation", /citeturn/], ["direct QEG CLI", /lakda export qeg/]]) {
  if (walk(root).some(path => pattern.test(readFileSync(path, "utf8")))) failures.push(`forbidden ${label}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("docs contract: pass");
}
