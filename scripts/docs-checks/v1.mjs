import { resolve } from "node:path";
import { metadata, ids } from "./context.mjs";

export function checkV1(root, io) {
  const { readFileSync, statSync } = io;
  const failures = [];
  const requirements = readFileSync(resolve(root, "REQUIREMENTS.md"), "utf8");
  const specification = readFileSync(resolve(root, "SPECIFICATION.md"), "utf8");
  const evaluation = readFileSync(resolve(root, "EVALUATION.md"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+-rc\.\d+$/.test(packageJson.version)) failures.push("package.json: version must be rc semver, got " + packageJson.version);
  for (const id of ids(requirements, /AC-\d{8}-\d{2}|AC-\d{3}/g)) {
    if (!specification.includes(id)) failures.push("SPECIFICATION.md: missing " + id);
    if (!evaluation.includes(id)) failures.push("EVALUATION.md: missing " + id);
  }

  for (const requiredPath of [
    "docs/tasks/TASK.20260713-06.md",
    "docs/tasks/TASK.20260714-07.md",
    "docs/tasks/TASK.20260714-08.md",
    "docs/tasks/TASK.20260714-34.md",
    "docs/tasks/TASK.20260714-35.md",
    "docs/tasks/TASK.20260802-60.md",
    "docs/acceptance/P7-REAL-ACCEPTANCE-RUNBOOK.md",
    "docs/acceptance/AC-20260715-07.p7-runner-pending-external.md",
    "docs/acceptance/AC-20260715-08.p3-p4-replay-hardening.md",
    "docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md",
    "docs/acceptance/AC-20260713-05.v021-hardening-fixture.json",
    "docs/acceptance/AC-20260713-06.v021-hardening-real-llm.json",
    "docs/acceptance/AC-20260714-02.v021-evidence-contract-correction.md",
    "schemas/real-llm-acceptance-report-v2.schema.json",
    "schemas/manual-bb-release-record-v1.schema.json",
    ".github/workflows/release-evidence.yml",
    "codemap.config.json",
    "docs/birdseye/index.json",
    "docs/birdseye/hot.json",
  ]) {
    if (!statSync(resolve(root, requiredPath), { throwIfNoEntry: false })) failures.push("missing required evidence " + requiredPath);
  }


  const adaptivePlanPath = resolve(root, "docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md");
  const adaptiveTaskSeedPath = resolve(root, "docs/tasks/TASK.20260714-08.md");
  if (statSync(adaptivePlanPath, { throwIfNoEntry: false })) {
    const adaptivePlan = readFileSync(adaptivePlanPath, "utf8");
    for (const heading of ["## Plan", "## Patch", "## Tests", "## Commands", "## Notes"]) {
      if (!adaptivePlan.includes(heading)) failures.push("adaptive implementation plan: missing " + heading);
    }
    for (let number = 8; number <= 35; number += 1) {
      const taskId = "TASK.20260714-" + String(number).padStart(2, "0");
      if (!adaptivePlan.includes(taskId)) failures.push("adaptive implementation plan: missing " + taskId);
    }
    for (let number = 1; number <= 16; number += 1) {
      const acceptanceId = "AC-AE-" + String(number).padStart(3, "0");
      if (!adaptivePlan.includes(acceptanceId)) failures.push("adaptive implementation plan: missing " + acceptanceId);
    }
  }
  if (statSync(adaptiveTaskSeedPath, { throwIfNoEntry: false })) {
    const adaptiveTaskSeed = readFileSync(adaptiveTaskSeedPath, "utf8");
    const taskMeta = metadata(adaptiveTaskSeed);
    if (taskMeta.task_id !== "TASK.20260714-08") failures.push("adaptive Task Seed: incorrect task_id");
    if (taskMeta.status !== "fixture_accepted") failures.push("adaptive Task Seed: status must be fixture_accepted");
    for (const heading of ["## Objective", "## Scope", "## Requirements", "## Plan", "## Patch", "## Tests", "## Commands", "## Notes"]) {
      if (!adaptiveTaskSeed.includes(heading)) failures.push("adaptive Task Seed: missing " + heading);
    }
    for (const reference of ["SPEC-01-COMMON-CORE.md", "CHECKLIST-01-COMMON-CORE.md", "AC-AE-014"]) {
      if (!adaptiveTaskSeed.includes(reference)) failures.push("adaptive Task Seed: missing " + reference);
    }
  }

  const p7RunbookPath = resolve(root, "docs/acceptance/P7-REAL-ACCEPTANCE-RUNBOOK.md");
  if (statSync(p7RunbookPath, { throwIfNoEntry: false })) {
    const p7Runbook = readFileSync(p7RunbookPath, "utf8");
    for (const requiredText of [
      "pending_external",
      "lakda/adaptive-acceptance-corpus/v1",
      "targetRevision",
      "LAKDA_ADAPTIVE_REAL_CONFIRM",
      "LAKDA_ADAPTIVE_TARGET_REVISION",
      "HATE/v1",
      "manual-bb",
      "QEG",
    ]) {
      if (!p7Runbook.includes(requiredText)) failures.push("P7 runbook: missing " + requiredText);
    }
  }
  for (const number of [34, 35]) {
    const taskPath = resolve(root, "docs/tasks/TASK.20260714-" + number + ".md");
    if (!statSync(taskPath, { throwIfNoEntry: false })) continue;
    const taskText = readFileSync(taskPath, "utf8");
    const taskMeta = metadata(taskText);
    if (taskMeta.task_id !== "TASK.20260714-" + number) failures.push("P7 Task " + number + ": incorrect task_id");
    if (taskMeta.status !== "pending_external") failures.push("P7 Task " + number + ": status must be pending_external");
    if (!taskText.includes("P7-REAL-ACCEPTANCE-RUNBOOK.md")) failures.push("P7 Task " + number + ": missing runbook link");
    if (!taskText.includes("AC-20260715-07.p7-runner-pending-external.md")) failures.push("P7 Task " + number + ": missing local acceptance record");
  }
  if (packageJson.scripts?.["acceptance:adaptive:real"] !== "npm run build && node scripts/run-adaptive-real-acceptance.mjs") {
    failures.push("package.json: missing canonical acceptance:adaptive:real script");
  }
  if (packageJson.scripts?.["acceptance:adaptive:verify-real"] !== "node scripts/verify-adaptive-real-acceptance.mjs") {
    failures.push("package.json: missing canonical acceptance:adaptive:verify-real script");
  }


  for (const id of ids(requirements, /REQ-(?:FN|LLM|NF|SEC)-\d+/g)) {
    if (!specification.includes(id)) failures.push(`SPECIFICATION.md: missing ${id}`);
    if (!evaluation.includes(id)) failures.push(`EVALUATION.md: missing ${id}`);
  }
  return failures;
}
