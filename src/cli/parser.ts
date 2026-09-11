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
    tokens: true,
    strict: true,
    options: {
      "base-url": { type: "string" }, mode: { type: "string" }, seed: { type: "string" }, headed: { type: "boolean" },
      "output-dir": { type: "string" }, persona: { type: "string" }, config: { type: "string" }, input: { type: "string" },
      "run-dir": { type: "string" }, out: { type: "string" }, browser: { type: "string" }, help: { type: "boolean" }, version: { type: "boolean" },
      "factor-model": { type: "string" }, suite: { type: "string" }, strength: { type: "string" }, "case-budget": { type: "string" }, "factor-group": { type: "string" },
      lead: { type: "string" }, trace: { type: "string" }, reviewer: { type: "string" }, investigation: { type: "string" }, kind: { type: "string" }, format: { type: "string" }, "out-dir": { type: "string" }, "scout-mode": { type: "string" },
      "base-run-dir": { type: "string" }, "head-run-dir": { type: "string" },
      charter: { type: "string" }, session: { type: "string" }, reason: { type: "string" },
      index: { type: "string" }, "trust-store": { type: "string" },
      sources: { type: "string" }, profile: { type: "string" }, "text-only": { type: "boolean" },
      "report-config": { type: "string" }, "report-dir": { type: "string" },
      report: { type: "string" }, "report-profile": { type: "string" }, "report-language": { type: "string" },
    },
  });
  const automaticOptions = new Set(["report", "report-dir", "report-profile", "report-config", "report-language"]);
  if (["run", "replay", "explore run", "explore resume"].includes(parsed.positionals.join(" "))) {
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== "option" || !automaticOptions.has(token.name)) continue;
      if (seen.has(token.name)) throw Object.assign(new Error("report optionを重複指定できません"), { exitCode: 2 });
      seen.add(token.name);
    }
  }
  if (parsed.positionals[0] === "report" && ["generate", "verify"].includes(parsed.positionals[1])) {
    const command = parsed.positionals[1];
    const allowed = new Set(command === "generate" ? ["run-dir", "session", "sources", "out", "profile", "text-only", "report-config", "report-language", "help", "version"] : ["report-dir", "help", "version"]);
    const seen = new Set<string>();
    const invalid = () => Object.assign(new Error("report commandの引数が不正です"), { exitCode: 2, reportCommand: command });
    if (parsed.positionals.length !== 2) throw invalid();
    for (const token of parsed.tokens) {
      if (token.kind !== "option") continue;
      if (!allowed.has(token.name) || seen.has(token.name)) throw invalid();
      seen.add(token.name);
    }
  }
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
