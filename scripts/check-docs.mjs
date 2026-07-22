import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

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
const schemaPaths = readdirSync(resolve(root, "schemas"))
  .filter(name => name.endsWith(".schema.json"))
  .sort()
  .map(name => "schemas/" + name);
const schemaAjv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const loadedSchemas = [];
try {
  schemaAjv.addSchema(hateSchema);
  for (const schemaPath of schemaPaths) {
    const schema = JSON.parse(readFileSync(resolve(root, schemaPath), "utf8"));
    schemaAjv.addSchema(schema, schemaPath);
    loadedSchemas.push([schemaPath, schema]);
  }
} catch (error) {
  failures.push(`schema registry: load failed: ${error instanceof Error ? error.message : String(error)}`);
}
function collectSchemaRefs(value, refs = []) {
  if (Array.isArray(value)) for (const item of value) collectSchemaRefs(item, refs);
  else if (value && typeof value === "object") {
    if (typeof value.$ref === "string") refs.push(value.$ref);
    for (const item of Object.values(value)) collectSchemaRefs(item, refs);
  }
  return refs;
}
for (const [, schema] of loadedSchemas) {
  if (typeof schema.$id !== "string") continue;
  for (const ref of collectSchemaRefs(schema)) {
    if (!ref.endsWith(".schema.json")) continue;
    const target = loadedSchemas.find(([schemaPath]) => schemaPath.endsWith("/" + ref));
    if (!target || typeof target[1].$id !== "string") continue;
    const aliasId = new URL(ref, schema.$id).href;
    if (!schemaAjv.getSchema(aliasId)) schemaAjv.addSchema({ $id: aliasId, $ref: target[1].$id });
  }
}
for (const [schemaPath, schema] of loadedSchemas) {
  try {
    const key = typeof schema.$id === "string" ? schema.$id : schemaPath;
    if (!schemaAjv.getSchema(key)) throw new Error("schema did not compile");
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


const maintainabilityRequirementsPath = resolve(root, "REQUIREMENTS-MAINTAINABILITY.md");
const maintainabilityDir = resolve(root, "docs/spec/maintainability");
const maintainabilityIndexPath = resolve(maintainabilityDir, "README.md");
const maintainabilityPlanPath = resolve(root, "docs/IMPLEMENTATION-PLAN-MAINTAINABILITY.md");
for (const path of [maintainabilityRequirementsPath, maintainabilityDir, maintainabilityIndexPath, maintainabilityPlanPath]) {
  if (!statSync(path, { throwIfNoEntry: false })) failures.push("missing maintainability artifact " + path.replace(root, ""));
}
if (statSync(maintainabilityRequirementsPath, { throwIfNoEntry: false }) && statSync(maintainabilityDir, { throwIfNoEntry: false })) {
  const requirementText = readFileSync(maintainabilityRequirementsPath, "utf8");
  const indexText = readFileSync(maintainabilityIndexPath, "utf8");
  const entries = readdirSync(maintainabilityDir).filter(name => name.endsWith(".md")).sort();
  const specNames = entries.filter(name => /^SPEC-\d{2}-.+\.md$/.test(name));
  const checklistNames = entries.filter(name => /^CHECKLIST-\d{2}-.+\.md$/.test(name));
  if (specNames.length !== 5) failures.push("maintainability specs: expected 5, got " + specNames.length);
  if (checklistNames.length !== 5) failures.push("maintainability checklists: expected 5, got " + checklistNames.length);
  const specs = new Map(specNames.map(name => [name, readFileSync(resolve(maintainabilityDir, name), "utf8")]));
  const checklists = new Map(checklistNames.map(name => [name, readFileSync(resolve(maintainabilityDir, name), "utf8")]));
  const requirementIds = ids(requirementText, /REQ-MNT-(?:GOV|ACC|EXT|RUN|MOD)-\d{3}/g);
  const acceptanceIds = ids(requirementText, /AC-MNT-\d{3}/g);
  if (requirementIds.length !== 34) failures.push("maintainability requirements: expected 34, got " + requirementIds.length);
  if (acceptanceIds.length !== 10) failures.push("maintainability acceptance: expected 10, got " + acceptanceIds.length);
  for (const id of requirementIds) {
    const specOwners = [...specs].filter(([, text]) => text.includes(id)).map(([name]) => name);
    const checklistOwners = [...checklists].filter(([, text]) => text.includes(id)).map(([name]) => name);
    if (specOwners.length !== 1) failures.push("maintainability " + id + ": expected 1 spec, got " + (specOwners.join(",") || "none"));
    if (checklistOwners.length !== 1) failures.push("maintainability " + id + ": expected 1 checklist, got " + (checklistOwners.join(",") || "none"));
  }
  for (const id of acceptanceIds) {
    if (![...checklists.values()].some(text => text.includes(id))) failures.push("maintainability checklists: missing " + id);
  }
  for (const specName of specNames) {
    const number = specName.match(/^SPEC-(\d{2})-/)[1];
    const specText = specs.get(specName);
    const specMeta = metadata(specText);
    const checklistName = specName.replace(/^SPEC-/, "CHECKLIST-");
    const expectedSpecId = "LAKDA-SPEC-MNT-" + String(Number(number)).padStart(3, "0");
    if (specMeta.document_id !== expectedSpecId) failures.push(specName + ": expected " + expectedSpecId);
    if (specMeta.checklist !== checklistName || !checklists.has(checklistName)) failures.push(specName + ": invalid checklist pair");
    if (!indexText.includes(specName) || !indexText.includes(checklistName)) failures.push("maintainability README: missing pair " + specName);
    if (checklists.has(checklistName)) {
      const checklistText = checklists.get(checklistName);
      const checklistMeta = metadata(checklistText);
      const expectedChecklistId = "LAKDA-CHK-MNT-" + String(Number(number)).padStart(3, "0");
      if (checklistMeta.document_id !== expectedChecklistId) failures.push(checklistName + ": expected " + expectedChecklistId);
      if (checklistMeta.specification !== specName) failures.push(checklistName + ": invalid specification metadata");
      if (!/\|\s*\u8a3c\u8de1\s*\|/.test(checklistText)) failures.push(checklistName + ": missing evidence column");
      if (!specText.includes("](" + checklistName + ")") || !checklistText.includes("](" + specName + ")")) failures.push(specName + ": missing reciprocal link");
    }
  }
}
const maintainabilityTaskIds = Array.from({ length: 16 }, (_, index) => "TASK.20260722-" + (index + 43));
const maintainabilityEvidenceRevisions = new Set();
const maintainabilityAcceptancePath = resolve(root, "docs/acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md");
if (statSync(maintainabilityPlanPath, { throwIfNoEntry: false })) {
  const plan = readFileSync(maintainabilityPlanPath, "utf8");
  const planMeta = metadata(plan);
  if (planMeta.status !== "local_complete") failures.push("maintainability plan: status must be local_complete");
  if (!plan.includes("[AC-20260722-20](acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)")) {
    failures.push("maintainability plan: missing local release Acceptance link");
  }
  if (!statSync(maintainabilityAcceptancePath, { throwIfNoEntry: false })) failures.push("maintainability Acceptance: missing local release record");
  for (const heading of ["## Plan", "## 監査Backlog", "## Patch", "## Tests", "## Commands", "## Notes"]) {
    if (!plan.includes(heading)) failures.push("maintainability plan: missing " + heading);
  }
  for (const marker of ["P0", "P1", "P2", "release profile mutation negative", "Legacy P6", "pending_external"]) {
    if (!plan.includes(marker)) failures.push("maintainability audit backlog: missing " + marker);
  }
  for (const taskId of maintainabilityTaskIds) {
    const taskPath = resolve(root, "docs/tasks/" + taskId + ".md");
    const expectedLink = "[" + taskId + "](tasks/" + taskId + ".md)";
    if (!plan.includes(expectedLink) || !statSync(taskPath, { throwIfNoEntry: false })) {
      failures.push("maintainability plan/task: missing individual link " + taskId);
      continue;
    }

    const taskText = readFileSync(taskPath, "utf8");
    const taskMeta = metadata(taskText);

    if (taskMeta.task_id !== taskId) failures.push(taskId + ": incorrect task_id");
    if (taskMeta.intent_id !== "INT-LAKDA-MNT-001") failures.push(taskId + ": incorrect intent_id");
    if (taskMeta.status !== "done") failures.push(taskId + ": status must be done");
    for (const heading of ["## Objective", "## Scope", "## Requirements", "## Plan", "## Patch", "## Tests", "## Commands", "## Notes", "## Evidence"]) {
      if (!taskText.includes(heading)) failures.push(taskId + ": missing " + heading);
    }
    for (const marker of ["対象test:", "対象revision:", "対象command:", "終了code:", "Acceptance:"]) {
      if (!taskText.includes(marker)) failures.push(taskId + ": Evidence missing " + marker);
    }
    const revisionMatch = taskText.match(/^- 対象revision: `([0-9a-f]{40})`。$/m);
    if (!revisionMatch) failures.push(taskId + ": invalid Evidence revision");
    else maintainabilityEvidenceRevisions.add(revisionMatch[1]);
    if (!/^- 対象command: .+。$/m.test(taskText)) failures.push(taskId + ": invalid Evidence command");
    const exitCodeMatch = taskText.match(/^- 終了code: (.+)$/m);
    if (!exitCodeMatch) failures.push(taskId + ": invalid Evidence exit code");
    else if (taskId !== "TASK.20260722-58" && !exitCodeMatch[1].endsWith("`0`。")) {
      failures.push(taskId + ": local Evidence exit code must be 0");
    }
    if (taskId === "TASK.20260722-58") {
      for (const marker of ["npm run check:docs", "npm run typecheck", "npm run lint", "npm run build", "npm test", "npm run acceptance:fixture", "npm run acceptance:adaptive", "npm run check:hate", "npm run pack:check", "npm run release:validate-profile", "npm run test:contracts", "npm run test:examples", "npm run acceptance:adaptive:real", "npm run acceptance:extension:real", "manual-bb strict Gate", "tools.codemap.update", "git diff --check", "`2`", "未取得"]) {
        if (!taskText.includes(marker)) failures.push(taskId + ": integrated Evidence missing " + marker);
      }
    }
    if (!taskText.includes("[AC-20260722-20](../acceptance/AC-20260722-20.lakda-040-rc2-local-release-validation.md)")) {
      failures.push(taskId + ": missing local release Acceptance link");
    }
    if (/統合Gate[^\r\n]*(?:待ち|未完|保留)/.test(taskText)) failures.push(taskId + ": stale pending Gate marker");
  }
  if (maintainabilityEvidenceRevisions.size !== 1) failures.push("maintainability tasks: Evidence must use one revision");
  else if (statSync(maintainabilityAcceptancePath, { throwIfNoEntry: false })) {
    const acceptanceText = readFileSync(maintainabilityAcceptancePath, "utf8");
    const [evidenceRevision] = maintainabilityEvidenceRevisions;
    if (!acceptanceText.includes(evidenceRevision)) failures.push("maintainability Acceptance: task Evidence revision mismatch");
  }
}
const extensionAliasPairs = new Map([
  ["CHECKLIST-01-COMBINATION.md", "CHECKLIST-01-COMBINATION-TESTING.md"],
  ["CHECKLIST-02-SCOUTING.md", "CHECKLIST-02-SIGNAL-LLM-SCOUTING.md"],
  ["CHECKLIST-03-INVESTIGATION-EVIDENCE.md", "CHECKLIST-03-INVESTIGATE-EVIDENCE.md"],
]);
const extensionDir = resolve(root, "docs/spec/lakda-extension");
for (const [aliasName, canonicalName] of extensionAliasPairs) {
  const aliasPath = resolve(extensionDir, aliasName);
  const canonicalPath = resolve(extensionDir, canonicalName);
  if (!statSync(aliasPath, { throwIfNoEntry: false }) || !statSync(canonicalPath, { throwIfNoEntry: false })) {
    failures.push("extension alias pair missing: " + aliasName + " / " + canonicalName);
    continue;
  }
  const aliasText = readFileSync(aliasPath, "utf8");
  const aliasMeta = metadata(aliasText);
  if (aliasMeta.status !== "non-normative-alias") failures.push(aliasName + ": invalid alias status");
  if (aliasMeta.alias_of !== canonicalName) failures.push(aliasName + ": invalid alias_of");
  if (/\[(?: |x|X)\]/.test(aliasText)) failures.push(aliasName + ": alias has checkbox");
  if (!aliasText.includes("](" + canonicalName + ")")) failures.push(aliasName + ": missing canonical backlink");
}
const profilePath = resolve(root, "release-profiles/current.json");
const profileSchemaPath = resolve(root, "schemas/release-profile-v1.schema.json");
if (!statSync(profilePath, { throwIfNoEntry: false }) || !statSync(profileSchemaPath, { throwIfNoEntry: false })) {
  failures.push("current release profile/schema missing");
} else {
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const profileSchema = JSON.parse(readFileSync(profileSchemaPath, "utf8"));
  const validateProfile = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(profileSchema);
  if (!validateProfile(profile)) failures.push("current release profile: schema mismatch");
  if (profile.releaseVersion !== packageJson.version) failures.push("current release profile: package version mismatch");
  for (const ref of [profile.designInputs?.featureSpec, profile.designInputs?.riskRegister, profile.designInputs?.manualCaseSet, profile.randAudit?.preset, profile.randAudit?.evidence]) {
    if (typeof ref !== "string" || !ref || /^[A-Za-z]:[\\/]|^[/\\]/.test(ref) || /(^|[\\/])\.\.([\\/]|$)/.test(ref) || !statSync(resolve(root, ref), { throwIfNoEntry: false })) failures.push("current release profile: invalid ref " + String(ref));
  }
}
const liveWorkflow = readFileSync(resolve(root, ".github/workflows/release-evidence.yml"), "utf8");
if (/rc5|v0\.3\.0-rc\.5/i.test(liveWorkflow)) failures.push("release-evidence workflow: legacy rc5 literal");
for (const marker of ["release-profiles/current.json", "reference_target_manifest_path", "validate-release-profile.mjs", "requiredChecks"]) {
  if (!liveWorkflow.includes(marker)) failures.push("release-evidence workflow: missing " + marker);
}
const p6WorkflowPath = resolve(root, ".github/workflows/release-p6-rc.yml");
if (statSync(p6WorkflowPath, { throwIfNoEntry: false }) && !/^name:\s*Legacy\b/m.test(readFileSync(p6WorkflowPath, "utf8"))) failures.push("release-p6-rc workflow: name must begin with Legacy");
for (const [indexPath, required] of new Map([
  ["docs/README.md", ["spec/README.md", "tasks/README.md", "acceptance/README.md", "release-gate/README.md"]],
  ["docs/spec/README.md", ["maintainability/README.md", "lakda-extension/README.md", "adaptive-exploration/README.md"]],
  ["docs/tasks/README.md", maintainabilityTaskIds.map(taskId => taskId + ".md")],
])) {
  const text = readFileSync(resolve(root, indexPath), "utf8");
  for (const entry of required) if (!text.includes(entry)) failures.push(indexPath + ": missing " + entry);
}
if (statSync(birdseyeIndexPath, { throwIfNoEntry: false })) {
  const birdseye = JSON.parse(readFileSync(birdseyeIndexPath, "utf8"));
  for (const [id, role] of new Map([
    ["REQUIREMENTS-MAINTAINABILITY.md", "requirements"],
    ["docs/IMPLEMENTATION-PLAN-MAINTAINABILITY.md", "plan"],
    ...maintainabilityTaskIds.map(taskId => ["docs/tasks/" + taskId + ".md", "task"]),
  ])) {
    if (!birdseye.nodes?.[id]) failures.push("Birdseye index: missing " + id);
    else if (birdseye.nodes[id].role !== role) failures.push("Birdseye index: " + id + " must have role " + role);
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
