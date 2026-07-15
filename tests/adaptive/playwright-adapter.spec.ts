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
        <h1>Adaptive corpus</h1>
        <section role="dialog" aria-label="Safe modal">Modal content</section>
        <label>Search <input data-testid="query" name="q"></label>
        <button data-testid="advance">Advance</button>
        <button data-testid="dialog" onclick="alert('safe dialog')">Dialog</button>
        <a data-testid="popup" target="_blank" href="/popup">Open popup</a>
        <button disabled data-testid="disabled">Disabled</button>
        <iframe src="/frame"></iframe>
        <iframe src="data:text/html,%3Cbutton%20data-testid%3D%27outside%27%3EOutside%3C/button%3E"></iframe>
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
    await page.locator("iframe").first().waitFor();
    const first = await adapter.observe(adapter.primaryTarget(), { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    const firstCandidates = await adapter.generateCandidates(first);
    expect(first.ui.primaryElements).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "heading", name: "Adaptive corpus" }),
      expect.objectContaining({ role: "dialog", name: "Safe modal", modal: true }),
    ]));
    expect(first.ui.domModals).toEqual([expect.objectContaining({ role: "dialog", name: "Safe modal", open: true })]);
    expect(first.dialogs).toEqual([]);
    const repeated = await adapter.observe(adapter.primaryTarget(), { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    expect(canonicalizeObservation(repeated)).toBe(canonicalizeObservation(first));
    expect(fingerprintObservation(repeated).value).toBe(fingerprintObservation(first).value);
    expect(() => assertAdaptiveContract(first)).not.toThrow();
    firstCandidates.forEach(candidate => expect(() => assertAdaptiveContract(candidate)).not.toThrow());
    expect(adapter.capabilities().observationCapabilities).toContain("network");
    expect(first.networkSummary?.some(entry => entry.status === 200 && typeof entry.url === "string" && entry.targetId === first.targetRef.targetId)).toBe(true);
    expect(adapter.activeTargets().filter(target => target.kind === "frame").length).toBeGreaterThanOrEqual(2);
    const outsideFrame = adapter.activeTargets().find(target => target.kind === "frame" && target.origin !== new URL(fixture.baseUrl).origin);
    expect(outsideFrame).toBeTruthy();
    const outsideObservation = await adapter.observe(outsideFrame!, { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    expect(outsideObservation.completeness).toBe("partial");
    expect(outsideObservation.ui.primaryElements).toEqual([]);
    expect(await adapter.generateCandidates(outsideObservation)).toEqual([]);
    expect(firstCandidates.some(candidate => candidate.locatorRecipe.value === "disabled")).toBe(false);

    const popup = firstCandidates.find(candidate => candidate.locatorRecipe.value === "popup");
    expect(popup).toBeTruthy();
    const popupOpened = context.waitForEvent("page");
    expect((await adapter.execute(popup!, { runId: "adapter-test", timeoutMs: 2_000 })).status).toBe("executed");
    await popupOpened;
    await page.waitForTimeout(20);

    const second = await adapter.observe(adapter.primaryTarget(), { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    const popupDetail = (second.topology.targetDetails as Array<Record<string, unknown>>).find(detail => detail.kind === "page" && detail.openerTargetId === first.targetRef.targetId);
    expect(popupDetail).toMatchObject({
      kind: "page",
      openerTargetId: first.targetRef.targetId,
      triggerActionId: popup!.candidateId,
      initialUrl: `${fixture.baseUrl}/popup`,
      settledUrl: `${fixture.baseUrl}/popup`,
      allowScope: "allowed",
      lifecycle: "active",
    });
    const dialog = (await adapter.generateCandidates(second)).find(candidate => candidate.locatorRecipe.value === "dialog");
    expect(dialog).toBeTruthy();
    expect((await adapter.execute(dialog!, { runId: "adapter-test", timeoutMs: 2_000 })).status).toBe("executed");
    const afterDialog = await adapter.observe(adapter.primaryTarget(), { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    expect(afterDialog.dialogs.at(-1)).toMatchObject({
      eventKind: "js-dialog",
      disposition: "dismissed",
      handlingPolicy: "default-deny/v1",
      triggerActionId: dialog!.candidateId,
      targetRef: { kind: "dialog", parentTargetId: first.targetRef.targetId },
    });
    const advance = (await adapter.generateCandidates(afterDialog)).find(candidate => candidate.locatorRecipe.value === "advance");
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

test("Playwright adapter integrates generic browser failures into Observation", async () => {
  const fixture = await startFixture(url => url.pathname === "/"
    ? { body: `<button data-testid="emit-errors" onclick="console.error('fixture-console'); setTimeout(() => { throw new Error('fixture-pageerror'); }, 0); fetch('/failure')">Emit</button>` }
    : undefined);
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  const adapter = new PlaywrightAdaptiveAdapter({ page, context, scopeHosts: ["127.0.0.1"], settlePolicy: { maxWaitMs: 2_000, stableWindowMs: 20 } });
  try {
    await page.goto(fixture.baseUrl);
    const before = await adapter.observe(adapter.primaryTarget(), { runId: "event-test", scopeHosts: ["127.0.0.1"] });
    const candidate = (await adapter.generateCandidates(before)).find(value => value.locatorRecipe.value === "emit-errors");
    expect(candidate).toBeTruthy();
    expect((await adapter.execute(candidate!, { runId: "event-test", timeoutMs: 2_000 })).status).toBe("executed");
    await page.waitForTimeout(50);
    const after = await adapter.observe(adapter.primaryTarget(), { runId: "event-test", scopeHosts: ["127.0.0.1"] });
    const events = after.ui.events as Array<Record<string, unknown>>;
    expect(events.map(event => event.kind)).toEqual(expect.arrayContaining(["console-error", "pageerror", "http-error"]));
    expect(events.every(event => typeof event.eventId === "string" && typeof event.targetId === "string")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("fixture-console");
    expect(JSON.stringify(events)).not.toContain("fixture-pageerror");
  } finally { await context.close(); await browser.close(); await fixture.close(); }
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
    const recoveredObservation = await adapter.observe(adapter.primaryTarget(), { runId: "recovery-test", scopeHosts: ["127.0.0.1"] });
    expect(canonicalizeObservation(recoveredObservation)).toBe(canonicalizeObservation(observation));
    expect(fingerprintObservation(recoveredObservation).value).toBe(fingerprintObservation(observation).value);
  } finally { await context.close(); await browser.close(); await fixture.close(); }
});
