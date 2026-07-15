import { expect, test } from "@playwright/test";
import { generateInputs, matchesRecordedInputCase, recordInputCase, shrinkFailure } from "../../src/adaptive/input.js";

test("input generation is seeded, versioned, and covers every required input class", () => {
  const fields = [{ fieldId: "email", type: "email", required: true, minLength: 3, maxLength: 8, domainRef: "form:signup/email" }];
  const generated = generateInputs(fields, 7);
  expect(generated).toEqual(generateInputs(fields, 7));
  expect(new Set(generated.map(entry => entry.category))).toEqual(new Set([
    "equivalence", "boundary", "boundary-outside", "empty", "null-equivalent", "format-invalid", "length-invalid",
  ]));
  for (const entry of generated) {
    expect(entry.generatorVersion).toBe("lakda-input-generator/v1");
    expect(entry.seed).toBe(7);
    expect(entry.domainRef).toBe("form:signup/email");
    expect(entry.expectedOracleRef).toBeTruthy();
    expect(["valid", "invalid"]).toContain(entry.validity);
  }
  expect(generated.some(entry => entry.validity === "invalid")).toBe(true);
  expect(generated.map(entry => entry.value).join("|")).not.toContain("@gmail.com");
});

test("recorded InputCase omits raw values and verifies regenerated value digests", () => {
  const generated = generateInputs([{ fieldId: "email", type: "email", required: true }], 9)[0];
  const recorded = recordInputCase(generated);
  expect(recorded).not.toHaveProperty("value");
  expect(recorded.valueDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(matchesRecordedInputCase(recorded, generated)).toBe(true);
  expect(matchesRecordedInputCase(recorded, { ...generated, value: "tampered@example.test" })).toBe(false);
});

test("failure shrinking preserves dependency-valid reproducing subsequences", async () => {
  const result = await shrinkFailure([
    { id: "A" }, { id: "B", dependsOn: ["A"] }, { id: "C" }, { id: "D" },
  ], async sequence => sequence.some(step => step.id === "B") && sequence.some(step => step.id === "D"));
  expect(result.map(step => step.id)).toEqual(["A", "B", "D"]);
});
