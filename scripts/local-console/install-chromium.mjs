import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

// ほかのプロジェクトが使うブラウザーも、同じ Playwright キャッシュに入る。
const cli = fileURLToPath(new URL("cli.js", import.meta.resolve("playwright/package.json")));
const install = spawnSync(process.execPath, [cli, "install", "chromium"], {
  stdio: "inherit", windowsHide: true, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_GC: "1" },
});
if (install.error) throw install.error;
process.exitCode = install.status ?? 1;
