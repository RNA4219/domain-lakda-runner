import { LAKDA_VERSION } from "../index.js";
import { captureAuthCommand, validateAuthCommand } from "../commands/auth.js";
import {
  generateCombinationCommand,
  verifyCombinationCommand,
} from "../commands/combinations.js";
import { investigateCommand, promoteCommand } from "../commands/investigation.js";
import {
  doctorCommand,
  exportHateCommand,
  replayCommand,
  runCommand,
} from "../commands/runtime.js";
import { reportLeadsCommand, scoutCommand } from "../commands/scouting.js";
import {
  runsCompareCommand,
  runsListCommand,
  runsShowCommand,
} from "../commands/runs.js";
import { usage } from "./help.js";
import {
  parseCliArgs,
  stringFlag,
  type ParsedCliArgs,
} from "./parser.js";

export async function dispatchCli(parsed: ParsedCliArgs): Promise<number> {
  if (parsed.flags.version) {
    console.log(LAKDA_VERSION);
    return 0;
  }
  if (parsed.flags.help || parsed.positionals.length === 0) {
    console.log(usage);
    return 0;
  }

  const command = parsed.positionals.join(" ");
  if (command === "run") return await runCommand(parsed.flags);
  if (command === "replay") return await replayCommand(parsed.flags);
  if (command === "export hate") return await exportHateCommand(parsed.flags);
  if (command === "doctor") return await doctorCommand(parsed.flags);
  if (command === "auth capture") return await captureAuthCommand(parsed.flags);
  if (command === "auth validate") return await validateAuthCommand(parsed.flags);
  if (command === "combo gen") return await generateCombinationCommand(parsed.flags);
  if (command === "combo verify") return await verifyCombinationCommand(parsed.flags);
  if (command === "scout") return await scoutCommand(parsed.flags);
  if (command === "report leads") return await reportLeadsCommand(parsed.flags);
  if (command === "investigate") return await investigateCommand(parsed.flags);
  if (command === "promote") return await promoteCommand(parsed.flags);
  if (command === "runs list") {
    return await runsListCommand({
      outputDir: stringFlag(parsed.flags, "output-dir"),
    });
  }
  if (command === "runs show") {
    return await runsShowCommand({
      runDir: stringFlag(parsed.flags, "run-dir"),
    });
  }
  if (command === "runs compare") {
    return await runsCompareCommand({
      baseRunDir: stringFlag(parsed.flags, "base-run-dir"),
      headRunDir: stringFlag(parsed.flags, "head-run-dir"),
      out: stringFlag(parsed.flags, "out"),
    });
  }
  throw new Error(`未対応command: ${command}`);
}

export async function runCli(argv: string[]): Promise<number> {
  try {
    return await dispatchCli(parseCliArgs(argv));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
