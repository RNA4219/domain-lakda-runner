import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020").default;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function portablePath(value) {
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error(`release profile path is not portable: ${value}`);
  }
  const path = resolve(root, value);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`release profile path escapes repository: ${value}`);
  if (!existsSync(path)) throw new Error(`release profile path does not exist: ${value}`);
  const real = realpathSync(path);
  const realRel = relative(realpathSync(root), real);
  if (realRel.startsWith("..") || isAbsolute(realRel)) throw new Error(`release profile path resolves outside repository: ${value}`);
  return value.replaceAll("\\", "/");
}

const profilePath = resolve(root, argument("profile", "release-profiles/current.json"));
const packagePath = resolve(root, argument("package", "package.json"));
const schemaPath = resolve(root, argument("schema", "schemas/release-profile-v1.schema.json"));
const out = argument("out", "");

const profileBytes = readFileSync(profilePath);
const profile = JSON.parse(profileBytes.toString("utf8"));
const packageJson = readJson(packagePath);
const schema = readJson(schemaPath);
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
if (!validate(profile)) throw new Error(`release profile schema validation failed: ${JSON.stringify(validate.errors)}`);
if (profile.releaseVersion !== packageJson.version) {
  throw new Error(`release profile version ${profile.releaseVersion} does not match package version ${packageJson.version}`);
}

const references = [
  profile.designInputs.featureSpec,
  profile.designInputs.riskRegister,
  profile.designInputs.manualCaseSet,
  profile.randAudit.preset,
  profile.randAudit.evidence,
].map(portablePath);

const result = {
  schemaVersion: "lakda/release-profile-validation/v1",
  status: "valid",
  profileId: profile.profileId,
  releaseVersion: profile.releaseVersion,
  releaseScope: profile.releaseScope,
  artifactPrefix: profile.artifactPrefix,
  profileSha256: createHash("sha256").update(profileBytes).digest("hex"),
  references,
  requiredChecks: profile.requiredChecks,
};

const json = JSON.stringify(result, null, 2) + "\n";
if (out) {
  const outPath = resolve(root, out);
  const rel = relative(root, outPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("validation output must stay inside repository");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
}
process.stdout.write(json);
