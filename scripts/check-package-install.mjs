import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable");

const prefix = join(tmpdir(), "lakda-package-install-");
const temp = await mkdtemp(prefix);
const resolvedTemp = resolve(temp);
if (!resolvedTemp.startsWith(resolve(tmpdir()) + sep) || !basename(resolvedTemp).startsWith("lakda-package-install-")) {
  throw new Error("temporary package directory is outside the expected boundary");
}

try {
  const packed = JSON.parse(execFileSync(process.execPath, [
    npmCli,
    "pack",
    "--json",
    "--pack-destination",
    resolvedTemp,
  ], { cwd: root, encoding: "utf8" }));
  if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== "string") {
    throw new Error("npm pack output is invalid");
  }
  const tarball = join(resolvedTemp, packed[0].filename);
  const consumer = join(resolvedTemp, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "lakda-package-consumer",
    version: "1.0.0",
    private: true,
    type: "module",
  }), "utf8");
  execFileSync(process.execPath, [
    npmCli,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--prefer-offline",
    tarball,
  ], { cwd: consumer, encoding: "utf8" });

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const cli = join(consumer, "node_modules", "domain-lakda-runner", "dist", "cli.js");
  const help = execFileSync(process.execPath, [cli, "--help"], { cwd: consumer, encoding: "utf8" });
  if (!help.includes("lakda") || !help.includes("runs list") || !help.includes("runs compare")) {
    throw new Error("installed package CLI help is incomplete");
  }
  const importedVersion = execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    "import { LAKDA_VERSION } from 'domain-lakda-runner'; process.stdout.write(LAKDA_VERSION);",
  ], { cwd: consumer, encoding: "utf8" });
  if (importedVersion !== packageJson.version) {
    throw new Error("installed package export version mismatch");
  }
  console.log(JSON.stringify({
    status: "passed",
    packageVersion: packageJson.version,
    isolatedInstall: true,
    cliHelp: true,
    packageImport: true,
  }));
} finally {
  if (resolvedTemp.startsWith(resolve(tmpdir()) + sep) && basename(resolvedTemp).startsWith("lakda-package-install-")) {
    await rm(resolvedTemp, { recursive: true, force: true });
  }
}
