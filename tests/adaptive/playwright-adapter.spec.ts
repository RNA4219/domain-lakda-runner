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
        <label>Search <input data-testid="query" name="q"></label><form id="plan-form"><label>Plan <select data-testid="plan"><option value="hidden" hidden>Hidden</option><option value="basic">Basic</option><option value="disabled" disabled>Disabled</option><option value="pro">Pro</option></select></label></form>
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
    expect(first.forms).toEqual([expect.objectContaining({ fields: expect.arrayContaining([expect.objectContaining({ fieldId: "plan", options: ["basic", "pro"] })]) })]);
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
    const insideFrame = adapter.activeTargets().find(target => target.kind === "frame" && target.origin === new URL(fixture.baseUrl).origin);
    expect(insideFrame).toBeTruthy();
    const frameObservation = await adapter.observe(insideFrame!, { runId: "adapter-test", scopeHosts: ["127.0.0.1"] });
    expect(frameObservation.completeness).toBe("complete");
    const frameCandidate = (await adapter.generateCandidates(frameObservation)).find(candidate => candidate.locatorRecipe.value === "inside-frame");
    expect(frameCandidate).toMatchObject({
      targetRef: { kind: "frame", parentTargetId: first.targetRef.targetId, framePath: insideFrame!.framePath },
      locatorRecipe: { strategy: "test-id", value: "inside-frame", framePath: insideFrame!.framePath },
    });
    const frameDetail = (first.topology.targetDetails as Array<Record<string, unknown>>).find(detail => detail.targetId === insideFrame!.targetId);
    expect(frameDetail).toMatchObject({ kind: "frame", parentTargetId: first.targetRef.targetId, framePath: insideFrame!.framePath, origin: new URL(fixture.baseUrl).origin });
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
    expect((await adapter.execute(frameCandidate!, { runId: "adapter-test", timeoutMs: 2_000 })).status).toBe("target_lost");
  } finally {
    await context.close();
    await browser.close();
    await fixture.close();
  }
});

