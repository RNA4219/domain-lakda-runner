import { resolve } from "node:path";
import { metadata, ids } from "./context.mjs";
export const maintainabilityTaskIds = Array.from({ length: 16 }, (_, index) => "TASK.20260722-" + (index + 43));

export function checkMaintainability(root, io) {
  const { readFileSync, readdirSync, statSync } = io;
  const failures = [];
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
  return failures;
}
