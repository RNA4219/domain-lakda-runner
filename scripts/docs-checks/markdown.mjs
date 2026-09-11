import { basename, dirname, resolve } from "node:path";

export function checkMarkdown(root, io, markdownPaths) {
  void root;
  const { readFileSync, statSync } = io;
  const failures = [];
  for (const path of markdownPaths) {
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
  for (const [label, pattern] of [["opaque citation", /citeturn/], ["direct QEG CLI", /lakda export qeg/], ["obsolete v2 schema", /lakda\/real-llm-acceptance-report\/v2/]]) {
    if (markdownPaths.some(path => pattern.test(readFileSync(path, "utf8")))) failures.push(`forbidden ${label}`);
  }
  return failures;
}
