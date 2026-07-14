import { expect, test } from "@playwright/test";
import { findSensitive, redact } from "../src/core/redaction.js";

test("ISO timestamp run IDs are not phone-redacted", () => {
  const runId = "lakda:run-2026-07-14T11-09-44-629Z-fde461";
  expect(redact(runId)).toBe(runId);
  expect(findSensitive(runId)).toEqual([]);
});

test("real phone-like PII remains redacted", () => {
  const value = "tel-090-1234-5678";
  expect(redact(value)).toBe("tel-[REDACTED_PHONE]");
  expect(findSensitive(value)).toContain("pii");
});