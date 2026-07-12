import { expect, test } from "@playwright/test";

import { runCli } from "../src/cli.js";

test("CLI help exits successfully", () => {
  expect(runCli([])).toBe(0);
});
