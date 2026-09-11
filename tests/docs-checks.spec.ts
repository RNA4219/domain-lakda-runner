import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const io = { readFileSync, readdirSync, statSync };
type Check = (root: string, reader: typeof io, paths?: string[]) => string[];
async function checker(file: string, name: string): Promise<Check> {
  const module = await import(pathToFileURL(join(root, "scripts/docs-checks", file + ".mjs")).href);
  return module[name] as Check;
}

function replaceRead(ref: string, replace: (text: string) => string): typeof io {
  const read: typeof readFileSync = ((...args: Parameters<typeof readFileSync>) => {
    const result = readFileSync(...args);
    return String(args[0]) === resolve(root, ref) ? replace(String(result)) : result;
  }) as typeof readFileSync;
  return { ...io, readFileSync: read };
}

for (const fixture of [
  { file: "v1", name: "checkV1", ref: "SPECIFICATION.md", replace: (s: string) => s.replaceAll("AC-001", "REMOVED-001"), diagnostic: "SPECIFICATION.md: missing AC-001" },
  { file: "release-profile", name: "checkReleaseProfile", ref: "release-profiles/current.json", replace: (s: string) => JSON.stringify({ ...JSON.parse(s), releaseVersion: "0.0.0-rc.1" }), diagnostic: "current release profile: package version mismatch" },
  { file: "adaptive", name: "checkAdaptive", ref: "REQUIREMENTS-ADAPTIVE-EXPLORATION.md", replace: () => "# Empty fixture", diagnostic: "adaptive requirements: expected 128, got 0" },
  { file: "extension", name: "checkExtension", ref: "docs/spec/lakda-extension/CHECKLIST-01-COMBINATION.md", replace: (s: string) => s.replace("non-normative-alias", "active"), diagnostic: "CHECKLIST-01-COMBINATION.md: invalid alias status" },
  { file: "maintainability", name: "checkMaintainability", ref: "REQUIREMENTS-MAINTAINABILITY.md", replace: () => "# Empty fixture", diagnostic: "maintainability requirements: expected 34, got 0" },
  { file: "birdseye", name: "checkBirdseye", ref: "docs/birdseye/index.json", replace: () => '{"nodes":{}}', diagnostic: "Birdseye index: missing REQUIREMENTS-MAINTAINABILITY.md" },
]) {
  test(fixture.file + " checker isolates its diagnostics through a read interface", async () => {
    const check = await checker(fixture.file, fixture.name);
    expect(check(root, io)).toEqual([]);
    expect(check(root, replaceRead(fixture.ref, fixture.replace))).toContain(fixture.diagnostic);
  });
}

