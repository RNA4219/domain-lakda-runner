import { sha256 } from "../../core/redaction.js";

export function origin(value: string): string | undefined { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.origin : undefined; } catch { return undefined; } }
export function withinPathPrefixes(pathname: string, prefixes: readonly string[] | undefined): boolean {
  if (prefixes === undefined) return true;
  return prefixes.some(prefix => {
    const normalized = prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return normalized === "/" || pathname === normalized || pathname.startsWith(`${normalized}/`);
  });
}
export function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    const query = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)).map(([key, entry]) => `${encodeURIComponent(key)}=${sha256(entry).slice(0, 12)}`);
    return `${url.origin}${url.pathname}${query.length ? `?${query.join("&")}` : ""}`;
  } catch { return undefined; }
}

export type TargetTopologyEvent = {
  eventKind: "target-open" | "target-switch" | "target-close" | "target-return";
  targetId?: string;
  fromTargetId?: string;
  toTargetId?: string;
  parentTargetId?: string;
  reason: string;
};

export class TargetTopologyLog {
  private readonly events: TargetTopologyEvent[] = [];
  activeTargetId?: string;

  record(event: TargetTopologyEvent): void {
    this.events.push({ ...event });
    if (this.events.length > 100) this.events.splice(0, this.events.length - 100);
  }

  activate(targetId: string, reason: string): void {
    if (this.activeTargetId && this.activeTargetId !== targetId) {
      this.record({ eventKind: "target-switch", fromTargetId: this.activeTargetId, toTargetId: targetId, reason });
    }
    this.activeTargetId = targetId;
  }

  returnTo(fromTargetId: string, toTargetId: string, reason: string): void {
    this.activeTargetId = toTargetId;
    this.record({ eventKind: "target-return", fromTargetId, toTargetId, reason });
  }

  changes(): Array<Record<string, unknown>> {
    return this.events.slice(-50).map(event => ({ ...event }));
  }

  eventCount(): number { return this.events.length; }
}
