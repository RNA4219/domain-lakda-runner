import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import { loadConfig } from "../core/config.js";
import { authStatePath } from "../core/runner.js";
import { configOverrides, stringFlag, type Flags } from "../cli/parser.js";

export async function captureAuthCommand(flags: Flags): Promise<number> {
  const persona = stringFlag(flags, "persona", true)!;
  const browserName = stringFlag(flags, "browser", true);
  const baseUrl = stringFlag(flags, "base-url", true)!;
  if (browserName !== "chromium") throw new Error("v1 は --browser chromium だけを許可します");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const terminal = createInterface({ input, output });
    await terminal.question("ブラウザで認証後、Enterを押してください: ");
    terminal.close();
    const destination = authStatePath(persona);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    await context.storageState({ path: destination });
    console.log(JSON.stringify({ persona, storageState: destination }));
    return 0;
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function validateAuthCommand(flags: Flags): Promise<number> {
  const persona = stringFlag(flags, "persona", true)!;
  const baseUrl = stringFlag(flags, "base-url", true)!;
  const config = loadConfig(
    stringFlag(flags, "config") ?? resolve(process.cwd(), "lakda.config.json"),
    { ...configOverrides(flags), baseUrl, persona },
  );
  const declaration = config.personas[persona];
  const state = declaration.storageStatePath ?? authStatePath(persona);
  if (!existsSync(state)) throw new Error(`storageStateがありません: ${state}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    const response = await page.goto(
      new URL(declaration.validationPath ?? "/", baseUrl).toString(),
      { waitUntil: "domcontentloaded" },
    );
    let ok = Boolean(response && response.status() < 400);
    if (declaration.loginUrlPattern && new RegExp(declaration.loginUrlPattern).test(page.url())) ok = false;
    if (declaration.requiredLocator) {
      const locator = declaration.requiredLocator.testId
        ? page.getByTestId(declaration.requiredLocator.testId)
        : page.getByRole(declaration.requiredLocator.role!, {
          name: declaration.requiredLocator.name!,
          exact: true,
        });
      ok = ok && await locator.isVisible({ timeout: 1_000 });
    }
    await context.close();
    console.log(JSON.stringify({
      persona,
      valid: ok,
      status: response?.status(),
      validationPath: declaration.validationPath ?? "/",
    }));
    return ok ? 0 : 2;
  } finally {
    await browser.close();
  }
}
