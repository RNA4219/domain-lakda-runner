import { readFileSync, readdirSync, statSync } from "node:fs";
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
