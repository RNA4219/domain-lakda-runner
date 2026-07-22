import {
  assertCombinationFactorModel,
  assertCombinationSuite,
  generateCombinationSuite,
  verifyCombinationSuite,
} from "../adaptive/combinations.js";
import { readJson, writeCanonicalJson } from "../core/artifact-store.js";
import { integerFlag, stringFlag, type Flags } from "../cli/parser.js";

export async function generateCombinationCommand(flags: Flags): Promise<number> {
  const modelPath = stringFlag(flags, "factor-model", true)!;
  const out = stringFlag(flags, "out", true)!;
  const model = await readJson(modelPath);
  assertCombinationFactorModel(model);
  const suite = generateCombinationSuite(model, {
    seed: integerFlag(flags, "seed"),
    strength: integerFlag(flags, "strength"),
    caseBudget: integerFlag(flags, "case-budget"),
    factorGroup: stringFlag(flags, "factor-group"),
  });
  await writeCanonicalJson(out, suite);
  console.log(JSON.stringify({
    command: "combo gen",
    out,
    suiteId: suite.suiteId,
    caseCount: suite.cases.length,
    strength: suite.strength,
  }, null, 2));
  return 0;
}

export async function verifyCombinationCommand(flags: Flags): Promise<number> {
  const modelPath = stringFlag(flags, "factor-model", true)!;
  const suitePath = stringFlag(flags, "suite", true)!;
  const out = stringFlag(flags, "out", true)!;
  const model = await readJson(modelPath);
  const suite = await readJson(suitePath);
  assertCombinationFactorModel(model);
  assertCombinationSuite(suite);
  const report = verifyCombinationSuite(model, suite);
  await writeCanonicalJson(out, report);
  console.log(JSON.stringify(report, null, 2));
  return report.valid ? 0 : 1;
}
