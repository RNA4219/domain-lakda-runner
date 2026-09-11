import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const Ajv = createRequire(import.meta.url)("ajv/dist/2020").default;

export function checkReleaseProfile(root, io) {
  const { readFileSync, readdirSync, statSync } = io;
  const failures = [];
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const profilePath = resolve(root, "release-profiles/current.json");
  const profileSchemaPath = resolve(root, "schemas/release-profile-v1.schema.json");
  if (!statSync(profilePath, { throwIfNoEntry: false }) || !statSync(profileSchemaPath, { throwIfNoEntry: false })) {
    failures.push("current release profile/schema missing");
  } else {
    const profile = JSON.parse(readFileSync(profilePath, "utf8"));
    const profileSchema = JSON.parse(readFileSync(profileSchemaPath, "utf8"));
    const validateProfile = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(profileSchema);
    if (!validateProfile(profile)) failures.push("current release profile: schema mismatch");
    if (profile.releaseVersion !== packageJson.version) failures.push("current release profile: package version mismatch");
    for (const ref of [profile.designInputs?.featureSpec, profile.designInputs?.riskRegister, profile.designInputs?.manualCaseSet, profile.randAudit?.preset, profile.randAudit?.evidence]) {
      if (typeof ref !== "string" || !ref || /^[A-Za-z]:[\\/]|^[/\\]/.test(ref) || /(^|[\\/])\.\.([\\/]|$)/.test(ref) || !statSync(resolve(root, ref), { throwIfNoEntry: false })) failures.push("current release profile: invalid ref " + String(ref));
    }
  }
  const liveWorkflow = readFileSync(resolve(root, ".github/workflows/release-evidence.yml"), "utf8");
  if (/rc5|v0\.3\.0-rc\.5/i.test(liveWorkflow)) failures.push("release-evidence workflow: legacy rc5 literal");
  for (const marker of ["release-profiles/current.json", "reference_target_manifest_path", "validate-release-profile.mjs", "requiredChecks"]) {
    if (!liveWorkflow.includes(marker)) failures.push("release-evidence workflow: missing " + marker);
  }
  const p6WorkflowPath = resolve(root, ".github/workflows/release-p6-rc.yml");
  if (statSync(p6WorkflowPath, { throwIfNoEntry: false })) failures.push("release-p6-rc workflow: executable legacy workflow is forbidden");
  const archive = resolve(root, "docs/release-gate/history/release-p6-rc.yml.txt");
  if (!statSync(archive, { throwIfNoEntry: false })?.isFile()) failures.push("release-p6-rc archive: missing file");
  else {
    // Immutable bytes copied before retirement, including the original checkout's CRLF.
    const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
    if (digest !== "afdd0092f07960f002eaf474a1029e88486112a02457729f5d7f4b9653178cba") failures.push("release-p6-rc archive: bytes mismatch");
  }
  for (const name of readdirSync(resolve(root, ".github/workflows")).filter(name => /\.ya?ml$/.test(name))) {
    const text = readFileSync(resolve(root, ".github/workflows", name), "utf8");
    if (/lakda\/p6-rc-delivery\/v1|lakda-p6-v0\.3\.0-rc\.1|m\.LAKDA_VERSION\s*!==\s*['"]0\.3\.0-rc\.1/.test(text)) failures.push(name + ": legacy P6 delivery contract");
  }
  return failures;
}
