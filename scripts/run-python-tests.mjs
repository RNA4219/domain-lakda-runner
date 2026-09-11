import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!["--python", "--out"].includes(name) || !value || value.startsWith("--") || flags.has(name)) {
    throw new Error("Usage: node scripts/run-python-tests.mjs [--python <executable>] [--out <directory>]");
  }
  flags.set(name, value);
}
const explicitPython = flags.get("--python") ?? process.env.LAKDA_PYTHON;
const executable = explicitPython ?? (process.platform === "win32" ? "py" : "python3");
const prefix = !explicitPython && process.platform === "win32" ? ["-3"] : [];
const probe = spawnSync(executable, [...prefix, "--version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
if (probe.error || probe.status !== 0) {
  throw new Error("実行可能なPythonがありません。--pythonまたはLAKDA_PYTHONで明示してください。自動installやskipは行いません。");
}
const args = [...prefix, "-B", resolve(root, "tests/python/run_tests.py")];
if (flags.has("--out")) args.push("--out", resolve(flags.get("--out")));
const result = spawnSync(executable, args, { cwd: root, stdio: "inherit", windowsHide: true, timeout: 120_000 });
if (result.error) throw new Error("Python bridge tests did not complete: " + result.error.message);
process.exitCode = result.status ?? 1;
