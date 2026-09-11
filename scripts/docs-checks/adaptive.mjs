import { basename, resolve } from "node:path";
import { metadata, ids } from "./context.mjs";

export function checkAdaptive(root, io) {
  const { readFileSync, readdirSync, statSync } = io;
  const failures = [];
  const adaptiveDir = resolve(root, "docs/spec/adaptive-exploration");
  const adaptiveRequirementsPath = resolve(root, "REQUIREMENTS-ADAPTIVE-EXPLORATION.md");
  const adaptiveIndexPath = resolve(adaptiveDir, "README.md");
  const adaptiveEvaluationPath = resolve(adaptiveDir, "EVALUATION-ADAPTIVE-EXPLORATION.md");
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
  return failures;
}
