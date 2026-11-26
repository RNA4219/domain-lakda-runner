import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { startSurfaceCoverage, surfaceRunIndex } from "../src/index.js";
import { readCatalog, match, matching, matchDocumentScreen, matchStaticScreen, scope, type Screen } from "../src/surface-coverage/catalog.js";
import { startFixture } from "./fixtures/server.js";

const exec = promisify(execFile);
const origin = "http://127.0.0.1:19000";
function screen(id: string, path: string, options: Partial<Screen> = {}): Screen {
  return { id, name: id, origin, path, channel: "web", frequency: 1, ...options };
}
function catalog(screens: Screen[], allowed = screens.map(s => s.id)) {
  const api = { id: "lookup", name: "lookup", origin: screens[0].origin, path: "/api/lookup", method: "GET", frequency: 1 };
  return { schema: "lakda/surface-catalog/v1", product: "synthetic", version: "v1", environment: "local", revision: "r1",
    screens, apis: [api], relations: screens.map(s => ({ screen: s.id, api: api.id })), publication: { screens: allowed, apis: [api.id] } };
}
const selected = (screens: Screen[], path: string) => match(readCatalog(catalog(screens)).screens, origin + path)?.id;

test("literal positions determine a unique maximal screen independently of catalog order", () => {
  const any = screen("any", "/{area}/{id}"), item = screen("item", "/items/{id}"), create = screen("create", "/items/new");
  for (const screens of [[any, item, create], [create, item, any]]) {
    expect(selected(screens, "/items/new")).toBe("create");
    expect(selected(screens, "/items/123")).toBe("item");
    expect(selected(screens, "/other/new")).toBe("any");
    expect(selected(screens, "/items/")).toBeUndefined();
  }
  for (const pair of [[screen("a", "/items/{id}"), screen("b", "/items/{name}")],
    [screen("a", "/items/new/{x}/{y}"), screen("b", "/{x}/{y}/details/{z}")]]) {
    const path = pair[0].path.includes("new") ? "/items/new/details/1" : "/items/new";
    expect(selected(pair, path)).toBeUndefined();
    expect(selected([...pair].reverse(), path)).toBeUndefined();
  }
});

test("URL specificity precedes state observation and preserves hash boundaries and private exclusions", () => {
  const item = screen("item", "/items/{id}"), state = screen("create", "/items/new", { state: { testId: "editing" } });
  const c = readCatalog(catalog([item, state, { ...state, id: "saved", state: { testId: "saved" } }]));
  expect(matching(c.screens, origin + "/items/new").map(p => p.id)).toEqual(["create", "saved"]);
  expect(matchStaticScreen(c, origin + "/items/new")).toBeUndefined();
  const hash = [screen("item", "/app", { hashRoute: "/items/{id}/", trailingSlash: "either" }),
    screen("create", "/app", { hashRoute: "/items/new/", trailingSlash: "either" })];
  expect(selected(hash, "/app/#/items/new/")).toBe("create");
  expect(selected(hash, "/app#/items/1/")).toBe("item");
  expect(selected(hash, "/app/#/items/new")).toBeUndefined();
  expect(selected([...hash, screen("app", "/app")], "/app#/items/new/")).toBeUndefined();
  for (const allowed of [["app"], ["app", hash[1].id]]) {
    const shell = readCatalog(catalog([screen("app", "/{shell}"), hash[1]], allowed));
    expect(matchDocumentScreen(shell, origin + "/app")).toBeUndefined();
    expect(matchDocumentScreen(shell, origin + "/other")?.id).toBe("app");
    expect(matchStaticScreen(shell, origin + "/app#unrelated")?.id).toBe("app");
  }
  expect(selected([screen("a", "/app", { hashRoute: "/{id}" }), screen("b", "/{app}", { hashRoute: "/new" })],
    "/app#/new")).toBeUndefined();
  for (const [allowed, hidden] of [[item, state], [state, item]]) {
    const filtered = readCatalog(catalog([{ ...allowed, trailingSlash: "either" }, { ...hidden, path: hidden.path + "/" }], [allowed.id]));
    expect(matching(filtered.screens, origin + "/items/new/")).toEqual([]);
    expect(matching(filtered.screens, origin + "/items/new")).toHaveLength(1);
  }
});

