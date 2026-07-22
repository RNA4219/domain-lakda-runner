import type { BrowserContext, ConsoleMessage, Frame, Page } from "playwright";
import { redact, sha256 } from "../../core/redaction.js";
import { fingerprintObservation } from "../../adaptive/fingerprint.js";
import type { ActionCandidate, AdapterCapabilities, CandidateDiscoveryResult, CoverageDebt, DialogHandling, EvidenceArtifactRef, ExecutionResult, LocatorRecipe, MutationKind, Observation, ProductActionContract, SettlePolicy, TargetRef } from "../../adaptive/contracts.js";
import type { AdaptiveAdapter, AdapterFailure, EvidenceRequest, ExecuteContext, ObserveContext, RecoverContext, RecoveryResult } from "../types.js";
import { collectControls, collectDisplayElements, collectForms } from "./observation.js";
import type { Control, Target } from "./observation.js";
import { allowedRoles, candidateScopes, createCandidate, publicLocator, publicText } from "./candidates.js";
import { origin, safeUrl, TargetTopologyLog, withinPathPrefixes } from "./topology.js";
import { DEFAULT_SETTLE_POLICY, resolveDialogPolicy, scopeLocator, statusFor, locateTarget, waitForPlaywrightSettle } from "./execution.js";
import { recoverPlaywrightTarget } from "./recovery.js";

type Entry = { target: Target; ref: TargetRef; pageMetadata?: { openerTargetId?: string; triggerActionId?: string; initialUrl?: string } };
type DialogEvent = {
  eventKind: "js-dialog";
  targetRef: TargetRef;
  type: string;
  message?: string;
  disposition: "dismiss-pending" | "dismissed" | "accepted" | "held" | "held-timeout" | "failed";
  handlingPolicy: "default-deny/v1" | "explicit/v1" | "hold/v1";
  elapsedMs?: number;
  triggerActionId?: string;
};
type DialogControl = {
  candidateId: string;
  policy: DialogHandling;
  startedAt: number;
  timeoutMs: number;
  outcome?: "dismissed" | "accepted" | "held-timeout" | "failed";
  event?: DialogEvent;
  timer?: ReturnType<typeof setTimeout>;
};
type BrowserEvent = { eventId: string; kind: "console-error" | "pageerror" | "crash" | "request-failed" | "http-error" | "download"; targetId: string; messageRef?: string; url?: string; status?: number; method?: string };
type InputValueProvider = (candidate: ActionCandidate, context: ExecuteContext) => string | undefined | Promise<string | undefined>;
export type PlaywrightAdaptiveAdapterOptions = { page: Page; context?: BrowserContext; scopeHosts: string[]; scopePathPrefixes?: string[]; adapterId?: string; inputValueProvider?: InputValueProvider; actionContracts?: ProductActionContract[]; settlePolicy?: Partial<SettlePolicy> };

const version = "lakda/adaptive-contracts/v1" as const;
export class PlaywrightAdaptiveAdapter implements AdaptiveAdapter {
  readonly adapterId: string;
  private readonly targets = new Map<string, Entry>();
  private readonly ids = new WeakMap<object, string>();
  private readonly scopeHosts: Set<string>;
  private readonly scopePathPrefixes: readonly string[] | undefined;
  private readonly actionContracts = new Map<string, MutationKind>();
  private readonly input?: InputValueProvider;
  private readonly settle: SettlePolicy;
  private readonly dialogs: DialogEvent[] = [];
  private readonly network: Array<{ targetId: string; url: string; status: number; method: string }> = [];
  private readonly pendingNetwork = new Map<string, number>();
  private readonly networkChangedAt = new Map<string, number>();
  private readonly ignoredNetworkRequests = new WeakSet<object>();
  private readonly events: BrowserEvent[] = [];
  private readonly pendingConsoleEvents: Array<{ message: ConsoleMessage; messageRef: string; queuedAt: number; triggerActionId?: string; url: string }> = [];
  private readonly seenConsoleMessages = new WeakSet<object>();
  private readonly pendingPageTriggers = new Map<string, string>();
  private candidateInFlight?: ActionCandidate;
  private dialogInFlight?: DialogControl;
  private readonly topology = new TargetTopologyLog();
  private pages = 0;
  private frames = 0;
  private dialogEvents = 0;
  private browserEvents = 0;

