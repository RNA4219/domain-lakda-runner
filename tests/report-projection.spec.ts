import { expect, test } from "@playwright/test";
import { cleanReportText, maximumClassification, serializeReportData } from "../src/reporting/projection-values.js";
import { validateAdaptiveEvidenceTrace, validateAdaptiveReplayTrace } from "../src/adaptive/replay.js";

test("report text removes known secret/PII/path data without treating strings as markup", () => {
  const text = cleanReportText('password=private-value user@example.invalid C:\\Users\\fixture\\secret.txt <script>alert("fixture")</script>');
  expect(text).not.toContain("private-value");
  expect(text).not.toContain("user@example.invalid");
  expect(text).not.toContain("C:\\Users");
  expect(text).toContain("<script>");
  expect(cleanReportText("/tmp/private/file.json")).toBe("[PATH]");
  expect(cleanReportText("file:///C:/private/file.json")).toBe("[PATH]");
});

test("embedded JSON cannot close its inert script element and preserves its projection", () => {
  const value = { message: '</script><img src=x onerror="alert(1)"> & \u2028 \u2029', unknown: "未取得" };
  const encoded = serializeReportData(value);
  expect(encoded).not.toContain("<");
  expect(encoded).not.toContain("&");
  expect(JSON.parse(encoded)).toEqual(value);
  expect(maximumClassification(["public", "confidential", "internal"])).toBe("confidential");
  expect(maximumClassification(["restricted", "internal"])).toBe("restricted");
});

test("an empty stopped adaptive trace is readable evidence while replay still requires actions", () => {
  const trace = { schemaVersion: "lakda/adaptive-trace/v1", seed: 4, trace: [], actions: 0, outcome: "partial", terminationReason: "duration_limit" };
  expect(() => validateAdaptiveEvidenceTrace(trace)).not.toThrow();
  expect(() => validateAdaptiveReplayTrace(trace)).toThrow(/requires/);
  expect(() => validateAdaptiveEvidenceTrace({ ...trace, schemaVersion: "unknown" })).toThrow(/schemaVersion/);
  expect(() => validateAdaptiveEvidenceTrace({ ...trace, trace: [{ type: "made-up" }] })).toThrow();
});
