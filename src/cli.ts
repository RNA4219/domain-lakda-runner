#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runCli } from "./cli/dispatcher.js";

export { runCli };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
