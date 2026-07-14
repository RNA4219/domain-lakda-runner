import { expect, test } from "@playwright/test";
import { chromium } from "playwright";
import { PlaywrightAdaptiveAdapter } from "../../src/adapters/playwright.js";
import { assertAdaptiveContract } from "../../src/adaptive/contracts.js";
import { canonicalizeObservation, fingerprintObservation } from "../../src/adaptive/fingerprint.js";
import { startFixture } from "../fixtures/server.js";

test("Playwright adapter re-observes dynamic DOM and rejects stale candidates", async () => {
  const fixture = await startFixture(url => {
    if (url.pathname === "/frame") return { body: "<button data-testid='inside-frame'>Frame action</button>" };
    if (url.pathname === "/popup") return { body: "<h1>Popup</h1>" };
    return {
      body: `<main>
        <label>Search <input data-testid="query" name="q"></label>
        <button data-testid="advance">Advance</button>
        <button data-testid="dialog" onclick="alert('safe dialog')">Dialog</button>
        <a data-testid="popup" target="_blank" href="/popup">Open popup</a>
        <button disabled data-testid="disabled">Disabled</button>
        <iframe src="/frame"></iframe>
      </main>
      <script>document.querySelector("[data-testid=advance]").addEventListener("click", () => { document.querySelector("main").innerHTML = "<button data-testid='finish'>Finish</button>"; });</script>`,
    };
  });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const adapter = new PlaywrightAdaptiveAdapter({ page, context, scopeHosts: ["127.0.0.1", "localhost"], settlePolicy: { maxWaitMs: 2_000, stableWindowMs: 20 } });

  try {
    await page.goto(fixture.baseUrl);
    await page.locator("iframe").waitFor();
    const first = await adapter.observe(adapter.primaryTarget(), { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    const firstCandidates = await adapter.generateCandidates(first);
    const repeated = await adapter.observe(adapter.primaryTarget(), { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    expect(canonicalizeObservation(repeated)).toBe(canonicalizeObservation(first));
    expect(fingerprintObservation(repeated).value).toBe(fingerprintObservation(first).value);
    expect(() => assertAdaptiveContract(first)).not.toThrow();
    firstCandidates.forEach(candidate => expect(() => assertAdaptiveContract(candidate)).not.toThrow());
    expect(adapter.activeTargets().some(target => target.kind === "frame")).toBe(true);
    expect(firstCandidates.some(candidate => candidate.locatorRecipe.value === "disabled")).toBe(false);

    const popup = firstCandidates.find(candidate => candidate.locatorRecipe.value === "popup");
    expect(popup).toBeTruthy();
    const popupOpened = context.waitForEvent("page");
    expect((await adapter.execute(popup!, { runId: "adapter-test", timeoutMs: 2_000 })).status).toBe("executed");
    await popupOpened;
    await page.waitForTimeout(20);

    const second = await adapter.observe(adapter.primaryTarget(), { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    const advance = (await adapter.generateCandidates(second)).find(candidate => candidate.locatorRecipe.value === "advance");
    expect(advance).toBeTruthy();
    const execution = await adapter.execute(advance!, { runId: "adapter-test", timeoutMs: 2_000 });
    expect(execution.status).toBe("executed");
    expect(execution.postFingerprint).not.toBe(execution.preFingerprint);

    const after = await adapter.observe(adapter.primaryTarget(), { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    expect((await adapter.generateCandidates(after)).some(candidate => candidate.locatorRecipe.value === "finish")).toBe(true);
    expect((await adapter.execute(advance!, { runId: "adapter-test", timeoutMs: 2_000 })).status).toBe("denied");
  } finally {
    await context.close();
    await browser.close();
    await fixture.close();
  }
});

test("Playwright adapter backtracks after an execution failure without exposing runtime handles", async () => {
  const fixture = await startFixture(url => url.pathname === "/next"
    ? { body: "<h1>Next</h1>" }
    : { body: "<a data-testid='next' href='/next'>Next</a>" });
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  const adapter = new PlaywrightAdaptiveAdapter({ page, context, scopeHosts: ["127.0.0.1"] });
  try {
    await page.goto(fixture.baseUrl);
    const observation = await adapter.observe(adapter.primaryTarget(), { runId: "recovery-test", scopeHosts: ["127.0.0.1"] });
    const candidate = (await adapter.generateCandidates(observation)).find(value => value.locatorRecipe.value === "next");
    expect(candidate).toBeTruthy();
    expect((await adapter.execute(candidate!, { runId: "recovery-test", timeoutMs: 2_000 })).status).toBe("executed");
    const recovery = await adapter.recover({ category: "timeout", messageRef: "timeout", targetRef: adapter.primaryTarget() }, { runId: "recovery-test", strategy: "backtrack" });
    expect(recovery.recovered).toBe(true);
    expect(page.url()).toBe(fixture.baseUrl + "/");
  } finally { await context.close(); await browser.close(); await fixture.close(); }
});
