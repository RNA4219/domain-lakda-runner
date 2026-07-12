#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { LAKDA_VERSION } from "./index.js";

const usage = `lakda ${LAKDA_VERSION}\n\nCommands:\n  lakda run\n  lakda replay\n  lakda export hate\n  lakda doctor\n  lakda auth capture\n  lakda auth validate`;

export function runCli(argv: string[]): number {
  const parsed = parseArgs({
    args: argv,
    options: { help: { type: "boolean" }, version: { type: "boolean" } },
    allowPositionals: true,
    strict: true
  });
  if (parsed.values.version) {
    process.stdout.write(`${LAKDA_VERSION}\n`);
    return 0;
  }
  if (parsed.values.help || parsed.positionals.length === 0) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  process.stderr.write(`lakda: command not implemented: ${parsed.positionals.join(" ")}\n`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2));
}
