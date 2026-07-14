import { readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function flag(name) {
  return process.argv.slice(2).find(value => value.startsWith("--" + name + "="))?.slice(name.length + 3);
}

const input = flag("input");
const output = flag("out");
const repoRoot = resolve(flag("root") ?? ".");
if (!input || !output) throw new Error("usage: node scripts/v8-coverage-to-lcov.mjs --input=<v8-dir> --out=<lcov.info> [--root=<repo>]");

function sourcePath(url) {
  if (!url.startsWith("file:")) return undefined;
  const absolute = fileURLToPath(url);
  const rel = relative(repoRoot, absolute).replaceAll("\\", "/");
  if (isAbsolute(rel) || rel.startsWith("../") || rel.includes("/node_modules/") || rel.startsWith("node_modules/") || rel.startsWith(".lakda/") || rel.startsWith("test-results/")) return undefined;
  if (!/\.(?:c?js|mjs)$/.test(rel)) return undefined;
  return { absolute, relative: rel };
}

function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) starts.push(index + 1);
  return starts;
}

function lineForOffset(starts, offset) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return low;
}

const merged = new Map();
for (const entry of await readdir(resolve(input), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
  const payload = JSON.parse(await readFile(resolve(input, entry.name), "utf8"));
  for (const script of payload.result ?? []) {
    const path = sourcePath(script.url ?? "");
    if (!path) continue;
    let current = merged.get(path.relative);
    if (!current) {
      const text = await readFile(path.absolute, "utf8");
      current = { text, starts: lineStarts(text), counts: new Map() };
      merged.set(path.relative, current);
    }
    for (const fn of script.functions ?? []) {
      for (const range of fn.ranges ?? []) {
        const first = lineForOffset(current.starts, range.startOffset);
        const last = lineForOffset(current.starts, Math.max(range.startOffset, range.endOffset - 1));
        for (let line = first; line <= last; line += 1) {
          const currentCount = current.counts.get(line + 1);
          current.counts.set(line + 1, currentCount === undefined ? range.count : Math.min(currentCount, range.count));
        }
      }
    }
  }
}

if (merged.size === 0) throw new Error("workspace内のV8 coverageがありません");
const records = [];
for (const [path, value] of [...merged.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  records.push("TN:lakda-rc", "SF:" + path);
  const lines = value.text.split(/\r?\n/);
  let found = 0;
  let hit = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().length === 0) continue;
    const count = value.counts.get(index + 1) ?? 0;
    records.push(`DA:${index + 1},${count}`);
    found += 1;
    if (count > 0) hit += 1;
  }
  records.push("LF:" + found, "LH:" + hit, "end_of_record");
}
await writeFile(resolve(output), records.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ schemaVersion: "lakda/v8-lcov-conversion/v1", sources: merged.size, output: resolve(output) }));