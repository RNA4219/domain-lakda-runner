import { dirname, resolve } from "node:path";
import { metadata } from "./context.mjs";

export function checkUp(root, io) {
  const { readFileSync, readdirSync, statSync } = io;
  const failures = [];
  const read = ref => {
    try { return readFileSync(resolve(root, ref), "utf8"); }
    catch { failures.push("UP: missing document " + ref); return ""; }
  };
  const requirementDocs = ["docs/proposals/20260910-detailed-requirements.md", "docs/proposals/20260910-report-detail.md"];
  const definitions = new Map();
  for (const ref of requirementDocs) {
    for (const [, id, strength] of read(ref).matchAll(/^\|\s*(REQ-UP-[A-Z]+-\d{3})\s*\|\s*(Must|Should)\s*\|/gm)) {
      if (definitions.has(id)) failures.push("UP: duplicate requirement " + id);
      definitions.set(id, strength);
    }
  }
  if (definitions.size === 0) failures.push("UP: no requirement definitions");
  const mapped = new Set();
  const acceptanceIds = new Set();
  const acceptance = read("docs/proposals/20260910-detailed-checklist.md");
  for (const [, id, row] of acceptance.matchAll(/^\|\s*(AC-UP-\d{3})\s*\|([^\r\n]*)/gm)) {
    if (acceptanceIds.has(id)) failures.push("UP: duplicate acceptance " + id);
    acceptanceIds.add(id);
    const refs = row.match(/REQ-UP-[A-Z]+-\d{3}/g) ?? [];
    if (!refs.length) failures.push("UP: acceptance has no requirements " + id);
    for (const ref of refs) {
      if (!definitions.has(ref)) failures.push("UP: unknown requirement " + ref);
      mapped.add(ref);
    }
  }
  for (const [id, strength] of definitions) {
    if (strength === "Must" && !mapped.has(id)) failures.push("UP: Must requirement has no acceptance " + id);
  }
  const specDir = "docs/spec/verification-reports";
  const index = read(specDir + "/README.md");
  let names = [];
  try { names = readdirSync(resolve(root, specDir)).sort(); } catch { failures.push("UP: missing specification directory"); }
  const specs = names.filter(name => /^SPEC-\d{2}-.+\.md$/.test(name));
  const checklists = names.filter(name => /^CHECKLIST-\d{2}-.+\.md$/.test(name));
  if (!specs.length || specs.length !== checklists.length) failures.push("UP: specification/checklist count mismatch");
  const docIds = new Set();
  for (const name of [...specs, ...checklists]) {
    const id = metadata(read(specDir + "/" + name)).document_id;
    if (!id || docIds.has(id)) failures.push("UP: missing or duplicate document_id " + name);
    docIds.add(id);
  }
  for (const name of specs) {
    const spec = read(specDir + "/" + name);
    const paired = name.replace(/^SPEC-/, "CHECKLIST-");
    const checklist = read(specDir + "/" + paired);
    if (metadata(spec).checklist !== paired || !checklists.includes(paired)) failures.push("UP: invalid checklist pair " + name);
    if (metadata(checklist).specification !== name || !checklist.includes("](" + name + ")")) failures.push("UP: invalid specification backlink " + paired);
    if (!spec.includes("](" + paired + ")")) failures.push("UP: missing checklist link " + name);
    if (!index.includes("](" + name + ")") || !index.includes("](" + paired + ")")) failures.push("UP: index missing specification pair " + name);
  }
  const validSpecs = new Set(["README.md", ...specs].map(name => resolve(root, specDir, name)));
  let tasks = [];
  try { tasks = readdirSync(resolve(root, "docs/tasks")).filter(name => /^TASK\..+\.md$/.test(name)).sort(); }
  catch { failures.push("UP: missing task directory"); }
  let taskCount = 0;
  for (const name of tasks) {
    const ref = "docs/tasks/" + name;
    const task = read(ref);
    const meta = metadata(task);
    if (meta.intent_id !== "INT-LAKDA-UP-001") continue;
    taskCount += 1;
    const specPath = meta.specification && resolve(dirname(resolve(root, ref)), meta.specification);
    if (!specPath || !validSpecs.has(specPath) || !statSync(specPath, { throwIfNoEntry: false }) || !task.includes("](" + meta.specification + ")")) {
      failures.push("UP: task has no valid specification " + name);
    }
  }
  if (!taskCount) failures.push("UP: no implementation tasks");
  return failures;
}
