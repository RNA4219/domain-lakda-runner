import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";

export const filesystem = { readFileSync, readdirSync, statSync };

export function walk(directory, io) {
  const { readdirSync } = io;
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".git", ".lakda", "coverage", "dist", "playwright-report", "test-results"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path, io) : extname(path) === ".md" ? [path] : [];
  });
}

export function metadata(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return {};
  return Object.fromEntries(block[1].split(/\r?\n/).flatMap(line => {
    const separator = line.indexOf(":");
    return separator < 0 ? [] : [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]];
  }));
}

export function ids(text, pattern) {
  return [...new Set(text.match(pattern) ?? [])];
}