test("either is screen-only, covers one final slash, and gives duplicates no priority", () => {
  const one = screen("one", "/a/", { trailingSlash: "either" }), two = screen("two", "/a/");
  expect(selected([one, two], "/a")).toBe("one");
  expect(selected([one, two], "/a/")).toBeUndefined();
  expect(selected([two, one], "/a/")).toBeUndefined();
  expect(selected([one, { ...one, id: "two", path: "/a" }], "/a")).toBeUndefined();
  expect(() => readCatalog(catalog([one, { ...one, path: "/a" }]))).toThrow();
  expect(selected([one], "/a//")).toBeUndefined();
  expect(selected([screen("root", "/", { trailingSlash: "either" })], "//")).toBeUndefined();
  expect(selected([screen("root", "/", { trailingSlash: "either" })], "/")).toBe("root");
  expect(selected([screen("item", "/a/{id}/", { trailingSlash: "either" })], "/a/")).toBeUndefined();
  const raw = catalog([one]);
  for (const trailingSlash of [false, true, null, "ignore", {}]) {
    expect(() => readCatalog({ ...raw, screens: [{ ...one, trailingSlash }] })).toThrow();
  }
  expect(() => readCatalog({ ...raw, apis: [{ ...raw.apis[0], trailingSlash: "either" }] })).toThrow();
  const apis = [raw.apis[0], { ...raw.apis[0], id: "var", path: "/api/{id}" }, { ...raw.apis[0], id: "post", method: "POST" }];
  const c = readCatalog({ ...raw, apis, publication: { ...raw.publication, apis: apis.map(a => a.id) } });
  expect(match(c.apis.filter(a => a.method === "GET"), origin + "/api/lookup")).toBeUndefined();
  expect(match(c.apis.filter(a => a.method === "POST"), origin + "/api/lookup")?.id).toBe("post");
  expect(match(c.apis, origin + "/api/lookup/")).toBeUndefined();
});

test("screen and relation identities track alias and routing changes while unrelated identities stay stable", () => {
  const a = screen("a", "/a"), dynamic = screen("dynamic", "/{id}"), unrelated = screen("other", "/other/place");
  const identities = (screens: Screen[]) => scope(readCatalog(catalog(screens)));
  const old = identities([a, unrelated]), either = identities([{ ...a, trailingSlash: "either" }, unrelated]);
  expect(either).toEqual(identities([{ ...a, path: "/a/", trailingSlash: "either", name: "Renamed", frequency: 3 }, unrelated]));
  expect(either.screens[0]).not.toEqual(old.screens[0]);
  expect(either.relations[0]).not.toEqual(old.relations[0]);
  const peers = identities([a, unrelated, dynamic]), reverse = identities([dynamic, unrelated, a]);
  expect(peers.screens[0]).toEqual(reverse.screens[2]);
  expect(peers.screens[0]).not.toEqual(old.screens[0]);
  expect(peers.screens[2]).not.toEqual(identities([dynamic]).screens[0]);
  expect(peers.screens[1]).toEqual(old.screens[1]);
  expect(peers.relations[1]).toEqual(old.relations[1]);
  expect(peers.apis).toEqual(old.apis);
  const shell = screen("app", "/{shell}"), hidden = screen("private", "/app", { hashRoute: "/hidden/{id}" });
  const publicScope = (peers: Screen[]) => scope(readCatalog(catalog([shell, ...peers], [shell.id])));
  const guarded = publicScope([hidden]);
  expect(guarded.screens).not.toEqual(publicScope([]).screens);
  expect(guarded.relations).not.toEqual(publicScope([]).relations);
  expect(guarded.apis).toEqual(publicScope([]).apis);
  expect(guarded).not.toEqual(publicScope([{ ...hidden, path: "/other" }]));
  expect(guarded).toEqual(publicScope([hidden, { ...hidden, id: "second", hashRoute: "/alternate" }]));
  expect(guarded).toEqual(publicScope([{ ...hidden, id: "renamed", name: "Changed", hashRoute: "/changed" }]));
  expect(publicScope([screen("private", "/app", { trailingSlash: "either" })])).not.toEqual(publicScope([]));
});

test("public SDK and coverage CLI attribute each request to the selected screen across both spellings", async ({ browser }) => {
  const fixture = await startFixture(() => ({ body: "<main>synthetic</main>" }));
  try {
    const out = test.info().outputPath(), runs = join(out, "runs"), config = join(out, "catalog.json"), input = join(out, "index.json");
    await mkdir(out, { recursive: true });
    const screens = [screen("item", "/items/{id}", { origin: fixture.baseUrl }),
      screen("create", "/items/new", { origin: fixture.baseUrl, trailingSlash: "either" })];
    await writeFile(config, JSON.stringify(catalog(screens)));
    const records = [];
    for (const [testId, path] of [["bare", "/items/new"], ["slash", "/items/new/"], ["detail", "/items/42"]]) {
      const ctx = await browser.newContext();
      try {
        const session = await startSurfaceCoverage(ctx, { catalogPath: config, outputDir: runs, testId, testRevision: "v1", lane: "mock" });
        const page = await ctx.newPage();
        await page.goto(fixture.baseUrl + path);
        await page.evaluate(() => fetch("/api/lookup").then(r => r.text()));
        await session.checkpoint();
        records.push(await session.finish("passed"));
      } finally { await ctx.close(); }
    }
    await writeFile(input, JSON.stringify(surfaceRunIndex(records)));
    const command = [resolve("dist/cli.js"), "coverage", "surfaces", "--config", config, "--input", input, "--runs-dir", runs];
    const report = JSON.parse((await exec(process.execPath, command)).stdout);
    for (const [kind, suffix] of [["screens", ""], ["relations", ":lookup"]]) {
      expect(report[kind]).toHaveLength(2);
      for (const row of report[kind]) {
        const expected = row.id === "create" + suffix ? ["bare", "slash"] : ["detail"];
        expect(row.states.all).toBe("observed");
        expect(row.evidence.map((e: { testId: string }) => e.testId).sort()).toEqual(expected);
      }
    }
  } finally { await fixture.close(); }
});
