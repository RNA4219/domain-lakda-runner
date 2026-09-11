import { basename, resolve } from "node:path";
import { metadata, ids } from "./context.mjs";

export function checkExtension(root, io) {
  const { readFileSync, statSync } = io;
  const failures = [];
  const autonomousDir = resolve(root, "docs/spec/autonomous-exploratory-testing");
  const autonomousIndexPath = resolve(autonomousDir, "README.md");
  const autonomousSpecName = "SPEC-01-AUTONOMOUS-CROSS-PLATFORM-EXPLORATION.md";
  const autonomousChecklistName = "CHECKLIST-01-AUTONOMOUS-CROSS-PLATFORM-EXPLORATION.md";
  const autonomousSpecPath = resolve(autonomousDir, autonomousSpecName);
  const autonomousChecklistPath = resolve(autonomousDir, autonomousChecklistName);
  for (const path of [autonomousIndexPath, autonomousSpecPath, autonomousChecklistPath]) {
    if (!statSync(path, { throwIfNoEntry: false })) failures.push(`missing autonomous exploration document ${basename(path)}`);
  }
  if (statSync(autonomousSpecPath, { throwIfNoEntry: false }) && statSync(autonomousChecklistPath, { throwIfNoEntry: false })) {
    const autonomousSpec = readFileSync(autonomousSpecPath, "utf8");
    const autonomousChecklist = readFileSync(autonomousChecklistPath, "utf8");
    const autonomousIndex = readFileSync(autonomousIndexPath, "utf8");
    const specMeta = metadata(autonomousSpec);
    const checklistMeta = metadata(autonomousChecklist);
    if (specMeta.document_id !== "LAKDA-SPEC-AX-001") failures.push("autonomous spec: invalid document_id");
    if (specMeta.checklist !== autonomousChecklistName) failures.push("autonomous spec: invalid checklist metadata");
    if (checklistMeta.document_id !== "LAKDA-CHK-AX-001") failures.push("autonomous checklist: invalid document_id");
    if (checklistMeta.specification !== autonomousSpecName) failures.push("autonomous checklist: invalid specification metadata");
    if (!autonomousSpec.includes(`](${autonomousChecklistName})`)) failures.push("autonomous spec: missing checklist backlink");
    if (!autonomousChecklist.includes(`](${autonomousSpecName})`)) failures.push("autonomous checklist: missing specification backlink");
    if (!autonomousIndex.includes(autonomousSpecName) || !autonomousIndex.includes(autonomousChecklistName)) failures.push("autonomous README: missing spec/checklist pair");
    const requirementIds = ids(autonomousSpec, /REQ-AX-\d{3}/g);
    const acceptanceIds = ids(autonomousSpec, /AC-AX-\d{3}/g);
    if (requirementIds.length !== 21) failures.push(`autonomous requirements: expected 21, got ${requirementIds.length}`);
    if (acceptanceIds.length !== 10) failures.push(`autonomous acceptance: expected 10, got ${acceptanceIds.length}`);
    for (const id of requirementIds) if (!autonomousChecklist.includes(id)) failures.push(`autonomous checklist: missing ${id}`);
    for (const id of acceptanceIds) if (!autonomousChecklist.includes(id)) failures.push(`autonomous checklist: missing ${id}`);
    for (const heading of ["## Plan", "## Patch", "## Tests", "## Commands", "## Notes"]) {
      if (!autonomousSpec.includes(heading)) failures.push(`autonomous spec: missing ${heading}`);
    }
    if (!/\|\s*証跡\s*\|/.test(autonomousChecklist)) failures.push("autonomous checklist: missing evidence column");
    const specificationChecks = autonomousChecklist.split("## A. 仕様完成チェック")[1]?.split("## B. 実装・受入チェック")[0] ?? "";
    if (!specificationChecks || /- \[ \]/.test(specificationChecks)) failures.push("autonomous checklist: review-ready spec has incomplete specification checks");
    const checklistItemIds = new Set();
    for (const [index, line] of autonomousChecklist.split(/\r?\n/).entries()) {
      if (!/\[(?: |x)\]/.test(line)) continue;
      const found = line.match(/CHK-AX-001-[SIA]-\d{3}/g) ?? [];
      if (found.length !== 1) failures.push(`${autonomousChecklistName}:${index + 1}: checkbox must have exactly one checklist item ID`);
      else if (checklistItemIds.has(found[0])) failures.push(`${autonomousChecklistName}:${index + 1}: duplicate checklist item ID ${found[0]}`);
      else checklistItemIds.add(found[0]);
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
  return failures;
}
