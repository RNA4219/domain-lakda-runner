import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "playwright";

export type StateSnapshot = { url: string; visible: string[]; overflow: boolean };
export type StateListener = { ids: string[]; receive(page: Page, snapshot: StateSnapshot): void; incomplete(): void };
type Controller = { refresh(): Promise<void>; flush(): Promise<void>; disable(): void };
type Manager = { name: string; ready: Promise<void>; listeners: Set<StateListener> };
const managers = new WeakMap<BrowserContext, Manager>();

// Runs in the target document. Initial DOM snapshots stay in a bounded local
// buffer until the binding supplies the public selector IDs. Only that filtered
// set crosses the binding; DOM text, attributes and private IDs never do.
export function installStateObserver(name: string): Promise<void> {
  const host = globalThis as unknown as Record<string, unknown>, key = name + "_controller";
  if (host[key]) return (host[key] as Controller).refresh();
  const binding = host[name] as (snapshot?: StateSnapshot) => Promise<unknown>;
  let enabled = true, allowed: Set<string> | undefined, queue: StateSnapshot[] = [], overflow = false;
  let configuration: Promise<void> = Promise.resolve();
  const pending = new Set<Promise<unknown>>();
  const send = (snapshot: StateSnapshot) => {
    if (!enabled || !allowed?.size) return;
    const filtered = { url: snapshot.url, visible: snapshot.visible.filter(id => allowed!.has(id)), overflow: snapshot.overflow || overflow };
    const promise = binding(filtered).catch(() => undefined).finally(() => pending.delete(promise)); pending.add(promise);
  };
  const capture = () => {
    if (!enabled) return;
    const visible = new Set<string>(), elements = document.querySelectorAll("[data-testid]");
    const limit = allowed ? 20_000 : 2_000;
    if (elements.length > 20_000) overflow = true;
    for (let n = 0; n < Math.min(elements.length, 20_000); n++) {
      const element = elements[n], id = element.getAttribute("data-testid")!;
      if (allowed && !allowed.has(id)) continue;
      const box = element.getBoundingClientRect(), visibility = getComputedStyle(element).visibility;
      if (box.width > 0 && box.height > 0 && visibility !== "hidden" && visibility !== "collapse") visible.add(id);
      if (visible.size >= limit) { overflow = true; break; }
    }
    const snapshot = { url: location.href, visible: [...visible], overflow };
    if (allowed) send(snapshot);
    else { if (queue.length >= 32) { queue.shift(); overflow = true; } queue.push(snapshot); }
  };
  const controller: Controller = {
    refresh() {
      enabled = true; allowed = undefined; capture();
      configuration = (async () => {
        const ids = await binding(); if (!enabled) return;
        allowed = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
        if (!allowed.size) { enabled = false; queue = []; return; }
        for (const snapshot of queue) send(snapshot); queue = []; capture();
      })().catch(() => { enabled = false; queue = []; });
      return configuration.then(() => Promise.all([...pending])).then(() => undefined);
    },
    async flush() { await configuration; capture(); await Promise.all([...pending]); },
    disable() { enabled = false; queue = []; },
  };
  host[key] = controller;
  const observer = new MutationObserver(capture); observer.observe(document, { subtree: true, childList: true, attributes: true });
  return controller.refresh();
}
export async function flushStateObserver(name: string) {
  const controller = (globalThis as unknown as Record<string, Controller | undefined>)[name + "_controller"];
  await controller?.flush();
}
export function disableStateObserver(name: string) {
  (globalThis as unknown as Record<string, Controller | undefined>)[name + "_controller"]?.disable();
}
export function stateManager(context: BrowserContext): Manager {
  const existing = managers.get(context); if (existing) return existing;
  const value: Manager = { name: "__lakda_surface_" + randomUUID().replaceAll("-", ""), ready: Promise.resolve(), listeners: new Set() };
  value.ready = (async () => {
    await context.exposeBinding(value.name, ({ page, frame }, input?: unknown) => {
      if (frame !== page.mainFrame()) return [];
      const ids = new Set([...value.listeners].flatMap(listener => listener.ids));
      if (input === undefined) return [...ids];
      const row = input as Partial<StateSnapshot> | null;
      if (!row || typeof row.url !== "string" || row.url.length > 8192 || !Array.isArray(row.visible) || row.visible.length > 20_000 ||
        row.visible.some(id => typeof id !== "string" || !ids.has(id)) || typeof row.overflow !== "boolean") {
        for (const listener of value.listeners) listener.incomplete(); return;
      }
      for (const listener of value.listeners) listener.receive(page, row as StateSnapshot);
    });
    await context.addInitScript(installStateObserver, value.name);
  })();
  managers.set(context, value); return value;
}
