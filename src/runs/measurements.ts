/** Measurements from verified metadata or normalized importer input. */
export const importedMode = "external-playwright";
export type RunBrowser = "chromium" | "external";

export function scenarioDurations(rows: unknown): (number | null)[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const ms: unknown = row?.duration_ms;
    return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= Number.MAX_SAFE_INTEGER ? ms : null;
  });
}

export function sumScenarioDurations(durations: readonly (number | null)[]): number | null {
  if (!durations.length) return null;
  let sum = 0;
  for (const ms of durations) {
    if (ms === null) return null;
    sum += ms;
  }
  return sum <= Number.MAX_SAFE_INTEGER ? sum : null;
}

export function elapsedDuration(start: string, end: string): number | null {
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function importedBrowser(metadata: Record<string, unknown>): RunBrowser {
  // A historical importer stamped every run with browser=chromium, including devices.
  const layer = (metadata.integration as { layer?: unknown } | null)?.layer;
  const rows = metadata.scenario_results;
  return layer === "browser" && Array.isArray(rows) && rows.length > 0 && rows.every(row => row?.browser === "chromium" && (row.layer === undefined || row.layer === "browser"))
    ? "chromium" : "external";
}