test("Playwright adapter scopes repeated controls and records every non-candidate as coverage debt", async () => {
  const fixture = await startFixture(() => ({ body: `<main>
    <div role="row" aria-labelledby="first-heading"><h2 id="first-heading">First item</h2><button onclick="this.parentElement.dataset.edited = 'yes'">Edit</button></div>
    <div role="row" aria-labelledby="second-heading"><h2 id="second-heading">Second item</h2><button onclick="this.parentElement.dataset.edited = 'yes'">Edit</button></div>
    <section><button>Delete</button><button>Delete</button></section>
    <button><svg aria-hidden="true"></svg></button>
  </main>` }));
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  const adapter = new PlaywrightAdaptiveAdapter({ page, context, scopeHosts: ["127.0.0.1"], settlePolicy: { maxWaitMs: 2_000, stableWindowMs: 20 } });
  try {
    await page.goto(fixture.baseUrl);
    const observation = await adapter.observe(adapter.primaryTarget(), { runId: "scope-debt-test", scopeHosts: ["127.0.0.1"] });
    const discovery = await adapter.discoverCandidates(observation);
    const edits = discovery.candidates.filter(candidate => candidate.locatorRecipe.strategy === "scoped-role" && candidate.locatorRecipe.name === "Edit");
    expect(edits).toHaveLength(2);
    expect(edits.map(candidate => candidate.locatorRecipe.scope)).toEqual(expect.arrayContaining([
      expect.objectContaining({ strategy: "role", value: "row", name: "First item", boundary: "row", keySource: "heading" }),
      expect.objectContaining({ strategy: "role", value: "row", name: "Second item", boundary: "row", keySource: "heading" }),
    ]));
    expect(discovery.coverageDebt).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "ambiguous-locator", role: "button", name: "Delete", matchedCount: 2, scope: "unavailable" }),
      expect.objectContaining({ reason: "missing-accessible-name", role: "button", scope: "unavailable" }),
    ]));
    expect(discovery.candidates).toHaveLength(2);
    expect(discovery.coverageDebt).toHaveLength(3);
    expect(discovery.candidates.length + discovery.coverageDebt.length).toBe(5);
    expect(await adapter.generateCandidates(observation)).toEqual(discovery.candidates);
    expect((await adapter.execute(edits[0]!, { runId: "scope-debt-test", timeoutMs: 2_000 })).status).toBe("executed");
    expect(await page.getByRole("row", { name: "First item", exact: true }).getAttribute("data-edited")).toBe("yes");

    await page.evaluate(() => document.querySelector("[role='row']")?.cloneNode(true) && document.querySelector("main")?.append(document.querySelector("[role='row']")!.cloneNode(true)));
    const changed = await adapter.observe(adapter.primaryTarget(), { runId: "scope-debt-test", scopeHosts: ["127.0.0.1"] });
    const staleScope = { ...edits[0]!, sourceFingerprint: fingerprintObservation(changed).value };
    expect((await adapter.execute(staleScope, { runId: "scope-debt-test", timeoutMs: 2_000 })).status).toBe("action_failed");
  } finally { await context.close(); await browser.close(); await fixture.close(); }
});
test("Playwright adapter integrates generic browser failures into Observation", async () => {
  const fixture = await startFixture(url => {
    if (url.pathname === "/") return { body: `<button data-testid="emit-errors" onclick="console.error('fixture-console'); setTimeout(() => { throw new Error('fixture-pageerror'); }, 0); fetch('/failure')">Emit</button><a data-testid="off-page" target="_blank" href="/off-page">Off page</a>` };
    if (url.pathname === "/off-page") return { body: `<script>setTimeout(() => { console.error('off-page-console'); throw new Error('off-page-error'); }, 0);</script>` };
    return undefined;
  });
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
    const offPageCandidate = (await adapter.generateCandidates(after)).find(value => value.locatorRecipe.value === "off-page");
    expect(offPageCandidate).toBeTruthy();
    const popupOpened = context.waitForEvent("page");
    await adapter.execute(offPageCandidate!, { runId: "event-test", timeoutMs: 2_000 });
    const offPage = await popupOpened;
    await offPage.waitForTimeout(50);
    const popupTarget = adapter.activeTargets().find(target => target.kind === "page" && target.targetId !== adapter.primaryTarget().targetId);
    expect(popupTarget).toBeTruthy();
    const afterOffPage = await adapter.observe(adapter.primaryTarget(), { runId: "event-test", scopeHosts: ["127.0.0.1"] });
    const offPageEvents = afterOffPage.ui.events as Array<Record<string, unknown>>;
    expect(offPageEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "console-error", targetId: popupTarget!.targetId }),
      expect.objectContaining({ kind: "pageerror", targetId: popupTarget!.targetId }),
    ]));
    expect(JSON.stringify(offPageEvents)).not.toContain("off-page-console");
    expect(JSON.stringify(offPageEvents)).not.toContain("off-page-error");
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


test("Playwright adapter enforces explicit JavaScript dialog policy fail-closed", async () => {
  const fixture = await startFixture(() => ({
    body: `<main>
      <output data-testid="result">idle</output>
      <button data-testid="confirm" onclick="const accepted = confirm('safe-confirm'); document.querySelector('[data-testid=result]').textContent = accepted ? 'accepted' : 'dismissed';">Confirm</button>
      <button data-testid="hold" onclick="const accepted = confirm('hold-confirm'); document.querySelector('[data-testid=result]').textContent = accepted ? 'accepted' : 'dismissed';">Hold</button>
    </main>`,
  }));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const adapter = new PlaywrightAdaptiveAdapter({
    page,
    context,
    scopeHosts: ["127.0.0.1"],
    settlePolicy: { maxWaitMs: 2_000, stableWindowMs: 20 },
  });
  try {
    await page.goto(fixture.baseUrl);
    const observe = () => adapter.observe(adapter.primaryTarget(), { runId: "dialog-policy-test", scopeHosts: ["127.0.0.1"] });
    const candidateFor = async (testId: string) => {
      const observation = await observe();
      return (await adapter.generateCandidates(observation)).find(candidate => candidate.locatorRecipe.value === testId);
    };

    const unauthorized = await candidateFor("confirm");
    expect(unauthorized).toBeTruthy();
    const unauthorizedAccept = {
      ...unauthorized!,
      contract: { dialog: { handling: "accept" as const } },
    };
    expect((await adapter.execute(unauthorizedAccept, { runId: "dialog-policy-test", timeoutMs: 100, allowedMutationKinds: ["none"] })).status).toBe("denied");
    expect(await page.getByTestId("result").textContent()).toBe("idle");

    const authorized = await candidateFor("confirm");
    expect(authorized).toBeTruthy();
    const explicitAccept = {
      ...authorized!,
      contract: { dialog: { handling: "accept" as const } },
    };
    const accepted = await adapter.execute(explicitAccept, {
      runId: "dialog-policy-test",
      timeoutMs: 2_000,
      allowedMutationKinds: ["update"],
    });
    expect(accepted.status).toBe("executed");
    expect(await page.getByTestId("result").textContent()).toBe("accepted");
    const acceptedObservation = await observe();
    expect(acceptedObservation.dialogs.at(-1)).toMatchObject({
      type: "confirm",
      disposition: "accepted",
      handlingPolicy: "explicit/v1",
      triggerActionId: explicitAccept.candidateId,
    });

    const holdCandidate = await candidateFor("hold");
    expect(holdCandidate).toBeTruthy();
    const held = {
      ...holdCandidate!,
      contract: { dialog: { handling: "hold" as const } },
    };
    const heldResult = await adapter.execute(held, { runId: "dialog-policy-test", timeoutMs: 50 });
    expect(heldResult.status).toBe("timeout");
    expect(heldResult.failureSignature).toBe("dialog_hold_timeout");
    expect(await page.getByTestId("result").textContent()).toBe("dismissed");
    const heldObservation = await observe();
    expect(heldObservation.dialogs.at(-1)).toMatchObject({
      type: "confirm",
      disposition: "held-timeout",
      handlingPolicy: "hold/v1",
      triggerActionId: held.candidateId,
    });
  } finally {
    await context.close();
    await browser.close();
    await fixture.close();
  }
});


