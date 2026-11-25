import type { BrowserContext, CDPSession, Frame, Page, Request, Response } from "playwright";
import { check, digest, lane, match, relationId, scope, type Catalog, type Lane } from "./catalog.js";

export interface SurfaceRuntime { catalog: Catalog; testId: string; testRevision: string; lane: Lane }
export interface Observation { kind: "screens" | "apis" | "relations"; id: string; lane: Lane }
export interface Measurement {
  schema: "lakda/surface-observations/v1"; product: string; version: string; environment: string; revision: string;
  catalogDigest: string; scope: ReturnType<typeof scope>; runId: string; attempt: number; testId: string; testRevision: string;
  complete: boolean; observations: Observation[];
}
export function validateSurfaceRuntime(runtime: SurfaceRuntime) {
  check(runtime.catalog.schema === "lakda/surface-catalog/v1"); lane(runtime.lane);
  check(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(runtime.testId));
  check(typeof runtime.testRevision === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(runtime.testRevision));
}
/** No headers, bodies, query values or concrete URLs are retained in the measurement. */
export class SurfaceObserver {
  private entries = new Map<string, Observation>();
  private pending = new Set<Promise<void>>();
  private requests = new Map<Request, { api: string; screen?: string }>();
  private network = new Map<Page, Map<string, { key: string; start: number; cached: boolean; response: boolean }>>();
  private sessions: CDPSession[] = [];
  private attaching: Promise<void>[] = [];
  private complete = true;
  private stopped = false;
  constructor(private context: BrowserContext, private runtime: SurfaceRuntime) {
    validateSurfaceRuntime(runtime);
    context.on("page", this.page);
    for (const page of context.pages()) this.page(page);
    context.on("request", this.request);
    context.on("response", this.response);
    context.on("requestfailed", this.failed);
  }
  private add(kind: Observation["kind"], id: string, lane: Lane) {
    if (this.stopped) return;
    if (this.entries.size >= 20_000) { this.complete = false; return; }
    const row = { kind, id, lane }; this.entries.set(JSON.stringify(row), row);
  }
  private navigation = (frame: Frame) => {
    if (frame !== frame.page().mainFrame()) return;
    const screen = match(this.runtime.catalog.screens, frame.url());
    if (screen) this.add("screens", screen.id, this.runtime.lane === "mock" ? "mock" : "unknown");
  };
  private page = (page: Page) => {
    page.on("framenavigated", this.navigation);
    const records = new Map<string, { key: string; start: number; cached: boolean; response: boolean }>();
    this.network.set(page, records);
    // CDP is read-only. Never disable caches, routes or Service Workers to obtain coverage.
    const attaching = (async () => {
      const session = await this.context.newCDPSession(page); this.sessions.push(session);
      session.on("Network.requestWillBeSent", e => {
        if (records.size >= 20_000) return;
        const c = this.runtime.catalog;
        if (!match(c.apis.filter(p => p.method === e.request.method), e.request.url) && !match(c.screens, e.request.url)) return;
        records.set(e.requestId, { key: digest([e.request.method, e.request.url]), start: e.wallTime * 1000, cached: false, response: false });
      });
      session.on("Network.requestServedFromCache", e => { const r = records.get(e.requestId); if (r) r.cached = true; });
      session.on("Network.responseReceived", e => { const r = records.get(e.requestId); if (r) { r.response = true; r.cached ||= Boolean(e.response.fromDiskCache || e.response.fromPrefetchCache || e.response.fromServiceWorker); } });
      await session.send("Network.enable");
    })().catch(() => { /* Without cache provenance the classification remains unknown. */ });
    this.attaching.push(attaching);
  };
  async ready() { await Promise.all(this.attaching); }
  private networkProof(request: Request): boolean {
    // Worker upstream fetches lack an independently correlated page CDP record.
    // serverAddr alone can describe a cached response, so they must stay unknown.
    if (request.serviceWorker()) return false;
    try {
      const records = this.network.get(request.frame().page());
      const key = digest([request.method(), request.url()]), start = request.timing().startTime;
      const matches = [...(records?.values() ?? [])].filter(r => r.key === key && Math.abs(r.start - start) < 1);
      return matches.length === 1 && matches[0].response && !matches[0].cached;
    } catch { return false; }
  }
  private request = (request: Request) => {
    if (!["xhr", "fetch"].includes(request.resourceType())) return;
    const api = match(this.runtime.catalog.apis.filter(p => p.method === request.method()), request.url());
    if (!api) return;
    let screen: string | undefined;
    try { const frame = request.frame(); if (frame === frame.page().mainFrame()) screen = match(this.runtime.catalog.screens, frame.url())?.id; } catch { /* worker has no frame */ }
    if (this.requests.size >= 20_000) { this.complete = false; return; }
    this.requests.set(request, { api: api.id, screen });
  };
  private record(request: Request, classification: Lane) {
    const row = this.requests.get(request);
    if (!row) return;
    this.requests.delete(request);
    this.add("apis", row.api, classification);
    if (row.screen && this.runtime.catalog.relations.some(r => r.screen === row.screen && r.api === row.api)) {
      this.add("relations", relationId(row.screen, row.api), classification);
    }
  }
  private response = (response: Response) => {
    const job = (async () => {
      let classification: Lane = this.runtime.lane === "mock" ? "mock" : "unknown";
      if (this.runtime.lane === "real" && !response.fromServiceWorker() && await response.serverAddr() && this.networkProof(response.request())) classification = "real";
      const request = response.request();
      this.record(request, classification);
      // Document responses establish screen transport provenance; navigation alone stays unknown.
      if (request.isNavigationRequest()) {
        try {
          if (request.frame() === request.frame().page().mainFrame()) {
            const screen = match(this.runtime.catalog.screens, response.url());
            if (screen) this.add("screens", screen.id, classification);
          }
        } catch { /* detached frame */ }
      }
    })().catch(() => { this.complete = false; });
    this.pending.add(job); void job.finally(() => this.pending.delete(job));
  };
  private failed = (request: Request) => this.record(request, "unknown");
  async finish(runId: string, attempt: number, stopped: boolean): Promise<Measurement> {
    this.context.off("page", this.page).off("request", this.request).off("response", this.response).off("requestfailed", this.failed);
    for (const page of this.context.pages()) page.off("framenavigated", this.navigation);
    await Promise.all([...this.pending]);
    const pending = this.requests.size;
    for (const request of this.requests.keys()) this.record(request, "unknown");
    this.stopped = true;
    for (const session of this.sessions) await session.detach().catch(() => undefined);
    this.network.clear();
    const { catalog, testId, testRevision } = this.runtime;
    const publicScope = scope(catalog);
    return { schema: "lakda/surface-observations/v1", product: catalog.product, version: catalog.version, environment: catalog.environment, revision: catalog.revision,
      catalogDigest: digest(publicScope), scope: publicScope, runId, attempt, testId, testRevision,
      complete: this.complete && stopped && pending === 0, observations: [...this.entries.values()] };
  }
}
