import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readCatalog, matching, definition, digest } from "../src/surface-coverage/catalog.js";
import { startSurfaceCoverage, surfaceRunIndex } from "../src/index.js";
import { startFixture } from "./fixtures/server.js";

const exec = promisify(execFile);
function raw(origin = "http://127.0.0.1:19000", path = "/signin/") {
  return { schema: "lakda/surface-catalog/v1", product: "synthetic", version: "b".repeat(40), environment: "local", revision: "slash-role-1",
    screens: [{ id: "signin", name: "Sign in", origin, path, channel: "web", frequency: 1 }],
    apis: [{ id: "lookup", name: "Lookup", origin, path: "/api/{id}/", method: "GET", frequency: 1 }],
    relations: [{ screen: "signin", api: "lookup" }], publication: { screens: ["signin"], apis: ["lookup"] } };
}

test("single trailing slash is significant for screens, APIs and hash templates", () => {
  for (const path of ["/", "/signin", "/signin/", "/users/{id}/", "/app.v1/"]) {
    const value = raw(undefined, path), catalog = readCatalog(value), actual = path.replace("{id}", "example");
    expect(matching(catalog.screens, value.screens[0].origin + actual)).toHaveLength(1);
    for (const other of [actual + "/", actual === "/" ? "//" : actual.slice(0, -1)]) {
      if (other !== actual && other.startsWith("/")) expect(matching(catalog.screens, value.screens[0].origin + other)).toEqual([]);
    }
  }
  for (const path of ["//", "/signin//", "/a//b", "/a//b/", "/./", "/../", "/%61/", "/a/?q=x", "/a/#x"]) {
    expect(() => readCatalog(raw(undefined, path))).toThrow("Invalid surface catalog or publication policy");
  }
  const value = raw();
  const catalog = readCatalog({ ...value, screens: [{ ...value.screens[0], path: "/app/", hashRoute: "/detail/{id}/" }] });
  expect(matching(catalog.screens, value.screens[0].origin + "/app/#/detail/example/?private=value")).toHaveLength(1);
  expect(matching(catalog.screens, value.screens[0].origin + "/app/#/detail/example")).toEqual([]);
  expect(matching(catalog.apis, value.screens[0].origin + "/api/example/")).toHaveLength(1);
  expect(matching(catalog.apis, value.screens[0].origin + "/api/example")).toEqual([]);
});

test("private overlap and old definition digests preserve exact URL identity", () => {
  const value = raw(undefined, "/signin"), old = readCatalog(value).screens[0];
  expect(definition(old)).toBe(digest(["signin", old.origin, "/signin", "", "web"]));
  const oldReady = readCatalog({ ...value, screens: [{ ...value.screens[0], ready: { testId: "ready" } }] }).screens[0];
  expect(definition(oldReady)).toBe(digest(["signin", old.origin, "/signin", "", "web", { hashRoute: null, state: null, ready: { testId: "ready", timeoutMs: 5000 } }]));
  const slash = { ...value.screens[0], path: "/signin/" };
  expect(definition(readCatalog({ ...value, screens: [slash] }).screens[0])).not.toBe(definition(old));
  const projected = readCatalog({ ...value, screens: [slash, { ...slash, id: "private", path: "/{id}/" }] });
  expect(matching(projected.screens, old.origin + "/signin/")).toEqual([]);
  expect(JSON.stringify(projected)).not.toContain("private");
  const distinct = readCatalog({ ...value, screens: [slash, { ...slash, id: "private", path: "/signin/{id}" }] });
  expect(matching(distinct.screens, old.origin + "/signin/")).toHaveLength(1);
});

test("ready accepts only testId or the replay visible role/name contract", () => {
  const value = raw();
  for (const role of ["button", "link", "textbox", "checkbox", "combobox", "option", "menuitem", "tab"]) {
    const screen = readCatalog({ ...value, screens: [{ ...value.screens[0], ready: { role, name: "Ready" } }] }).screens[0];
    expect(screen.ready).toEqual({ role, name: "Ready", timeoutMs: 5000 });
  }
  for (const ready of [{ role: "heading", name: "Ready" }, { role: "button" }, { name: "Ready" }, { role: "button", name: " " },
    { testId: "ready", role: "button", name: "Ready" }, { testId: "ready", name: "Ready" }, { selector: "button" },
    { role: "button", name: { regex: "Ready" } }, { role: "button", name: "Ready", exact: false }, { testId: "ready", timeoutMs: 0 }, { testId: "ready", timeoutMs: 30001 }]) {
    expect(() => readCatalog({ ...value, screens: [{ ...value.screens[0], ready }] })).toThrow("Invalid surface catalog or publication policy");
  }
  expect(() => readCatalog({ ...value, screens: [{ ...value.screens[0], state: { role: "button", name: "Ready" } }] })).toThrow();
});