test("Markdown checker accepts independent fixture and reports broken link, fence and JSON", async () => {
  const check = await checker("markdown", "checkMarkdown");
  const fixture = await mkdtemp(join(tmpdir(), "lakda-docs-"));
  const path = join(fixture, "README.md");
  try {
    await writeFile(path, "# Fixture\n[Self](README.md)\n```json\n{}\n```\n");
    expect(check(fixture, io, [path])).toEqual([]);
    await writeFile(path, "[Missing](missing.md)\n```json\n{broken}\n```\n```text\n");
    expect(check(fixture, io, [path])).toEqual([
      "README.md: unclosed code fence", "README.md: broken link missing.md", "README.md: invalid JSON fence",
    ]);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("schema registry checker rejects an unresolved reference", async () => {
  const check = await checker("schemas", "checkSchemas");
  expect(check(root, io, [])).toEqual([]);
  const changed = replaceRead("schemas/release-profile-v1.schema.json", text => JSON.stringify({ ...JSON.parse(text), $ref: "absent.schema.json" }));
  expect(check(root, changed, []).some(message => message.includes("schema compile failed"))).toBe(true);
});

test("release checker rejects executable P6 restoration and missing or changed historical bytes", async () => {
  const check = await checker("release-profile", "checkReleaseProfile");
  const legacy = resolve(root, ".github/workflows/release-p6-rc.yml");
  const archive = "docs/release-gate/history/release-p6-rc.yml.txt";
  expect(check(root, io)).toEqual([]);
  const restored = { ...io, statSync: ((...args: Parameters<typeof statSync>) => String(args[0]) === legacy ? statSync(join(root, "package.json")) : statSync(...args)) as typeof statSync };
  expect(check(root, restored)).toContain("release-p6-rc workflow: executable legacy workflow is forbidden");
  const missing = { ...io, statSync: ((...args: Parameters<typeof statSync>) => String(args[0]) === resolve(root, archive) ? undefined : statSync(...args)) as typeof statSync };
  expect(check(root, missing)).toContain("release-p6-rc archive: missing file");
  expect(check(root, replaceRead(archive, text => text + "\n"))).toContain("release-p6-rc archive: bytes mismatch");
  const live = replaceRead(".github/workflows/release-evidence.yml", text => text + '\n      - run: "lakda/p6-rc-delivery/v1"\n');
  expect(check(root, live)).toContain("release-evidence.yml: legacy P6 delivery contract");
});

test("UP checker validates independent requirement, acceptance, specification and task fixtures", async () => {
  const check = await checker("up", "checkUp");
  const fixtureRoot = resolve(root, "fixture-up");
  const docs = new Map([
    ["docs/proposals/20260910-detailed-requirements.md", "| REQ-UP-TEST-001 | Must | Test |"],
    ["docs/proposals/20260910-report-detail.md", "| REQ-UP-TEST-002 | Should | Later |"],
    ["docs/proposals/20260910-detailed-checklist.md", "| AC-UP-001 | Test | REQ-UP-TEST-001 | M1 |"],
    ["docs/spec/verification-reports/README.md", "[S](SPEC-01-TEST.md) [C](CHECKLIST-01-TEST.md)"],
    ["docs/spec/verification-reports/SPEC-01-TEST.md", "---\ndocument_id: SPEC-TEST\nchecklist: CHECKLIST-01-TEST.md\n---\n[C](CHECKLIST-01-TEST.md)"],
    ["docs/spec/verification-reports/CHECKLIST-01-TEST.md", "---\ndocument_id: CHECK-TEST\nspecification: SPEC-01-TEST.md\n---\n[S](SPEC-01-TEST.md)"],
    ["docs/tasks/TASK.fixture.md", "---\nintent_id: INT-LAKDA-UP-001\nspecification: ../spec/verification-reports/SPEC-01-TEST.md\n---\n[仕様](../spec/verification-reports/SPEC-01-TEST.md)"],
  ]);
  const ref = (path: unknown) => String(path).slice(fixtureRoot.length + 1).replaceAll("\\", "/");
  const fixtureIo = {
    readFileSync: (path: unknown) => { const data = docs.get(ref(path)); if (data === undefined) throw new Error("missing fixture"); return data; },
    statSync: (path: unknown) => docs.has(ref(path)) ? { isFile: () => true } : undefined,
    readdirSync: (path: unknown) => [...docs.keys()].filter(key => key.startsWith(ref(path) + "/") && !key.slice(ref(path).length + 1).includes("/")).map(key => key.split("/").at(-1)!),
  } as unknown as typeof io;
  expect(check(fixtureRoot, fixtureIo)).toEqual([]);
  const req = "docs/proposals/20260910-detailed-requirements.md";
  docs.set(req, docs.get(req)! + "\n" + docs.get(req)! + "\n| REQ-UP-TEST-003 | Must | Unmapped |");
  const diagnostics = check(fixtureRoot, fixtureIo);
  expect(diagnostics).toContain("UP: duplicate requirement REQ-UP-TEST-001");
  expect(diagnostics).toContain("UP: Must requirement has no acceptance REQ-UP-TEST-003");
  docs.set("docs/spec/verification-reports/CHECKLIST-01-TEST.md", "---\ndocument_id: CHECK-TEST\nspecification: absent.md\n---");
  expect(check(fixtureRoot, fixtureIo)).toContain("UP: invalid specification backlink CHECKLIST-01-TEST.md");
  docs.set("docs/tasks/TASK.fixture.md", "---\nintent_id: INT-LAKDA-UP-001\nspecification: absent.md\n---");
  expect(check(fixtureRoot, fixtureIo)).toContain("UP: task has no valid specification TASK.fixture.md");
});
