import { checkSchemas } from "./docs-checks/schemas.mjs";
import { checkUp } from "./docs-checks/up.mjs";
import { checkV1 } from "./docs-checks/v1.mjs";
import { checkBirdseye } from "./docs-checks/birdseye.mjs";
import { checkExtension } from "./docs-checks/extension.mjs";
import { checkMaintainability } from "./docs-checks/maintainability.mjs";
import { checkAdaptive } from "./docs-checks/adaptive.mjs";
import { checkReleaseProfile } from "./docs-checks/release-profile.mjs";
import { filesystem, walk } from "./docs-checks/context.mjs";
import { checkMarkdown } from "./docs-checks/markdown.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const markdownPaths = walk(root, filesystem);
failures.push(...checkMarkdown(root, filesystem, markdownPaths));

failures.push(...checkV1(root, filesystem));

failures.push(...checkSchemas(root, filesystem, markdownPaths));

failures.push(...checkAdaptive(root, filesystem));

failures.push(...checkExtension(root, filesystem));

failures.push(...checkBirdseye(root, filesystem));

failures.push(...checkMaintainability(root, filesystem));

failures.push(...checkReleaseProfile(root, filesystem));

failures.push(...checkUp(root, filesystem));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("docs contract: pass");
}
