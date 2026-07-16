import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", ".git", ".lakda", "coverage", "dist", "playwright-report", "test-results"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : extname(path) === ".md" ? [path] : [];
  });
}

function metadata(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return {};
  return Object.fromEntries(block[1].split(/\r?\n/).flatMap(line => {
    const separator = line.indexOf(":");
    return separator < 0 ? [] : [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]];
  }));
}

function ids(text, pattern) {
  return [...new Set(text.match(pattern) ?? [])];
}

const markdownPaths = walk(root);
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

const requirements = readFileSync(resolve(root, "REQUIREMENTS.md"), "utf8");
const specification = readFileSync(resolve(root, "SPECIFICATION.md"), "utf8");
const evaluation = readFileSync(resolve(root, "EVALUATION.md"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (packageJson.version !== "0.3.0-rc.4") failures.push("package.json: expected version 0.3.0-rc.4, got " + packageJson.version);
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

const require = createRequire(import.meta.url);
const hateSchema = JSON.parse(readFileSync(resolve(root, "vendor/hate/v1/artifact-manifest.schema.json"), "utf8"));
const Ajv = require("ajv/dist/2020").default;
const hateValidate = new Ajv({ allErrors: true, strict: false }).compile(hateSchema);
for (const schemaPath of [
  "schemas/real-llm-acceptance-report-v2.schema.json",
  "schemas/manual-bb-release-record-v1.schema.json",
  "schemas/adaptive-acceptance-corpus-v1.schema.json",
  "schemas/adaptive-acceptance-case-v1.schema.json",
  "schemas/adaptive-acceptance-suite-index-v1.schema.json",
  "schemas/adaptive-acceptance-suite-readiness-v1.schema.json",
]) {
  try {
    const schemaAjv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    schemaAjv.addSchema(hateSchema);
    schemaAjv.compile(JSON.parse(readFileSync(resolve(root, schemaPath), "utf8")));
  } catch (error) {
    failures.push(`${schemaPath}: schema compile failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const path of markdownPaths) {
  const text = readFileSync(path, "utf8");
  for (const json of text.matchAll(/^```json\s*\r?\n([\s\S]*?)^```/gm)) {
    let value;
    try { value = JSON.parse(json[1]); } catch { continue; }
    if (value && value.schema_version === "HATE/v1" && !hateValidate(value)) failures.push(basename(path) + ": HATE/v1 example does not match vendor schema");
  }
}
for (const id of ids(requirements, /REQ-(?:FN|LLM|NF|SEC)-\d+/g)) {
  if (!specification.includes(id)) failures.push(`SPECIFICATION.md: missing ${id}`);
  if (!evaluation.includes(id)) failures.push(`EVALUATION.md: missing ${id}`);
}

const adaptiveDir = resolve(root, "docs/spec/adaptive-exploration");
const adaptiveRequirementsPath = resolve(root, "REQUIREMENTS-ADAPTIVE-EXPLORATION.md");
const adaptiveIndexPath = resolve(adaptiveDir, "README.md");
const adaptiveEvaluationPath = resolve(adaptiveDir, "EVALUATION-ADAPTIVE-EXPLORATION.md");
const birdseyeIndexPath = resolve(root, "docs/birdseye/index.json");
for (const path of [adaptiveRequirementsPath, adaptiveIndexPath, adaptiveEvaluationPath]) {
  if (!statSync(path, { throwIfNoEntry: false })) failures.push(`missing adaptive document ${basename(path)}`);
}

if (statSync(adaptiveDir, { throwIfNoEntry: false }) && statSync(adaptiveRequirementsPath, { throwIfNoEntry: false })) {
  const adaptiveRequirements = readFileSync(adaptiveRequirementsPath, "utf8");
  const adaptiveEvaluation = readFileSync(adaptiveEvaluationPath, "utf8");
  const adaptiveIndex = readFileSync(adaptiveIndexPath, "utf8");
  const entries = readdirSync(adaptiveDir).filter(name => name.endsWith(".md")).sort();
  const specNames = entries.filter(name => /^SPEC-\d{2}-.+\.md$/.test(name));
  const checklistNames = entries.filter(name => /^CHECKLIST-\d{2}-.+\.md$/.test(name));
  if (specNames.length !== 6) failures.push(`adaptive specs: expected 6, got ${specNames.length}`);
  if (checklistNames.length !== 6) failures.push(`adaptive checklists: expected 6, got ${checklistNames.length}`);

  const specDocs = new Map(specNames.map(name => [name, readFileSync(resolve(adaptiveDir, name), "utf8")]));
  const checklistDocs = new Map(checklistNames.map(name => [name, readFileSync(resolve(adaptiveDir, name), "utf8")]));
  const requirementIds = ids(adaptiveRequirements, /REQ-[A-Z]+-\d{3}/g);
  const acceptanceIds = ids(adaptiveRequirements, /AC-AE-\d{3}/g);
  if (requirementIds.length !== 128) failures.push(`adaptive requirements: expected 128, got ${requirementIds.length}`);
  if (acceptanceIds.length !== 16) failures.push(`adaptive acceptance: expected 16, got ${acceptanceIds.length}`);

  for (const id of requirementIds) {
    const owners = [...specDocs].filter(([, text]) => text.includes(id)).map(([name]) => name);
    const checklists = [...checklistDocs].filter(([, text]) => text.includes(id)).map(([name]) => name);
    if (owners.length !== 1) failures.push(`adaptive requirement ${id}: expected 1 primary spec, got ${owners.join(",") || "none"}`);
    if (checklists.length !== 1) failures.push(`adaptive requirement ${id}: expected 1 checklist, got ${checklists.join(",") || "none"}`);
  }

  const knownRequirements = new Set(requirementIds);
  for (const [name, text] of [...specDocs, ...checklistDocs]) {
    for (const id of ids(text, /REQ-[A-Z]+-\d{3}/g)) {
      if (!knownRequirements.has(id)) failures.push(`${name}: unknown adaptive requirement ${id}`);
    }
  }

  for (const id of acceptanceIds) {
    if (!adaptiveEvaluation.includes(id)) failures.push(`adaptive evaluation: missing ${id}`);
    if (![...checklistDocs.values()].some(text => text.includes(id))) failures.push(`adaptive checklists: missing ${id}`);
  }

  const checklistItemIds = new Map();
  for (const [name, text] of checklistDocs) {
    const number = String(Number(name.match(/^CHECKLIST-(\d{2})-/)[1])).padStart(3, "0");
    if (!/\|\s*証跡\s*\|/.test(text)) failures.push(`${name}: missing evidence column`);
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!/\[(?: |x)\]/.test(line)) continue;
      const found = line.match(/CHK-AE-\d{3}-[SIA]-\d{3}/g) ?? [];
      if (found.length !== 1) {
        failures.push(`${name}:${index + 1}: checkbox must have exactly one checklist item ID`);
        continue;
      }
      const id = found[0];
      if (!id.startsWith(`CHK-AE-${number}-`)) failures.push(`${name}:${index + 1}: checklist item ID belongs to another specification: ${id}`);
      if (checklistItemIds.has(id)) failures.push(`${name}:${index + 1}: duplicate checklist item ID ${id}`);
      else checklistItemIds.set(id, `${name}:${index + 1}`);
    }
  }

  const documentIds = new Map();
  for (const name of ["README.md", "EVALUATION-ADAPTIVE-EXPLORATION.md", ...specNames, ...checklistNames]) {
    const text = readFileSync(resolve(adaptiveDir, name), "utf8");
    const meta = metadata(text);
    if (!meta.document_id) failures.push(`${name}: missing document_id`);
    else if (documentIds.has(meta.document_id)) failures.push(`${name}: duplicate document_id ${meta.document_id}`);
    else documentIds.set(meta.document_id, name);
  }

  for (const specName of specNames) {
    const number = specName.match(/^SPEC-(\d{2})-/)[1];
    const expectedId = `LAKDA-SPEC-AE-${String(Number(number)).padStart(3, "0")}`;
    const specText = specDocs.get(specName);
    const specMeta = metadata(specText);
    const checklistName = specName.replace(/^SPEC-/, "CHECKLIST-");
    if (specMeta.document_id !== expectedId) failures.push(`${specName}: expected document_id ${expectedId}`);
    if (specMeta.checklist !== checklistName) failures.push(`${specName}: checklist metadata must be ${checklistName}`);
    if (!checklistDocs.has(checklistName)) failures.push(`${specName}: missing paired checklist ${checklistName}`);
    if (!adaptiveIndex.includes(specName) || !adaptiveIndex.includes(checklistName)) failures.push(`adaptive README: missing pair ${specName} / ${checklistName}`);

    if (checklistDocs.has(checklistName)) {
      const checklistText = checklistDocs.get(checklistName);
      const checklistMeta = metadata(checklistText);
      const expectedChecklistId = `LAKDA-CHK-AE-${String(Number(number)).padStart(3, "0")}`;
      if (checklistMeta.document_id !== expectedChecklistId) failures.push(`${checklistName}: expected document_id ${expectedChecklistId}`);
      if (checklistMeta.specification !== specName) failures.push(`${checklistName}: specification metadata must be ${specName}`);
      if (!checklistText.includes(`](${specName})`)) failures.push(`${checklistName}: missing backlink to ${specName}`);
      if (!specText.includes(`](${checklistName})`)) failures.push(`${specName}: missing link to ${checklistName}`);
      if (specMeta.status === "review-ready") {
        const specSection = checklistText.split("## A. 仕様完成チェック")[1]?.split("## B. 実装・受入チェック")[0] ?? "";
        if (!specSection || /- \[ \]/.test(specSection)) failures.push(`${checklistName}: review-ready spec has incomplete specification checks`);
      }
    }
  }
}


const adaptiveNames = [
  "COMMON-CORE",
  "STATE-GRAPH-EXPLORATION",
  "REPLAY-ORACLE-EVIDENCE",
  "PLAYWRIGHT-ADAPTER",
  "AIRTEST-POCO-ADAPTER",
  "SECURITY-ADAPTER",
];
if (statSync(birdseyeIndexPath, { throwIfNoEntry: false })) {
  const birdseye = JSON.parse(readFileSync(birdseyeIndexPath, "utf8"));
  const requiredNodes = new Map([
    ["REQUIREMENTS-ADAPTIVE-EXPLORATION.md", "requirements"],
    ["docs/IMPLEMENTATION-PLAN-ADAPTIVE-EXPLORATION.md", "plan"],
    ...adaptiveNames.map((name, index) => [
      `docs/spec/adaptive-exploration/SPEC-${String(index + 1).padStart(2, "0")}-${name}.md`,
      "specification",
    ]),
    ...adaptiveNames.map((name, index) => [
      `docs/spec/adaptive-exploration/CHECKLIST-${String(index + 1).padStart(2, "0")}-${name}.md`,
      "checklist",
    ]),
    ...Array.from({ length: 28 }, (_, index) => [
      `docs/tasks/TASK.20260714-${String(index + 8).padStart(2, "0")}.md`,
      "task",
    ]),
  ]);
  for (const [id, role] of requiredNodes) {
    if (!birdseye.nodes?.[id]) failures.push(`Birdseye index: missing ${id}`);
    else if (birdseye.nodes[id].role !== role) failures.push(`Birdseye index: ${id} must have role ${role}`);
    const capsule = birdseye.nodes?.[id]?.caps;
    if (capsule && !statSync(resolve(root, capsule), { throwIfNoEntry: false })) {
      failures.push(`Birdseye capsule: missing ${capsule}`);
    } else if (capsule) {
      const capsuleRecord = JSON.parse(readFileSync(resolve(root, capsule), "utf8"));
      if (capsuleRecord.role !== role) failures.push(`Birdseye capsule: ${capsule} must have role ${role}`);
    }
  }
}

for (const [label, pattern] of [["opaque citation", /citeturn/], ["direct QEG CLI", /lakda export qeg/], ["obsolete v2 schema", /lakda\/real-llm-acceptance-report\/v2/]]) {
  if (markdownPaths.some(path => pattern.test(readFileSync(path, "utf8")))) failures.push(`forbidden ${label}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("docs contract: pass");
}
