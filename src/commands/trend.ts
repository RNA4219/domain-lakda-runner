import { resolve } from "node:path";
import { generateTrend } from "../runs/trend.js";
import { stringFlag, type Flags } from "../cli/parser.js";

export async function runsTrendCommand(flags: Flags): Promise<number> {
  const index = stringFlag(flags, "index", true)!;
  const root = stringFlag(flags, "runs-dir", true)!;
  const out = stringFlag(flags, "out", true)!;
  const result = await generateTrend(resolve(index), resolve(root), resolve(out));
  console.log(JSON.stringify({ out: resolve(out), groups: result.series.length, gate: result.gate }));
  return 0;
}
