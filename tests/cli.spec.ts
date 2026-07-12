import { expect, test } from "@playwright/test";

import { runCli } from "../src/cli.js";

test("CLI help exits successfully", async () => {
  await expect(runCli([])).resolves.toBe(0);
});


test("CLI version and unknown options are parsed by Node standard parser", async () => {
  await expect(runCli(["--version"])).resolves.toBe(0);
  await expect(runCli(["--not-supported"])).resolves.toBe(1);
});