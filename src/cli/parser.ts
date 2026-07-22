import { parseArgs as parseNodeArgs } from "node:util";
import { parseMode } from "../core/config.js";

export type Flags = Record<string, string | boolean | undefined>;

export type ParsedCliArgs = {
  positionals: string[];
  flags: Flags;
};

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const parsed = parseNodeArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "base-url": { type: "string" }, mode: { type: "string" }, seed: { type: "string" }, headed: { type: "boolean" },
      "output-dir": { type: "string" }, persona: { type: "string" }, config: { type: "string" }, input: { type: "string" },
      "run-dir": { type: "string" }, out: { type: "string" }, browser: { type: "string" }, help: { type: "boolean" }, version: { type: "boolean" },
      "factor-model": { type: "string" }, suite: { type: "string" }, strength: { type: "string" }, "case-budget": { type: "string" }, "factor-group": { type: "string" },
      lead: { type: "string" }, trace: { type: "string" }, reviewer: { type: "string" }, investigation: { type: "string" }, kind: { type: "string" }, format: { type: "string" }, "out-dir": { type: "string" }, "scout-mode": { type: "string" },
      "base-run-dir": { type: "string" }, "head-run-dir": { type: "string" },
    },
  });
  return { positionals: parsed.positionals, flags: parsed.values };
}

export function stringFlag(flags: Flags, key: string, required = false): string | undefined {
  const value = flags[key];
  if (required && typeof value !== "string") throw new Error(`--${key} は必須です`);
  return typeof value === "string" ? value : undefined;
}

export function integerFlag(flags: Flags, key: string, fallback?: number): number | undefined {
  const value = stringFlag(flags, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("--" + key + " は整数で指定してください");
  return parsed;
}

export function configOverrides(flags: Flags) {
  const baseUrl = stringFlag(flags, "base-url");
  const mode = stringFlag(flags, "mode");
  const seed = stringFlag(flags, "seed");
  const values = {
    baseUrl,
    mode: mode ? parseMode(mode) : undefined,
    seed: seed ? Number(seed) : undefined,
    outputDir: stringFlag(flags, "output-dir"),
    persona: stringFlag(flags, "persona"),
    ...(flags.headed === true ? { headed: true } : {}),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
