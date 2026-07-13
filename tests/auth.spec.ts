import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { runCli } from "../src/cli.js";
import { startFixture } from "./fixtures/server.js";

test("auth validate uses declared storageState, validation path, and locator", async () => {
  const fixture = await startFixture(() => ({ body: '<main data-testid="member-menu">member</main>' }));
  const directory = await mkdtemp(join(tmpdir(), "lakda-auth-validate-"));
  try {
    const statePath = join(directory, "member.json");
    const configPath = join(directory, "lakda.config.json");
    await writeFile(statePath, JSON.stringify({ cookies: [], origins: [] }));
    await writeFile(configPath, JSON.stringify({
      schemaVersion: "lakda/v1",
      personas: { member: { storageStatePath: statePath, validationPath: "/account", loginUrlPattern: "/login", requiredLocator: { testId: "member-menu" } } },
    }));
    await expect(runCli(["auth", "validate", "--persona", "member", "--base-url", fixture.baseUrl, "--config", configPath])).resolves.toBe(0);
  } finally { await fixture.close(); await rm(directory, { recursive: true, force: true }); }
});