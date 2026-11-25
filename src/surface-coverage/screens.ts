import type { BrowserContext, Page } from "playwright";
import { matching, type Catalog, type Screen } from "./catalog.js";
import { stateManager, installStateObserver, flushStateObserver, disableStateObserver, type StateListener } from "./browser-states.js";

export class ScreenObservation {
  private stopped = false;
  private dom?: ReturnType<typeof stateManager>;
  private listener: StateListener;
  constructor(private context: BrowserContext, private catalog: Catalog, private record: (screen: Screen) => void, private incomplete: () => void) {
    this.listener = { ids: catalog.screens.flatMap(screen => screen.state ? [screen.state.testId] : []), incomplete, receive: (_page, snapshot) => {
      if (this.stopped) return;
      if (snapshot.overflow) this.incomplete();
      const visible = new Set(snapshot.visible), screens = matching(catalog.screens, snapshot.url).filter(screen => !screen.state || visible.has(screen.state.testId));
      if (screens.length === 1) this.record(screens[0]);
    } };
    if (this.listener.ids.length) { this.dom = stateManager(context); this.dom.listeners.add(this.listener); }
  }
  async ready() {
    if (this.dom) {
      await this.dom.ready;
      await Promise.all(this.context.pages().map(page => page.evaluate(installStateObserver, this.dom!.name).catch(() => this.incomplete())));
    }
  }
  async capture(page: Page): Promise<Screen | undefined> {
    if (this.stopped || page.isClosed()) return;
    const url = page.url(), candidates = matching(this.catalog.screens, url), visible: Screen[] = [];
    for (const candidate of candidates) if (!candidate.state || await page.locator('[data-testid=' + JSON.stringify(candidate.state.testId) + ']').isVisible().catch(() => false)) visible.push(candidate);
    if (visible.length !== 1 || page.url() !== url || this.stopped) return;
    this.record(visible[0]); return visible[0];
  }
  async checkpoint(page?: Page, maximumMs = 30_000) {
    await Promise.all((page ? [page] : this.context.pages()).map(async current => {
      if (current.isClosed()) return;
      if (this.dom) await current.evaluate(flushStateObserver, this.dom.name).catch(() => this.incomplete());
      const candidates = matching(this.catalog.screens, current.url());
      if (!candidates.length) return;
      const budget = Math.min(maximumMs, Math.max(...candidates.map(screen => screen.ready?.timeoutMs ?? (screen.state ? 5000 : 0))));
      const deadline = Date.now() + Math.max(0, budget);
      for (;;) {
        const screen = await this.capture(current);
        if (screen && (!screen.ready || await current.locator('[data-testid=' + JSON.stringify(screen.ready.testId) + ']').isVisible().catch(() => false))) break;
        if (!budget || Date.now() >= deadline || current.isClosed()) { this.incomplete(); break; }
        await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
      }
    }));
  }
  async finish() {
    this.stopped = true;
    if (this.dom) {
      this.dom.listeners.delete(this.listener);
      if (!this.dom.listeners.size) await Promise.all(this.context.pages().map(page => page.evaluate(disableStateObserver, this.dom!.name).catch(() => undefined)));
    }
  }
}
