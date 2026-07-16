import type { BrowserContext, Frame, Locator, Page } from "playwright";
import { findSensitive, redact, sha256 } from "../core/redaction.js";
import { fingerprintObservation } from "../adaptive/fingerprint.js";
import type { ActionCandidate, AdapterCapabilities, CandidateDiscoveryResult, CoverageDebt, DialogHandling, EvidenceArtifactRef, ExecutionResult, LocatorRecipe, LocatorScope, MutationKind, Observation, TargetRef } from "../adaptive/contracts.js";
import type { AdaptiveAdapter, AdapterFailure, EvidenceRequest, ExecuteContext, ObserveContext, RecoverContext, RecoveryResult } from "./types.js";

type Target = Page | Frame;
type Entry = { target: Target; ref: TargetRef; pageMetadata?: { openerTargetId?: string; triggerActionId?: string; initialUrl?: string } };
type ScopeHint = { boundary: LocatorScope["boundary"]; role: string; testId?: string; name?: string; keySource: LocatorScope["keySource"]; hasIdentifierKey: boolean };
type Control = { ordinal: number; actionKind: "click" | "fill" | "check" | "select"; role?: string; name?: string; testId?: string; fieldId?: string; href?: string; hint: string; disabled: boolean; scopeHints: ScopeHint[] };
type DisplayElement = { role: "heading" | "dialog" | "alert" | "status"; name: string; modal?: true; open?: boolean; level?: number };
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
type TargetTopologyEvent = {
  eventKind: "target-open" | "target-switch" | "target-close" | "target-return";
  targetId?: string;
  fromTargetId?: string;
  toTargetId?: string;
  parentTargetId?: string;
  reason: string;
};
type BrowserEvent = { eventId: string; kind: "console-error" | "pageerror" | "crash" | "request-failed" | "http-error" | "download"; targetId: string; messageRef?: string; url?: string; status?: number; method?: string };
type InputValueProvider = (candidate: ActionCandidate, context: ExecuteContext) => string | undefined | Promise<string | undefined>;
export type PlaywrightAdaptiveAdapterOptions = { page: Page; context?: BrowserContext; scopeHosts: string[]; adapterId?: string; inputValueProvider?: InputValueProvider; settlePolicy?: { maxWaitMs: number; stableWindowMs: number; policyVersion?: string } };

