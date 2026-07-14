import { expect, test } from "@playwright/test";
import { generateInputs, shrinkFailure } from "../../src/adaptive/input.js";

test("input generation is seeded and covers equivalence, boundary, and abnormal values", () => {
  const fields = [{ fieldId: "email", type: "email", required: true, minLength: 3, maxLength: 8 }];
  expect(generateInputs(fields, 7)).toEqual(generateInputs(fields, 7));
  expect(new Set(generateInputs(fields, 7).map(entry => entry.category))).toEqual(new Set(["equivalence", "boundary", "abnormal"]));
});

test("failure shrinking preserves dependency-valid reproducing subsequences", async () => {
  const result = await shrinkFailure([
    { id: "A" }, { id: "B", dependsOn: ["A"] }, { id: "C" }, { id: "D" },
  ], async sequence => sequence.some(step => step.id === "B") && sequence.some(step => step.id === "D"));
  expect(result.map(step => step.id)).toEqual(["A", "B", "D"]);
});