test("public SDK and CLI wait for role readiness and real delayed slash API relations", async ({ browser }) => {
  const fixture = await startFixture(url => ({ body: url.pathname.startsWith("/api/") ? "PRIVATE-BODY" :
    '<script>setTimeout(()=>fetch("/api/PRIVATE-PATH/?token=PRIVATE-QUERY").then(()=>{document.body.innerHTML="<button>Ready</button>"}),180)</script>' }));
  const context = await browser.newContext();
  try {
    const out = test.info().outputPath(); await mkdir(out, { recursive: true });
    const value = raw(fixture.baseUrl), catalogPath = join(out, "catalog.json"), runs = join(out, "runs");
    await writeFile(catalogPath, JSON.stringify({ ...value, screens: [{ ...value.screens[0], ready: { role: "button", name: "Ready", timeoutMs: 3000 } }] }));
    const session = await startSurfaceCoverage(context, { catalogPath, outputDir: runs, testId: "TC-ROLE", testRevision: "v1", lane: "real" });
    const page = await context.newPage(); await page.goto(fixture.baseUrl + "/signin/"); await session.checkpoint();
    expect(await page.getByRole("button", { name: "Ready", exact: true }).isVisible()).toBe(true);
    const record = await session.finish("failed"); expect(record.complete).toBe(true); expect(page.isClosed()).toBe(false);
    const bytes = await readFile(record.measurementPath, "utf8"), m = JSON.parse(bytes);
    expect(m.observations).toContainEqual({ kind: "relations", id: "signin:lookup", lane: "real" }); expect(bytes).not.toContain("PRIVATE-");
    const index = join(out, "index.json"); await writeFile(index, JSON.stringify(surfaceRunIndex([record])));
    const command = [resolve("dist/cli.js"), "coverage", "surfaces", "--config", catalogPath, "--input", index, "--runs-dir", runs];
    const report = JSON.parse((await exec(process.execPath, command)).stdout);
    expect(report.relations[0].states.real).toBe("observed"); expect(report.relations[0].evidence[0].outcome).toBe("failed");
    expect(JSON.stringify(report)).not.toContain("PRIVATE-"); expect(JSON.stringify(report)).not.toContain('"ready"');
    expect((await exec(process.execPath, [...command, "--format", "html"])).stdout).not.toContain("PRIVATE-");
  } finally { await context.close(); await fixture.close(); }
});

for (const [label, body] of [["duplicate", "<button>Ready</button><button>Ready</button>"], ["hidden", "<button hidden>Ready</button>"],
  ["substring", "<button>Ready later</button>"], ["case", "<button>ready</button>"], ["absent", "<p>Loading</p>"]] as const) {
  test(`role readiness ${label} leaves missing API unmeasured`, async ({ browser }) => {
    const fixture = await startFixture(() => ({ body })), context = await browser.newContext();
    try {
      const out = test.info().outputPath(); await mkdir(out, { recursive: true }); const value = raw(fixture.baseUrl), catalogPath = join(out, "catalog.json");
      await writeFile(catalogPath, JSON.stringify({ ...value, screens: [{ ...value.screens[0], ready: { role: "button", name: "Ready", timeoutMs: 60 } }] }));
      const session = await startSurfaceCoverage(context, { catalogPath, outputDir: join(out, "runs"), testId: "TC-NEGATIVE", testRevision: "v1" });
      const page = await context.newPage(); await page.goto(fixture.baseUrl + "/signin/");
      const record = await session.finish("passed"); expect(record.complete).toBe(false);
      const index = join(out, "index.json"); await writeFile(index, JSON.stringify(surfaceRunIndex([record])));
      const report = JSON.parse((await exec(process.execPath, [resolve("dist/cli.js"), "coverage", "surfaces", "--config", catalogPath, "--input", index, "--runs-dir", join(out, "runs")])).stdout);
      expect(report.apis[0].states.all).toBe("unmeasured"); expect(report.relations[0].states.all).toBe("unmeasured");
    } finally { await context.close(); await fixture.close(); }
  });
}