const version = "lakda/adaptive-contracts/v1" as const;
const policy = { maxWaitMs: 5_000, stableWindowMs: 200, policyVersion: "lakda-settle/v1" };
const allowedRoles = new Set(["button", "link", "textbox", "checkbox", "combobox", "option", "menuitem", "tab"]);
const publicText = (value?: string): string | undefined => value ? redact(value.replace(/\s+/g, " ").trim().slice(0, 160)) : undefined;
const publicLocator = (value?: string): value is string => Boolean(value && findSensitive(value).length === 0);
function origin(value: string): string | undefined { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.origin : undefined; } catch { return undefined; } }
function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    const query = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)).map(([key, entry]) => `${encodeURIComponent(key)}=${sha256(entry).slice(0, 12)}`);
    return `${url.origin}${url.pathname}${query.length ? `?${query.join("&")}` : ""}`;
  } catch { return undefined; }
}
function mutation(value: string, actionKind: Control["actionKind"]): MutationKind {
  if (actionKind !== "click") return "none";
  const text = value.toLowerCase();
  if (/(delete|remove|destroy|削除)/.test(text)) return "delete";
  if (/(purchase|buy|checkout|order|payment|決済|購入|注文)/.test(text)) return "purchase";
  if (/(publish|post|公開|投稿)/.test(text)) return "publish";
  if (/(send|message|email|送信)/.test(text)) return "external-message";
  if (/(password|credential|認証情報|パスワード)/.test(text)) return "credential-change";
  if (/(create|save|submit|confirm|update|登録|保存|更新|変更|作成|追加|確定)/.test(text) && !/(search|filter|next|previous|back|open|view|detail|検索|絞り込み|次|前|戻る|表示|詳細)/.test(text)) return "update";
  return "none";
}
function statusFor(error: unknown): ExecutionResult["status"] {
  const text = error instanceof Error ? error.message : "";
  if (/timeout/i.test(text)) return "timeout";
  if (/closed|detached|target.*(gone|lost)/i.test(text)) return "target_lost";
  if (/unsupported|input value provider/i.test(text)) return "unsupported";
  return "action_failed";
}
function resolveDialogPolicy(candidate: ActionCandidate, context: ExecuteContext): { policy: DialogHandling; deniedReason?: string } {
  const dialog = candidate.contract?.dialog;
  if (!dialog) return { policy: "dismiss" };
  const handling = (dialog as { handling?: unknown }).handling;
  if (handling !== "dismiss" && handling !== "hold" && handling !== "accept") return { policy: "dismiss", deniedReason: "dialog_policy_invalid" };
  if (handling === "accept" && !context.allowedMutationKinds?.includes(candidate.mutationKind)) {
    return { policy: "dismiss", deniedReason: "dialog_accept_not_authorized" };
  }
  return { policy: handling };
}
function scopeLocator(target: Target, scope: LocatorScope): Locator {
  if (scope.strategy === "test-id") return target.getByTestId(scope.value);
  return target.getByRole(scope.value as never, { name: scope.name, exact: true });
}
function locator(target: Target, recipe: LocatorRecipe): Locator {
  if (recipe.strategy === "test-id") return target.getByTestId(recipe.value);
  if (recipe.strategy === "role") return target.getByRole(recipe.value as never, { name: recipe.name, exact: true });
  if (recipe.strategy === "scoped-role") {
    if (!recipe.scope) throw new Error("scoped locator is missing scope");
    return scopeLocator(target, recipe.scope).getByRole(recipe.value as never, { name: recipe.name, exact: true });
  }
  if (recipe.strategy === "label") return target.getByLabel(recipe.value, { exact: true });
  if (recipe.strategy === "text") return target.getByText(recipe.value, { exact: true });
  throw new Error("unsupported locator recipe");
}
export class PlaywrightAdaptiveAdapter implements AdaptiveAdapter {
  readonly adapterId: string;
  private readonly targets = new Map<string, Entry>();
  private readonly ids = new WeakMap<object, string>();
  private readonly scopeHosts: Set<string>;
  private readonly input?: InputValueProvider;
  private readonly contextEvents: boolean;
  private readonly settle: Required<NonNullable<PlaywrightAdaptiveAdapterOptions["settlePolicy"]>>;
  private readonly dialogs: DialogEvent[] = [];
  private readonly network: Array<{ targetId: string; url: string; status: number; method: string }> = [];
  private readonly events: BrowserEvent[] = [];
  private readonly pendingPageTriggers = new Map<string, string>();
  private candidateInFlight?: ActionCandidate;
  private dialogInFlight?: DialogControl;
  private readonly topologyEvents: TargetTopologyEvent[] = [];
  private activeTargetId?: string;
  private pages = 0;
  private frames = 0;
  private dialogEvents = 0;
  private browserEvents = 0;

  constructor(options: PlaywrightAdaptiveAdapterOptions) {
    this.adapterId = options.adapterId ?? "playwright";
    this.scopeHosts = new Set(options.scopeHosts);
    this.input = options.inputValueProvider;
    this.contextEvents = Boolean(options.context);
    this.settle = { ...policy, ...options.settlePolicy };
    options.context?.on("console", message => {
      if (message.type() !== "error") return;
      const page = message.page(); const targetId = page ? this.registerPage(page).targetId : this.primaryTarget().targetId;
      this.recordBrowserEvent(targetId, "console-error", { messageRef: sha256(redact(message.text())) });
    });
    options.context?.on("weberror", webError => {
      const page = webError.page(); const targetId = page ? this.registerPage(page).targetId : this.primaryTarget().targetId; const error = webError.error();
      this.recordBrowserEvent(targetId, "pageerror", { messageRef: sha256(redact(`${error.name}:${error.message}`)) });
    });
    this.registerPage(options.page);
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
    this.activateTarget(entry.ref.targetId, reason);
    return this.ref(entry);
  }

