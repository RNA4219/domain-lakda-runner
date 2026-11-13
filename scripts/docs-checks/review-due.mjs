import { relative } from "node:path";
import { metadata } from "./context.mjs";

const closedStatuses = new Set(["done", "completed", "fixture_accepted", "local_complete"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function reviewDueFindings(root, io, markdownPaths, today = new Date().toISOString().slice(0, 10)) {
  const { readFileSync } = io;
  const failures = [];
  const warnings = [];
  for (const path of markdownPaths) {
    const meta = metadata(readFileSync(path, "utf8"));
    const due = meta.next_review_due;
    if (due === undefined || closedStatuses.has(meta.status)) continue;
    const ref = relative(root, path).replaceAll("\\", "/");
    if (!datePattern.test(due)) failures.push(ref + ": invalid next_review_due " + due);
    else if (due < today) {
      (meta.status === "active" ? failures : warnings).push(ref + ": review overdue since " + due + " (status " + (meta.status ?? "missing") + ")");
    }
  }
  return { failures, warnings };
}

export function checkReviewDue(root, io, markdownPaths, today) {
  return reviewDueFindings(root, io, markdownPaths, today).failures;
}
