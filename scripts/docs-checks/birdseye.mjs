import { resolve } from "node:path";
import { maintainabilityTaskIds } from "./maintainability.mjs";

export function checkBirdseye(root, io) {
  const { readFileSync, statSync } = io;
  const failures = [];
  const birdseyeIndexPath = resolve(root, "docs/birdseye/index.json");
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



  for (const [indexPath, required] of new Map([
    ["docs/README.md", ["spec/README.md", "tasks/README.md", "acceptance/README.md", "release-gate/README.md"]],
    ["docs/spec/README.md", ["maintainability/README.md", "lakda-extension/README.md", "adaptive-exploration/README.md", "autonomous-exploratory-testing/README.md"]],
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
  return failures;
}