  async closeTarget(targetRef: TargetRef, reason = "explicit-close"): Promise<{ closed: boolean; targetRef: TargetRef }> {
    const entry = this.entry(targetRef);
    if (entry.ref.kind !== "page") return { closed: false, targetRef: this.ref(entry) };
    await (entry.target as Page).close({ runBeforeUnload: false });
    this.recordTopologyEvent({ eventKind: "target-close", targetId: entry.ref.targetId, reason });
    return { closed: true, targetRef: this.ref(entry) };
  }

  private recordTopologyEvent(event: TargetTopologyEvent): void {
    this.topologyEvents.push({ ...event });
    if (this.topologyEvents.length > 100) this.topologyEvents.splice(0, this.topologyEvents.length - 100);
  }

  private activateTarget(targetId: string, reason: string): void {
    if (this.activeTargetId && this.activeTargetId !== targetId) {
      this.recordTopologyEvent({ eventKind: "target-switch", fromTargetId: this.activeTargetId, toTargetId: targetId, reason });
    }
    this.activeTargetId = targetId;
  }

  private topologyChanges(): Array<Record<string, unknown>> {
    return this.topologyEvents.slice(-50).map(event => ({ ...event }));
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
      return this.ref(entry);
    }
    const ref: TargetRef = { targetId: `page-${++this.pages}`, kind: "page", ...(parentTargetId ? { parentTargetId } : {}) };
    const initialUrl = safeUrl(page.url());
    this.ids.set(page, ref.targetId); this.targets.set(ref.targetId, { target: page, ref, pageMetadata: { ...(parentTargetId ? { openerTargetId: parentTargetId } : {}), ...(inferredTriggerActionId ? { triggerActionId: inferredTriggerActionId } : {}), ...(initialUrl ? { initialUrl } : {}) } });
    if (parentTargetId) this.recordTopologyEvent({ eventKind: "target-open", targetId: ref.targetId, parentTargetId, reason: "popup" });
    if (parentTargetId && inferredTriggerActionId) this.pendingPageTriggers.delete(parentTargetId);
    page.on("close", () => {
      const entry = this.targets.get(ref.targetId);
      if (!entry) return;
      entry.ref.lifecycle = "closed";
      this.recordTopologyEvent({ eventKind: "target-close", targetId: ref.targetId, reason: "page-closed" });
      const openerId = entry.pageMetadata?.openerTargetId;
      const returnId = (openerId && this.targets.get(openerId)?.ref.lifecycle !== "closed" && this.targets.get(openerId)?.ref.lifecycle !== "lost")
        ? openerId
        : [...this.targets.values()].find(value => value.ref.targetId !== ref.targetId && value.ref.kind === "page" && (value.ref.lifecycle ?? "active") === "active")?.ref.targetId;
      if (returnId) {
        this.activeTargetId = returnId;
        this.recordTopologyEvent({ eventKind: "target-return", fromTargetId: ref.targetId, toTargetId: returnId, reason: "closed-page-opener" });
      }
    });
    if (!this.contextEvents) {
      page.on("console", message => { if (message.type() === "error") this.recordBrowserEvent(ref.targetId, "console-error", { messageRef: sha256(redact(message.text())) }); });
      page.on("pageerror", error => this.recordBrowserEvent(ref.targetId, "pageerror", { messageRef: sha256(redact(`${error.name}:${error.message}`)) }));
    }
    page.on("crash", () => this.recordBrowserEvent(ref.targetId, "crash"));
    page.on("requestfailed", request => { const url = safeUrl(request.url()); this.recordBrowserEvent(ref.targetId, "request-failed", { ...(url ? { url } : {}), method: request.method(), ...(request.failure()?.errorText ? { messageRef: sha256(redact(request.failure()!.errorText)) } : {}) }); });
    page.on("download", download => { const url = safeUrl(download.url()); this.recordBrowserEvent(ref.targetId, "download", { ...(url ? { url } : {}), messageRef: sha256(redact(download.suggestedFilename())) }); });
    page.on("popup", popup => this.registerPage(popup, ref.targetId, this.candidateInFlight?.candidateId));
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) { const entry = this.targets.get(ref.targetId); const firstUrl = safeUrl(frame.url()); if (entry?.pageMetadata && firstUrl) entry.pageMetadata.initialUrl ??= firstUrl; } });
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
      if (settledUrl) try { allowScope = this.scopeHosts.has(new URL(settledUrl).hostname) ? "allowed" : "denied"; } catch { allowScope = "unknown"; }
      return { targetId: ref.targetId, kind: ref.kind, ...(ref.contextId ? { contextId: ref.contextId } : {}), ...(ref.parentTargetId ? { parentTargetId: ref.parentTargetId } : {}), ...(ref.framePath ? { framePath: [...ref.framePath] } : {}), ...(ref.origin ? { origin: ref.origin } : {}), ...(entry.pageMetadata?.openerTargetId ? { openerTargetId: entry.pageMetadata.openerTargetId } : {}), ...(entry.pageMetadata?.triggerActionId ? { triggerActionId: entry.pageMetadata.triggerActionId } : {}), ...(entry.pageMetadata?.initialUrl ? { initialUrl: entry.pageMetadata.initialUrl } : {}), ...(settledUrl ? { settledUrl } : {}), allowScope, active: ref.targetId === this.activeTargetId, lifecycle: ref.lifecycle };
    });
  }

  private entry(ref: TargetRef): Entry {
    const entry = this.targets.get(ref.targetId);
    if (!entry || this.ref(entry).lifecycle !== "active") throw new Error("target_lost");
    return entry;
  }

  private inScope(entry: Entry): boolean {
    try {
      const url = new URL(entry.target.url());
      return ["http:", "https:"].includes(url.protocol) && this.scopeHosts.has(url.hostname);
    } catch { return false; }
  }

  private async controls(target: Target): Promise<Control[]> {
    return target.evaluate(() => {
      const text = (element: Element | null): string => ((element as HTMLElement | null)?.innerText ?? element?.textContent ?? "").replace(/\s+/g, " ").trim();
      const role = (element: Element): string | undefined => {
        if (element.getAttribute("role")) return element.getAttribute("role")!;
        if (element instanceof HTMLButtonElement) return "button";
        if (element instanceof HTMLAnchorElement && element.href) return "link";
        if (element instanceof HTMLSelectElement) return "combobox";
        if (element instanceof HTMLTextAreaElement) return "textbox";
        if (element instanceof HTMLInputElement) { if (element.type === "checkbox") return "checkbox"; if (["button", "submit", "reset", "image"].includes(element.type)) return "button"; if (element.type !== "hidden") return "textbox"; }
        return (element as HTMLElement).isContentEditable ? "textbox" : undefined;
      };
      const name = (element: Element): string => {
        const aria = element.getAttribute("aria-label") ?? element.getAttribute("title"); if (aria) return aria.trim();
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) { const labels = [...element.labels ?? []].map(label => text(label)).filter(Boolean); if (labels.length) return labels.join(" "); if (element.getAttribute("placeholder")) return element.getAttribute("placeholder")!.trim(); }
        return text(element);
      };
      const action = (value: string): Control["actionKind"] | undefined => value === "checkbox" ? "check" : value === "combobox" ? "select" : value === "textbox" ? "fill" : ["button", "link", "menuitem", "tab", "option"].includes(value) ? "click" : undefined;
      const scopeHints = (element: Element): ScopeHint[] => {
        const result: ScopeHint[] = [];
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const explicit = parent.getAttribute("role");
          const boundary = explicit === "row" ? "row" : explicit === "listitem" ? "listitem" : explicit === "dialog" ? "dialog" : parent instanceof HTMLTableRowElement ? "row" : parent instanceof HTMLLIElement ? "listitem" : parent instanceof HTMLDialogElement ? "dialog" : parent.tagName.toLowerCase() === "article" || parent.getAttribute("data-lakda-scope") === "card" ? "card" : undefined;
          if (!boundary) continue;
          const scopeRole = boundary === "card" ? "article" : boundary;
          const heading = text(parent.querySelector("h1,h2,h3,h4,h5,h6,[role='heading']"));
          const accessible = (parent.getAttribute("aria-label") ?? parent.getAttribute("title") ?? "").trim();
          const testId = parent.getAttribute("data-testid")?.trim() || undefined;
          const scopeName = heading || accessible || undefined;
          result.push({ boundary, role: scopeRole, ...(testId ? { testId } : {}), ...(scopeName ? { name: scopeName } : {}), keySource: testId ? "test-id" : "heading", hasIdentifierKey: Boolean(parent.getAttribute("data-lakda-scope-key") || parent.getAttribute("data-row-key")) });
        }
        return result;
      };
      const query = "button,a[href],input,textarea,select,[role='button'],[role='link'],[role='textbox'],[role='checkbox'],[role='combobox'],[role='menuitem'],[role='tab']";
      return [...new Set([...document.querySelectorAll(query)])].flatMap((element, ordinal) => {
        const html = element as HTMLElement; const rect = html.getBoundingClientRect(); const style = getComputedStyle(html); const r = role(element); const a = r ? action(r) : undefined;
        if (!r || !a || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden" || html.hidden || element.getAttribute("aria-hidden") === "true") return [];
        const fieldId = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
          ? element.id || element.getAttribute("data-testid") || element.getAttribute("name") || (element.form ? `field-${[...element.form.elements].indexOf(element)}` : undefined)
          : undefined;
        const disabled = (element instanceof HTMLInputElement || element instanceof HTMLButtonElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && element.disabled || element.getAttribute("aria-disabled") === "true";
        return [{ ordinal, actionKind: a, role: r, name: name(element), testId: element.getAttribute("data-testid") ?? undefined, fieldId, href: element instanceof HTMLAnchorElement ? element.href : undefined, hint: `${name(element)} ${element.getAttribute("type") ?? ""}`, disabled, scopeHints: scopeHints(element) }];
      });
    });
  }
  private async displayElements(target: Target): Promise<DisplayElement[]> {
    return target.evaluate(() => {
      const selector = "h1,h2,h3,h4,h5,h6,dialog,[role='heading'],[role='dialog'],[role='alert'],[role='status']";
      return [...document.querySelectorAll(selector)].flatMap(element => {
        const html = element as HTMLElement; const rect = html.getBoundingClientRect(); const style = getComputedStyle(html);
        if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden" || html.hidden || element.getAttribute("aria-hidden") === "true") return [];
        const explicit = element.getAttribute("role");
        const tag = element.tagName.toLowerCase();
        const role = explicit === "heading" || explicit === "dialog" || explicit === "alert" || explicit === "status"
          ? explicit : /^h[1-6]$/.test(tag) ? "heading" : tag === "dialog" ? "dialog" : undefined;
        if (!role) return [];
        const name = (element.getAttribute("aria-label") ?? html.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
        const level = role === "heading" ? Number(element.getAttribute("aria-level") ?? (/^h[1-6]$/.test(tag) ? tag.slice(1) : "0")) : 0;
        return [{ role, name, ...(role === "dialog" ? { modal: true as const, open: true } : {}), ...(level > 0 ? { level } : {}) }];
      });
    });
  }

  private async forms(target: Target): Promise<Array<Record<string, unknown>>> {
    return target.evaluate(() => [...document.forms].map((form, index) => ({
      formId: form.id || `form-${index}`,
      fields: [...form.elements].flatMap((field, fieldIndex) => {
        if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return [];
        const minLength = "minLength" in field && field.minLength >= 0 ? field.minLength : undefined;
        const maxLength = "maxLength" in field && field.maxLength >= 0 ? field.maxLength : undefined;
        const minimum = field instanceof HTMLInputElement && field.min !== "" && Number.isFinite(Number(field.min)) ? Number(field.min) : undefined;
        const maximum = field instanceof HTMLInputElement && field.max !== "" && Number.isFinite(Number(field.max)) ? Number(field.max) : undefined;
        const pattern = field instanceof HTMLInputElement && field.pattern ? field.pattern : undefined;
        const sensitive = /password|secret|token|credential|authorization|cookie|ssn|credit[ -]?card|api[ -_]?key|@/i;
        const options = field instanceof HTMLSelectElement
          ? [...field.options]
            .filter(option => !option.disabled && !option.hidden && !option.parentElement?.hasAttribute("hidden") && option.value.trim() !== "" && !sensitive.test(`${option.value} ${option.label}`))
            .map(option => option.value.trim())
            .filter((value, optionIndex, values) => values.indexOf(value) === optionIndex)
            .sort((left, right) => left.localeCompare(right))
          : undefined;
        return [{
          fieldId: field.id || field.getAttribute("data-testid") || field.getAttribute("name") || `field-${fieldIndex}`,
          name: field.getAttribute("name") || undefined,
          type: field.getAttribute("type") || field.tagName.toLowerCase(),
          required: field.required,
          disabled: field.disabled,
          ...(minLength !== undefined ? { minLength } : {}),
          ...(maxLength !== undefined ? { maxLength } : {}),
          ...(minimum !== undefined ? { minimum } : {}),
          ...(maximum !== undefined ? { maximum } : {}),
          ...(pattern ? { pattern } : {}),
          ...(options?.length ? { options } : {}),
        }];
      }),
    })));
  }
  async observe(targetRef: TargetRef, context: ObserveContext): Promise<Observation> {
    const entry = this.entry(targetRef); const page = entry.ref.kind === "frame" ? (entry.target as Frame).page() : entry.target as Page;
    this.activateTarget(entry.ref.targetId, "observe");
    this.registerFrames(page); const url = safeUrl(entry.target.url()); const targets = this.activeTargets(); const events = this.events.slice(-50);
    const common = { schemaVersion: version, observationId: `obs-${sha256(`${context.runId}:${Date.now()}:${targetRef.targetId}`).slice(0, 16)}`, observedAt: new Date().toISOString(), targetRef: this.ref(entry), ...(url ? { url } : {}), ...(context.personaRef ? { personaRef: context.personaRef } : {}), dialogs: this.dialogs.slice(-20), topology: { activeTargetId: targetRef.targetId, targets, targetDetails: this.targetDetails(), targetCount: targets.length }, networkSummary: this.currentNetworkSummary(targetRef.contextId ?? targetRef.targetId, url), obligations: {}, provenance: { adapterId: this.adapterId, runtime: "playwright", capabilityRevision: "playwright-adapter/v1" } };
    const topology = { ...common.topology, activeTargetId: this.activeTargetId ?? targetRef.targetId, events: this.topologyChanges() };
    if (!this.inScope(entry)) return { ...common, topology, completeness: "partial", ui: { primaryElements: [], events }, forms: [] };
    const controls = await this.controls(entry.target);
    const displays = (await this.displayElements(entry.target)).slice(0, 100).map(display => ({ role: display.role, ...(publicText(display.name) ? { name: publicText(display.name) } : {}), ...(display.modal ? { modal: true, open: display.open } : {}), ...(display.level ? { level: display.level } : {}) }));
    const primaryElements = [...controls.slice(0, 100).map(control => ({ actionKind: control.actionKind, role: control.role, ...(publicText(control.name) ? { name: publicText(control.name) } : {}), ...(control.testId ? { testId: control.testId } : {}) })), ...displays];
    return { ...common, topology, completeness: "complete", ui: { primaryElements, domModals: displays.filter(display => display.role === "dialog"), events }, forms: await this.forms(entry.target) };
  }

  private scopeRecipes(control: Control): LocatorScope[] {
    const scopes: LocatorScope[] = [];
    const seen = new Set<string>();
    const add = (scope: LocatorScope) => {
      const key = `${scope.strategy}:${scope.value}:${scope.name ?? ""}`;
      if (!seen.has(key)) { seen.add(key); scopes.push(scope); }
    };
    for (const hint of control.scopeHints) if (hint.testId && publicLocator(hint.testId)) add({ strategy: "test-id", value: hint.testId, boundary: hint.boundary, keySource: "test-id" });
    for (const hint of control.scopeHints) if (hint.name && publicLocator(hint.name)) add({ strategy: "role", value: hint.role, name: hint.name, boundary: hint.boundary, keySource: "heading" });
    return scopes;
  }

  private candidate(observation: Observation, control: Control, sourceFingerprint: string, recipe: LocatorRecipe): ActionCandidate {
    const inputProfileRef = control.actionKind === "fill" || control.actionKind === "select" ? `input-field:${control.fieldId}` : undefined;
    const scope = recipe.scope ? `${recipe.scope.strategy}:${recipe.scope.value}:${recipe.scope.name ?? ""}` : "";
    const framePath = observation.targetRef.framePath ? { framePath: [...observation.targetRef.framePath] } : {};
    const locatorRecipe = { ...recipe, ...framePath };
    const mutationKind = mutation(control.hint, control.actionKind);
    return {
      schemaVersion: version,
      candidateId: `pw-${sha256(`${observation.targetRef.targetId}:${control.actionKind}:${recipe.strategy}:${recipe.value}:${recipe.name ?? ""}:${scope}:${inputProfileRef ?? ""}`).slice(0, 20)}`,
      adapterId: this.adapterId,
      targetRef: observation.targetRef,
      sourceFingerprint,
      actionKind: control.actionKind,
      locatorRecipe,
      ...(inputProfileRef ? { inputProfileRef } : {}),
      generatedBy: { ruleId: recipe.strategy === "scoped-role" ? "visible-enabled-scoped-control/v1" : "visible-enabled-unique-control/v1", observationId: observation.observationId, reason: recipe.strategy === "scoped-role" ? "visible-enabled-scoped-control" : "visible-enabled-unique-control" },
      risk: { weight: mutationKind === "none" ? 1 : mutationKind === "update" ? 4 : 10, mutationCost: mutationKind === "none" ? 1 : 4 },
      mutationKind,
    };
  }

  async discoverCandidates(observation: Observation): Promise<CandidateDiscoveryResult> {
    if (observation.provenance.adapterId !== this.adapterId || observation.completeness !== "complete") return { candidates: [], coverageDebt: [] };
    const target = this.entry(observation.targetRef).target;
    const controls = await this.controls(target);
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
      if (control.href) try { if (!this.scopeHosts.has(new URL(control.href).hostname)) { recordDebt(control, "out-of-scope-link", "not-applicable"); continue; } } catch { recordDebt(control, "out-of-scope-link", "not-applicable"); continue; }

      const testId = control.testId?.trim();
      if (testId && publicLocator(testId) && await target.getByTestId(testId).count() === 1) {
        candidates.push(this.candidate(observation, control, sourceFingerprint, { strategy: "test-id", value: testId }));
        continue;
      }
      const name = control.name?.trim();
      if (!name) { recordDebt(control, "missing-accessible-name", "unavailable"); continue; }
      if (!publicLocator(name)) { recordDebt(control, "sensitive-locator", "unavailable"); continue; }
      const role = control.role!;
      const global = target.getByRole(role as never, { name, exact: true });
      const globalCount = await global.count();
      if (globalCount === 1) {
        candidates.push(this.candidate(observation, control, sourceFingerprint, { strategy: "role", value: role, name }));
        continue;
      }

      let scopeState: CoverageDebt["scope"] = "unavailable";
      let resolved: LocatorRecipe | undefined;
      for (const scope of this.scopeRecipes(control)) {
        const parent = scopeLocator(target, scope);
        const parentCount = await parent.count();
        if (parentCount !== 1) { if (parentCount > 1) scopeState = "ambiguous"; continue; }
        scopeState = "resolved";
        if (await parent.getByRole(role as never, { name, exact: true }).count() === 1) {
          resolved = { strategy: "scoped-role", value: role, name, scope };
          break;
        }
      }
      if (resolved) candidates.push(this.candidate(observation, control, sourceFingerprint, resolved));
      else recordDebt(control, "ambiguous-locator", scopeState, globalCount);
    }
    return { candidates, coverageDebt };
  }

  async generateCandidates(observation: Observation): Promise<ActionCandidate[]> {
    return (await this.discoverCandidates(observation)).candidates;
  }
  private async waitSettled(target: Target): Promise<ExecutionResult["settleResult"]> {
    const beforeSnapshot = await target.evaluate(() => [location.href, document.querySelectorAll("button,a,input,select,textarea,[role]").length, document.body?.innerText.slice(0, 512) ?? ""].join("|"));
    const started = Date.now();
    let before = beforeSnapshot; let stable = started;
    while (Date.now() - started < this.settle.maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, Math.min(50, this.settle.stableWindowMs)));
      const after = await target.evaluate(() => [location.href, document.querySelectorAll("button,a,input,select,textarea,[role]").length, document.body?.innerText.slice(0, 512) ?? ""].join("|"));
      if (after !== before) { before = after; stable = Date.now(); } else if (Date.now() - stable >= this.settle.stableWindowMs) return { policyVersion: this.settle.policyVersion, status: "settled", elapsedMs: Date.now() - started, reasons: ["dom-stable"] };
    }
    return { policyVersion: this.settle.policyVersion, status: "timed_out", elapsedMs: Date.now() - started, reasons: ["settle-timeout"] };
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
      const targetLocator = locator(entry.target, candidate.locatorRecipe);
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
        : await this.waitSettled(entry.target);
      for (const [targetId, added] of this.targets) if (!targetsBefore.has(targetId) && added.pageMetadata) added.pageMetadata.triggerActionId ??= candidate.candidateId;
      const returnEntry = targetClosed && this.activeTargetId ? this.targets.get(this.activeTargetId) : undefined;
      const after = targetClosed
        ? returnEntry && this.ref(returnEntry).lifecycle === "active"
          ? await this.observe(this.ref(returnEntry), { runId: context.runId, scopeHosts: [...this.scopeHosts] })
          : undefined
        : await this.observe(candidate.targetRef, { runId: context.runId, scopeHosts: [...this.scopeHosts] });
      const postFingerprint = after ? fingerprintObservation(after).value : undefined;
      const dialogChange = dialogControl.event ? [{ ...dialogControl.event }] : [];
      const targetChanges = [...this.targetDetails(), ...this.topologyChanges(), ...dialogChange];
      if (dialogControl.outcome === "held-timeout") {
        return { ...base, preFingerprint, ...(postFingerprint ? { postFingerprint } : {}), endedAt: new Date().toISOString(), status: "timeout", failureSignature: "dialog_hold_timeout", recoveryStatus: "not_attempted", targetChanges, settleResult: { policyVersion: this.settle.policyVersion, status: "timed_out", elapsedMs: Date.now() - started, reasons: ["dialog-hold-timeout"] } };
      }
      return { ...base, preFingerprint, ...(postFingerprint ? { postFingerprint } : {}), endedAt: new Date().toISOString(), status: settleResult.status === "settled" ? "executed" : "timeout", recoveryStatus: "not_required", targetChanges, settleResult };
    } catch (error) {
      const status = statusFor(error);
      return { ...base, preFingerprint: candidate.sourceFingerprint, endedAt: new Date().toISOString(), status, failureSignature: error instanceof Error ? error.name : "adapter_error", recoveryStatus: "not_attempted", targetChanges: [...this.targetDetails(), ...this.topologyChanges()], settleResult: { policyVersion: this.settle.policyVersion, status: status === "target_lost" ? "target_lost" : "aborted", elapsedMs: Date.now() - started, reasons: [status] } };
    } finally {
      if (dialogControl?.timer) clearTimeout(dialogControl.timer);
      if (this.dialogInFlight === dialogControl) this.dialogInFlight = undefined;
      if (this.candidateInFlight?.candidateId === candidate.candidateId) this.candidateInFlight = undefined;
    }
  }

  async recover(failure: AdapterFailure, context: RecoverContext): Promise<RecoveryResult> {
    const target = this.targets.get((failure.targetRef ?? this.primaryTarget()).targetId);
    try {
      if (context.strategy === "backtrack" && target?.ref.kind === "page") await (target.target as Page).goBack({ waitUntil: "domcontentloaded", timeout: 5_000 });
      else if (context.strategy === "reload" && target?.ref.kind === "page") await (target.target as Page).reload({ waitUntil: "domcontentloaded", timeout: 5_000 });
      else if (context.strategy !== "dismiss-dialog") return { recovered: false, strategy: context.strategy, evidenceRefs: [] };
      return { recovered: true, strategy: context.strategy, ...(target ? { targetRef: this.ref(target) } : {}), evidenceRefs: [] };
    } catch { return { recovered: false, strategy: context.strategy, ...(target ? { targetRef: this.ref(target) } : {}), evidenceRefs: [] }; }
  }

  async captureEvidence(request: EvidenceRequest): Promise<EvidenceArtifactRef[]> { void request; return []; }
}