test("Playwright adapter records active target switch, popup close, and opener return", async () => {
  const fixture = await startFixture(url => url.pathname === "/popup"
    ? { body: "<h1>Popup</h1><button data-testid='close' onclick='window.close()'>Close popup</button>" }
    : { body: "<h1>Home</h1><a data-testid='popup' target='_blank' href='/popup'>Open popup</a><button data-testid='home-action'>Home action</button>" });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const adapter = new PlaywrightAdaptiveAdapter({ page, context, scopeHosts: ["127.0.0.1"], settlePolicy: { maxWaitMs: 500, stableWindowMs: 20 } });
  try {
    await page.goto(fixture.baseUrl);
    const home = await adapter.observe(adapter.primaryTarget(), { runId: "target-topology-test", scopeHosts: ["127.0.0.1"] });
    const open = (await adapter.generateCandidates(home)).find(candidate => candidate.locatorRecipe.value === "popup");
    expect(open).toBeTruthy();
    const popupOpened = context.waitForEvent("page");
    expect((await adapter.execute(open!, { runId: "target-topology-test", timeoutMs: 500 })).status).toBe("executed");
    const popup = await popupOpened;
    await popup.waitForLoadState("domcontentloaded");
    const popupTarget = adapter.activeTargets().find(target => target.kind === "page" && target.targetId !== adapter.primaryTarget().targetId);
    expect(popupTarget).toBeTruthy();
    const popupObservation = await adapter.observe(popupTarget!, { runId: "target-topology-test", scopeHosts: ["127.0.0.1"] });
    expect(popupObservation.topology).toMatchObject({ activeTargetId: popupTarget!.targetId });
    const close = (await adapter.generateCandidates(popupObservation)).find(candidate => candidate.locatorRecipe.value === "close");
    expect(close).toBeTruthy();
    const closed = popup.waitForEvent("close");
    const closeResult = await adapter.execute(close!, { runId: "target-topology-test", timeoutMs: 500 });
    await closed;
    expect(closeResult.status).toBe("executed");
    expect(closeResult.targetChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKind: "target-switch", toTargetId: popupTarget!.targetId }),
      expect.objectContaining({ eventKind: "target-close", targetId: popupTarget!.targetId }),
      expect.objectContaining({ eventKind: "target-return", fromTargetId: popupTarget!.targetId, toTargetId: adapter.primaryTarget().targetId }),
    ]));
    expect(adapter.activeTargets().some(target => target.targetId === popupTarget!.targetId)).toBe(false);
    expect((await adapter.observe(adapter.primaryTarget(), { runId: "target-topology-test", scopeHosts: ["127.0.0.1"] })).topology).toMatchObject({
      activeTargetId: adapter.primaryTarget().targetId,
    });
  } finally {
    await context.close();
    await browser.close();
    await fixture.close();
  }
});