  constructor(options: PlaywrightAdaptiveAdapterOptions) {
    this.adapterId = options.adapterId ?? "playwright";
    this.scopeHosts = new Set(options.scopeHosts);
    this.scopePathPrefixes = options.scopePathPrefixes;
    for (const contract of options.actionContracts ?? []) {
      if (!contract.actionId.trim() || this.actionContracts.has(contract.actionId)) throw new Error("actionContractsには一意なactionIdが必要です");
      this.actionContracts.set(contract.actionId, contract.mutationKind);
    }
    this.input = options.inputValueProvider;
    this.settle = { ...DEFAULT_SETTLE_POLICY, ...options.settlePolicy };
    this.registerPage(options.page);
    options.context?.on("console", message => this.captureContextConsole(message));
    options.context?.on("page", page => this.registerPage(page, undefined, this.candidateInFlight?.candidateId));
  }

  capabilities(): AdapterCapabilities {
    return { schemaVersion: version, adapterId: this.adapterId, revision: "playwright-adapter/v1", targetKinds: ["page", "frame", "dialog"], actionKinds: ["click", "fill", "check", "select"], observationCapabilities: ["dom", "url", "forms", "dialogs", "topology", "network"], evidenceCapabilities: ["screenshot", "trace", "network"], recoveryStrategies: ["backtrack", "reload", "dismiss-dialog"] };
  }

  primaryTarget(): TargetRef {
    const entry = [...this.targets.values()].find(value => value.ref.kind === "page");
    if (!entry) throw new Error("primary page target is unavailable");
    return this.ref(entry);
  }

  activeTargets(): TargetRef[] { return [...this.targets.values()].map(entry => this.ref(entry)).filter(ref => ref.lifecycle === "active"); }

  async switchTarget(targetRef: TargetRef, reason = "explicit"): Promise<TargetRef> {
    const entry = this.entry(targetRef);
    this.topology.activate(entry.ref.targetId, reason);
    return this.ref(entry);
  }

  async closeTarget(targetRef: TargetRef, reason = "explicit-close"): Promise<{ closed: boolean; targetRef: TargetRef }> {
    const entry = this.entry(targetRef);
    if (entry.ref.kind !== "page") return { closed: false, targetRef: this.ref(entry) };
    await (entry.target as Page).close({ runBeforeUnload: false });
    this.topology.record({ eventKind: "target-close", targetId: entry.ref.targetId, reason });
    return { closed: true, targetRef: this.ref(entry) };
  }

  private urlInScope(value: string): boolean {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && this.scopeHosts.has(url.hostname) && withinPathPrefixes(url.pathname, this.scopePathPrefixes);
    } catch { return false; }
  }
  private networkExcluded(requestUrl: string): boolean {
    try {
      const url = new URL(requestUrl);
      if (!this.scopeHosts.has(url.hostname)) return false;
      const exclusions = this.settle.networkQuietExclusions;
      return exclusions !== undefined && withinPathPrefixes(url.pathname, exclusions);
    } catch { return false; }
  }
  private networkStarted(targetId: string, request: { url(): string }): void {
    if (this.networkExcluded(request.url())) { this.ignoredNetworkRequests.add(request); return; }
    this.pendingNetwork.set(targetId, (this.pendingNetwork.get(targetId) ?? 0) + 1);
    this.networkChangedAt.set(targetId, Date.now());
  }
  private networkFinished(targetId: string, request: object): void {
    if (this.ignoredNetworkRequests.has(request)) return;
    this.pendingNetwork.set(targetId, Math.max(0, (this.pendingNetwork.get(targetId) ?? 1) - 1));
    this.networkChangedAt.set(targetId, Date.now());
  }
  private targetPageId(target: Target): string | undefined {
    const frame = target as Frame;
    return typeof frame.page === "function" ? this.ids.get(frame.page()) : this.ids.get(target as Page);
  }
  private recordConsoleMessage(targetId: string, message: ConsoleMessage): void {
    if (message.type() !== "error" || this.seenConsoleMessages.has(message)) return;
    const pendingIndex = this.pendingConsoleEvents.findIndex(event => event.message === message);
    if (pendingIndex >= 0) this.pendingConsoleEvents.splice(pendingIndex, 1);
    this.seenConsoleMessages.add(message);
    this.recordBrowserEvent(targetId, "console-error", { messageRef: sha256(redact(message.text())) });
  }
  private captureContextConsole(message: ConsoleMessage): void {
    if (
      message.type() !== "error"
      || this.seenConsoleMessages.has(message)
      || this.pendingConsoleEvents.some(event => event.message === message)
    ) return;
    const page = message.page();
    if (page) {
      this.recordConsoleMessage(this.registerPage(page).targetId, message);
      return;
    }
    const url = safeUrl(message.location().url);
    if (!url) return;
    this.pendingConsoleEvents.push({ message, messageRef: sha256(redact(message.text())), queuedAt: Date.now(), ...(this.candidateInFlight ? { triggerActionId: this.candidateInFlight.candidateId } : {}), url });
    if (this.pendingConsoleEvents.length > 100) this.pendingConsoleEvents.splice(0, this.pendingConsoleEvents.length - 100);
  }
  private flushPendingConsoleEvents(targetId: string, url: string, triggerActionId?: string): void {
    const now = Date.now();
    const maxAgeMs = Math.max(this.settle.maxWaitMs, 5_000);
    for (let index = this.pendingConsoleEvents.length - 1; index >= 0; index -= 1) {
      const event = this.pendingConsoleEvents[index]!;
      if (now - event.queuedAt > maxAgeMs) {
        this.pendingConsoleEvents.splice(index, 1);
        continue;
      }
      if (!triggerActionId || event.url !== url || event.triggerActionId !== triggerActionId) continue;
      this.pendingConsoleEvents.splice(index, 1);
      this.recordConsoleMessage(targetId, event.message);
    }
  }
  private recordBrowserEvent(targetId: string, kind: BrowserEvent["kind"], details: Omit<BrowserEvent, "eventId" | "kind" | "targetId"> = {}): void {
    this.events.push({ eventId: `browser-event-${++this.browserEvents}`, kind, targetId, ...details });
    if (this.events.length > 100) this.events.splice(0, this.events.length - 100);
  }

  private registerPage(page: Page, parentTargetId?: string, triggerActionId?: string): TargetRef {
    const inferredTriggerActionId = triggerActionId ?? (parentTargetId ? this.pendingPageTriggers.get(parentTargetId) : undefined);
    const known = this.ids.get(page);
    if (known) {
      const entry = this.targets.get(known)!;
      if (parentTargetId) { entry.ref.parentTargetId ??= parentTargetId; entry.pageMetadata ??= {}; entry.pageMetadata.openerTargetId ??= parentTargetId; }
      if (inferredTriggerActionId) { entry.pageMetadata ??= {}; entry.pageMetadata.triggerActionId ??= inferredTriggerActionId; }
      if (parentTargetId && inferredTriggerActionId) this.pendingPageTriggers.delete(parentTargetId);
      const currentUrl = safeUrl(page.url());
      if (currentUrl) this.flushPendingConsoleEvents(entry.ref.targetId, currentUrl, entry.pageMetadata?.triggerActionId);
      return this.ref(entry);
    }
    const ref: TargetRef = { targetId: `page-${++this.pages}`, kind: "page", ...(parentTargetId ? { parentTargetId } : {}) };
    const initialUrl = safeUrl(page.url());
    this.ids.set(page, ref.targetId); this.targets.set(ref.targetId, { target: page, ref, pageMetadata: { ...(parentTargetId ? { openerTargetId: parentTargetId } : {}), ...(inferredTriggerActionId ? { triggerActionId: inferredTriggerActionId } : {}), ...(initialUrl ? { initialUrl } : {}) } });
    if (initialUrl) this.flushPendingConsoleEvents(ref.targetId, initialUrl, inferredTriggerActionId);
    if (parentTargetId) this.topology.record({ eventKind: "target-open", targetId: ref.targetId, parentTargetId, reason: "popup" });
    if (parentTargetId && inferredTriggerActionId) this.pendingPageTriggers.delete(parentTargetId);
    page.on("close", () => {
      const entry = this.targets.get(ref.targetId);
      if (!entry) return;
      entry.ref.lifecycle = "closed";
      this.topology.record({ eventKind: "target-close", targetId: ref.targetId, reason: "page-closed" });
      const openerId = entry.pageMetadata?.openerTargetId;
      const returnId = (openerId && this.targets.get(openerId)?.ref.lifecycle !== "closed" && this.targets.get(openerId)?.ref.lifecycle !== "lost")
        ? openerId
        : [...this.targets.values()].find(value => value.ref.targetId !== ref.targetId && value.ref.kind === "page" && (value.ref.lifecycle ?? "active") === "active")?.ref.targetId;
      if (returnId) {
        this.topology.returnTo(ref.targetId, returnId, "closed-page-opener");
      }
    });
    page.on("console", message => this.recordConsoleMessage(ref.targetId, message));
    page.on("pageerror", error => this.recordBrowserEvent(ref.targetId, "pageerror", { messageRef: sha256(redact(`${error.name}:${error.message}`)) }));
    page.on("crash", () => this.recordBrowserEvent(ref.targetId, "crash"));
    page.on("request", request => this.networkStarted(ref.targetId, request));
    page.on("requestfinished", request => this.networkFinished(ref.targetId, request));
    page.on("requestfailed", request => { this.networkFinished(ref.targetId, request); const url = safeUrl(request.url()); this.recordBrowserEvent(ref.targetId, "request-failed", { ...(url ? { url } : {}), method: request.method(), ...(request.failure()?.errorText ? { messageRef: sha256(redact(request.failure()!.errorText)) } : {}) }); });
    page.on("download", download => { const url = safeUrl(download.url()); this.recordBrowserEvent(ref.targetId, "download", { ...(url ? { url } : {}), messageRef: sha256(redact(download.suggestedFilename())) }); });
    page.on("popup", popup => this.registerPage(popup, ref.targetId, this.candidateInFlight?.candidateId));
    page.on("framenavigated", frame => {
      if (frame !== page.mainFrame()) return;
      const entry = this.targets.get(ref.targetId);
      const firstUrl = safeUrl(frame.url());
      if (entry?.pageMetadata && firstUrl) entry.pageMetadata.initialUrl ??= firstUrl;
      if (firstUrl) this.flushPendingConsoleEvents(ref.targetId, firstUrl, entry?.pageMetadata?.triggerActionId);
    });
    page.on("dialog", dialog => {
      const targetRef: TargetRef = { targetId: "dialog-" + (++this.dialogEvents), kind: "dialog", parentTargetId: ref.targetId, lifecycle: "active" };
      const control = this.dialogInFlight && this.dialogInFlight.candidateId === this.candidateInFlight?.candidateId ? this.dialogInFlight : undefined;
      const policy = control?.policy ?? "dismiss";
      const message = publicText(dialog.message());
      const event: DialogEvent = {
        eventKind: "js-dialog",
        targetRef,
        type: dialog.type(),
        ...(message ? { message } : {}),
        disposition: policy === "hold" ? "held" : "dismiss-pending",
        handlingPolicy: policy === "accept" ? "explicit/v1" : policy === "hold" ? "hold/v1" : "default-deny/v1",
        ...(this.candidateInFlight ? { triggerActionId: this.candidateInFlight.candidateId } : {}),
      };
      if (control) control.event = event;
      this.dialogs.push(event); if (this.dialogs.length > 20) this.dialogs.splice(0, this.dialogs.length - 20);
      const close = (disposition: DialogEvent["disposition"], outcome: DialogControl["outcome"]) => {
        event.disposition = disposition;
        if (control) event.elapsedMs = Date.now() - control.startedAt;
        event.targetRef.lifecycle = disposition === "failed" ? "lost" : "closed";
        if (control) control.outcome = outcome;
      };
      if (policy === "accept") {
        void dialog.accept().then(() => close("accepted", "accepted")).catch(() => close("failed", "failed"));
      } else if (policy === "hold" && control) {
        control.timer = setTimeout(() => {
          void dialog.dismiss().then(() => close("held-timeout", "held-timeout")).catch(() => close("failed", "failed"));
        }, Math.max(1, control.timeoutMs));
      } else {
        void dialog.dismiss().then(() => close("dismissed", "dismissed")).catch(() => close("failed", "failed"));
      }
    });
    void page.opener().then(opener => { if (opener) this.registerPage(page, this.registerPage(opener).targetId); }).catch(() => undefined);
    page.on("response", response => {
      const url = safeUrl(response.url());
      if (!url) return;
      if (response.status() >= 500) this.recordBrowserEvent(ref.targetId, "http-error", { url, status: response.status(), method: response.request().method() });
      this.network.push({ targetId: ref.targetId, url, status: response.status(), method: response.request().method() });
      if (this.network.length > 200) this.network.splice(0, this.network.length - 200);
    });
    this.registerFrames(page);
    return this.ref(this.targets.get(ref.targetId)!);
  }

  private registerFrames(page: Page): void { for (const frame of page.frames()) if (frame !== page.mainFrame()) this.registerFrame(frame); }

  private registerFrame(frame: Frame): TargetRef {
    const known = this.ids.get(frame);
    if (known) return this.ref(this.targets.get(known)!);
    const pageRef = this.registerPage(frame.page());
    const parent = frame.parentFrame();
    const parentRef = parent && parent !== frame.page().mainFrame() ? this.registerFrame(parent) : pageRef;
    const ref: TargetRef = { targetId: `frame-${++this.frames}`, kind: "frame", contextId: pageRef.targetId, parentTargetId: parentRef.targetId, framePath: [...(parentRef.framePath ?? []), `frame-${this.frames}`] };
    this.ids.set(frame, ref.targetId); this.targets.set(ref.targetId, { target: frame, ref });
    return this.ref(this.targets.get(ref.targetId)!);
  }

  private ref(entry: Entry): TargetRef {
    let lifecycle = entry.ref.lifecycle ?? "active"; let url: string | undefined;
    try { url = entry.target.url(); } catch { lifecycle = "lost"; }
    if (entry.ref.kind === "frame" && (entry.target as Frame).isDetached()) lifecycle = "lost";
    return { ...entry.ref, ...(entry.ref.framePath ? { framePath: [...entry.ref.framePath] } : {}), ...(url && origin(url) ? { origin: origin(url) } : {}), lifecycle };
  }

  private currentNetworkSummary(targetId: string, currentUrl?: string): Array<Record<string, unknown>> {
    const unique = new Map<string, { targetId: string; url: string; status: number; method: string }>();
    for (const item of this.network) if (item.targetId === targetId && (!currentUrl || item.url === currentUrl)) unique.set(`${item.method}\u0000${item.url}\u0000${item.status}`, item);
    return [...unique.values()].slice(-50);
  }

  private targetDetails(): Array<Record<string, unknown>> {
    return [...this.targets.values()].map(entry => {
      const ref = this.ref(entry); let settledUrl: string | undefined; try { settledUrl = safeUrl(entry.target.url()); } catch { settledUrl = undefined; }
      let allowScope: "allowed" | "denied" | "unknown" = "unknown";
      if (settledUrl) allowScope = this.urlInScope(settledUrl) ? "allowed" : "denied";
      return { targetId: ref.targetId, kind: ref.kind, ...(ref.contextId ? { contextId: ref.contextId } : {}), ...(ref.parentTargetId ? { parentTargetId: ref.parentTargetId } : {}), ...(ref.framePath ? { framePath: [...ref.framePath] } : {}), ...(ref.origin ? { origin: ref.origin } : {}), ...(entry.pageMetadata?.openerTargetId ? { openerTargetId: entry.pageMetadata.openerTargetId } : {}), ...(entry.pageMetadata?.triggerActionId ? { triggerActionId: entry.pageMetadata.triggerActionId } : {}), ...(entry.pageMetadata?.initialUrl ? { initialUrl: entry.pageMetadata.initialUrl } : {}), ...(settledUrl ? { settledUrl } : {}), allowScope, active: ref.targetId === this.topology.activeTargetId, lifecycle: ref.lifecycle };
    });
  }

  private entry(ref: TargetRef): Entry {
    const entry = this.targets.get(ref.targetId);
    if (!entry || this.ref(entry).lifecycle !== "active") throw new Error("target_lost");
    return entry;
  }

  private inScope(entry: Entry): boolean {
    try { return this.urlInScope(entry.target.url()); } catch { return false; }
  }

  async observe(targetRef: TargetRef, context: ObserveContext): Promise<Observation> {
    const entry = this.entry(targetRef); const page = entry.ref.kind === "frame" ? (entry.target as Frame).page() : entry.target as Page;
    this.topology.activate(entry.ref.targetId, "observe");
    this.registerFrames(page); const url = safeUrl(entry.target.url()); const targets = this.activeTargets(); const events = this.events.slice(-50);
    const common = { schemaVersion: version, observationId: `obs-${sha256(`${context.runId}:${Date.now()}:${targetRef.targetId}`).slice(0, 16)}`, observedAt: new Date().toISOString(), targetRef: this.ref(entry), ...(url ? { url } : {}), ...(context.personaRef ? { personaRef: context.personaRef } : {}), dialogs: this.dialogs.slice(-20), topology: { activeTargetId: targetRef.targetId, targets, targetDetails: this.targetDetails(), targetCount: targets.length }, networkSummary: this.currentNetworkSummary(targetRef.contextId ?? targetRef.targetId, url), obligations: {}, provenance: { adapterId: this.adapterId, runtime: "playwright", capabilityRevision: "playwright-adapter/v1" } };
    const topology = { ...common.topology, activeTargetId: this.topology.activeTargetId ?? targetRef.targetId, events: this.topology.changes() };
    if (!this.inScope(entry)) return { ...common, topology, completeness: "partial", ui: { primaryElements: [], events }, forms: [] };
    const controls = await collectControls(entry.target);
    const displays = (await collectDisplayElements(entry.target)).slice(0, 100).map(display => ({ role: display.role, ...(publicText(display.name) ? { name: publicText(display.name) } : {}), ...(display.modal ? { modal: true, open: display.open } : {}), ...(display.level ? { level: display.level } : {}) }));
    const primaryElements = [...controls.slice(0, 100).map(control => ({ actionKind: control.actionKind, role: control.role, ...(publicText(control.name) ? { name: publicText(control.name) } : {}), ...(control.testId ? { testId: control.testId } : {}) })), ...displays];
    return { ...common, topology, completeness: "complete", ui: { primaryElements, domModals: displays.filter(display => display.role === "dialog"), events }, forms: await collectForms(entry.target) };
  }

  async discoverCandidates(observation: Observation): Promise<CandidateDiscoveryResult> {
    if (observation.provenance.adapterId !== this.adapterId || observation.completeness !== "complete") return { candidates: [], coverageDebt: [], classification: { observedControls: 0, classifiedControls: 0, unclassifiedControls: 0 } };
    const target = this.entry(observation.targetRef).target;
    const controls = await collectControls(target);
    const sourceFingerprint = fingerprintObservation(observation).value;
    const fieldIds = new Set(observation.forms.flatMap(form => Array.isArray(form.fields) ? form.fields.flatMap(field => field && typeof field === "object" && typeof (field as Record<string, unknown>).fieldId === "string" ? [(field as Record<string, string>).fieldId] : []) : []));
    const candidates: ActionCandidate[] = [];
    const coverageDebt: CoverageDebt[] = [];
    const recordDebt = (control: Control, reason: CoverageDebt["reason"], scope: CoverageDebt["scope"], matchedCount?: number) => {
      const name = control.name?.trim();
      const publicName = publicLocator(name) ? publicText(name) : undefined;
      coverageDebt.push({
        schemaVersion: "lakda-coverage-debt/v1",
        debtId: `debt-${sha256(`${sourceFingerprint}:${control.ordinal}:${reason}:${control.role ?? ""}:${name ?? ""}`).slice(0, 20)}`,
        reason,
        actionKind: control.actionKind,
        ...(control.actionId ? { actionId: control.actionId } : {}),
        ...(control.role ? { role: control.role } : {}),
        ...(publicName ? { name: publicName } : {}),
        ...(!publicName && name ? { nameDigest: `sha256:${sha256(name)}` } : {}),
        ...(matchedCount !== undefined ? { matchedCount } : {}),
        scope,
        targetFingerprint: sourceFingerprint,
      });
    };

    for (const control of controls) {
      if (control.disabled) { recordDebt(control, "disabled-control", "not-applicable"); continue; }
      if (!allowedRoles.has(control.role ?? "")) { recordDebt(control, "unsupported-control", "not-applicable"); continue; }
      if ((control.actionKind === "fill" || control.actionKind === "select") && (!control.fieldId || !fieldIds.has(control.fieldId))) { recordDebt(control, "missing-input-profile", "not-applicable"); continue; }
      if (control.href && !this.urlInScope(control.href)) { recordDebt(control, "out-of-scope-link", "not-applicable"); continue; }

      const testId = control.testId?.trim();
      if (testId && publicLocator(testId) && await target.getByTestId(testId).count() === 1) {
        candidates.push(createCandidate(this.adapterId, this.actionContracts, observation, control, sourceFingerprint, { strategy: "test-id", value: testId }));
        continue;
      }
      const name = control.name?.trim();
      if (!name) { recordDebt(control, "missing-accessible-name", "unavailable"); continue; }
      if (!publicLocator(name)) { recordDebt(control, "sensitive-locator", "unavailable"); continue; }
      const role = control.role!;
      const global = target.getByRole(role as never, { name, exact: true });
      const globalCount = await global.count();
      if (globalCount === 1) {
        candidates.push(createCandidate(this.adapterId, this.actionContracts, observation, control, sourceFingerprint, { strategy: "role", value: role, name }));
        continue;
      }

      let scopeState: CoverageDebt["scope"] = "unavailable";
      let resolved: LocatorRecipe | undefined;
      for (const scope of candidateScopes(control)) {
        const parent = scopeLocator(target, scope);
        const parentCount = await parent.count();
        if (parentCount !== 1) { if (parentCount > 1) scopeState = "ambiguous"; continue; }
        scopeState = "resolved";
        if (await parent.getByRole(role as never, { name, exact: true }).count() === 1) {
          resolved = { strategy: "scoped-role", value: role, name, scope };
          break;
        }
      }
      if (resolved) candidates.push(createCandidate(this.adapterId, this.actionContracts, observation, control, sourceFingerprint, resolved));
      else recordDebt(control, "ambiguous-locator", scopeState, globalCount);
    }
    const classifiedControls = candidates.length + coverageDebt.length;
    return { candidates, coverageDebt, classification: { observedControls: controls.length, classifiedControls, unclassifiedControls: Math.max(0, controls.length - classifiedControls) } };
  }

  async generateCandidates(observation: Observation): Promise<ActionCandidate[]> {
    return (await this.discoverCandidates(observation)).candidates;
  }
  async execute(candidate: ActionCandidate, context: ExecuteContext): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString(); const started = Date.now();
    const base = { schemaVersion: version, executionId: "exec-" + sha256(context.runId + ":" + candidate.candidateId + ":" + startedAt).slice(0, 16), candidateId: candidate.candidateId, startedAt, targetChanges: [] as Array<Record<string, unknown>>, evidenceRefs: [] as EvidenceArtifactRef[] };
    let dialogControl: DialogControl | undefined;
    try {
      if (candidate.adapterId !== this.adapterId) throw new Error("unsupported adapter candidate");
      const before = await this.observe(candidate.targetRef, { runId: context.runId, ...(context.personaRef ? { personaRef: context.personaRef } : {}), scopeHosts: [...this.scopeHosts] });
      const preFingerprint = fingerprintObservation(before).value;
      if (before.completeness !== "complete") return { ...base, preFingerprint, endedAt: new Date().toISOString(), status: "denied", failureSignature: "target_out_of_scope", recoveryStatus: "not_required", settleResult: { policyVersion: this.settle.policyVersion, status: "aborted", elapsedMs: Date.now() - started, reasons: ["observation-not-complete"] } };
      if (preFingerprint !== candidate.sourceFingerprint) return { ...base, preFingerprint, endedAt: new Date().toISOString(), status: "denied", failureSignature: "stale_candidate", recoveryStatus: "not_required", settleResult: { policyVersion: this.settle.policyVersion, status: "aborted", elapsedMs: Date.now() - started, reasons: ["source-fingerprint-mismatch"] } };
      const dialogDecision = resolveDialogPolicy(candidate, context);
      if (dialogDecision.deniedReason) return { ...base, preFingerprint, endedAt: new Date().toISOString(), status: "denied", failureSignature: dialogDecision.deniedReason, recoveryStatus: "not_required", settleResult: { policyVersion: this.settle.policyVersion, status: "aborted", elapsedMs: Date.now() - started, reasons: [dialogDecision.deniedReason] } };
      const entry = this.entry(candidate.targetRef);
      if (candidate.locatorRecipe.strategy === "scoped-role") {
        if (!candidate.locatorRecipe.scope || await scopeLocator(entry.target, candidate.locatorRecipe.scope).count() !== 1) throw new Error("scope is no longer unique");
      }
      const targetLocator = locateTarget(entry.target, candidate.locatorRecipe);
      const actionTimeout = context.timeoutMs + Math.max(this.settle.maxWaitMs, 1_000);
      if (await targetLocator.count() !== 1) throw new Error("locator is no longer unique");
      const targetsBefore = new Set(this.targets.keys());
      if (candidate.actionKind === "click") {
        const openerTargetId = entry.ref.kind === "frame" ? entry.ref.contextId : entry.ref.targetId;
        if (openerTargetId) this.pendingPageTriggers.set(openerTargetId, candidate.candidateId);
      }
      dialogControl = { candidateId: candidate.candidateId, policy: dialogDecision.policy, startedAt: Date.now(), timeoutMs: context.timeoutMs };
      this.dialogInFlight = dialogControl;
      this.candidateInFlight = candidate;
      if (candidate.actionKind === "click") await targetLocator.click({ timeout: actionTimeout });
      else if (candidate.actionKind === "check") await targetLocator.check({ timeout: actionTimeout });
      else if (candidate.actionKind === "fill" || candidate.actionKind === "select") {
        const value = await this.input?.(candidate, context);
        if (value === undefined) throw new Error("input value provider is unavailable");
        if (candidate.actionKind === "fill") await targetLocator.fill(value, { timeout: actionTimeout });
        else await targetLocator.selectOption(value, { timeout: actionTimeout });
      } else throw new Error("unsupported action kind");
      const targetClosed = this.ref(entry).lifecycle !== "active";
      const settleResult = targetClosed
        ? { policyVersion: this.settle.policyVersion, status: "settled" as const, elapsedMs: Date.now() - started, reasons: ["target-closed"] }
        : await waitForPlaywrightSettle(entry.target, this.settle, {
          targetPageId: target => this.targetPageId(target),
          topologyEventCount: () => this.topology.eventCount(),
          pendingNetwork: targetId => this.pendingNetwork.get(targetId) ?? 0,
          networkChangedAt: targetId => this.networkChangedAt.get(targetId),
        });
      for (const [targetId, added] of this.targets) if (!targetsBefore.has(targetId) && added.pageMetadata) added.pageMetadata.triggerActionId ??= candidate.candidateId;
      const returnEntry = targetClosed && this.topology.activeTargetId ? this.targets.get(this.topology.activeTargetId) : undefined;
      const after = targetClosed
        ? returnEntry && this.ref(returnEntry).lifecycle === "active"
          ? await this.observe(this.ref(returnEntry), { runId: context.runId, scopeHosts: [...this.scopeHosts] })
          : undefined
        : await this.observe(candidate.targetRef, { runId: context.runId, scopeHosts: [...this.scopeHosts] });
      const postFingerprint = after ? fingerprintObservation(after).value : undefined;
      const dialogChange = dialogControl.event ? [{ ...dialogControl.event }] : [];
      const targetChanges = [...this.targetDetails(), ...this.topology.changes(), ...dialogChange];
      if (dialogControl.outcome === "held-timeout") {
        return { ...base, preFingerprint, ...(postFingerprint ? { postFingerprint } : {}), endedAt: new Date().toISOString(), status: "timeout", failureSignature: "dialog_hold_timeout", recoveryStatus: "not_attempted", targetChanges, settleResult: { policyVersion: this.settle.policyVersion, status: "timed_out", elapsedMs: Date.now() - started, reasons: ["dialog-hold-timeout"] } };
      }
      return { ...base, preFingerprint, ...(postFingerprint ? { postFingerprint } : {}), endedAt: new Date().toISOString(), status: settleResult.status === "settled" ? "executed" : "timeout", recoveryStatus: "not_required", targetChanges, settleResult };
    } catch (error) {
      const status = statusFor(error);
      return { ...base, preFingerprint: candidate.sourceFingerprint, endedAt: new Date().toISOString(), status, failureSignature: error instanceof Error ? error.name : "adapter_error", recoveryStatus: "not_attempted", targetChanges: [...this.targetDetails(), ...this.topology.changes()], settleResult: { policyVersion: this.settle.policyVersion, status: status === "target_lost" ? "target_lost" : "aborted", elapsedMs: Date.now() - started, reasons: [status] } };
    } finally {
      if (dialogControl?.timer) clearTimeout(dialogControl.timer);
      if (this.dialogInFlight === dialogControl) this.dialogInFlight = undefined;
      if (this.candidateInFlight?.candidateId === candidate.candidateId) this.candidateInFlight = undefined;
    }
  }

  async recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult> {
    const target = this.targets.get((failure.targetRef ?? this.primaryTarget()).targetId);
    return recoverPlaywrightTarget(target?.target, target?.ref.kind, context, target ? () => this.ref(target) : undefined);
  }
  async captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]> { void request; return []; }
}
