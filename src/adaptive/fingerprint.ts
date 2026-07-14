import type { Observation, StateFingerprint } from "./contracts.js";
import { sha256 } from "../core/redaction.js";

export const FINGERPRINT_ALGORITHM_VERSION = "lakda-state-sha256/v1";
export const FINGERPRINT_CANONICALIZATION_VERSION = "lakda-observation-canonical/v1";

const VOLATILE_KEYS = new Set([
  "observationId",
  "observedAt",
  "timestamp",
  "capturedAt",
  "receivedAt",
  "durationMs",
]);

function normalizedUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const parameters = [...parsed.searchParams.entries()]
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    const query = parameters.length === 0
      ? ""
      : `?${parameters.map(([key, entry]) => `${encodeURIComponent(key)}=${encodeURIComponent(entry)}`).join("&")}`;
    return `${parsed.origin}${parsed.pathname}${query}`;
  } catch {
    return value;
  }
}

function stableString(value: unknown): string {
  return JSON.stringify(value);
}

function canonicalizeValue(value: unknown, key?: string): unknown {
  if (key && VOLATILE_KEYS.has(key)) return undefined;
  if (typeof value === "string" && key === "url") return normalizedUrl(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => canonicalizeValue(entry))
      .sort((left, right) => stableString(left).localeCompare(stableString(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([entryKey]) => !VOLATILE_KEYS.has(entryKey))
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([entryKey, entryValue]) => {
          const canonical = canonicalizeValue(entryValue, entryKey);
          return canonical === undefined ? [] : [[entryKey, canonical]];
        }),
    );
  }
  return value;
}

/**
 * Adapter-managed runtime handles and observation timestamps are intentionally
 * excluded. The resulting value is stable for the same observable UI state.
 */
export function canonicalizeObservation(observation: Observation): string {
  return stableString(canonicalizeValue(observation));
}

function countObjectEntries(value: unknown): number {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).length
    : 0;
}

export function summarizeObservation(observation: Observation): StateFingerprint["componentSummary"] {
  const obligationValues = Object.values(observation.obligations);
  return {
    targetKind: observation.targetRef.kind,
    url: observation.url ? normalizedUrl(observation.url) : null,
    uiEntries: countObjectEntries(observation.ui),
    forms: observation.forms.length,
    dialogs: observation.dialogs.length,
    topologyEntries: countObjectEntries(observation.topology),
    networkEvents: observation.networkSummary?.length ?? 0,
    obligationsMet: obligationValues.filter((value) => value === "met").length,
    obligationsUnmet: obligationValues.filter((value) => value === "unmet").length,
  };
}

export function fingerprintObservation(observation: Observation): StateFingerprint {
  const canonical = canonicalizeObservation(observation);
  const observationDigest = sha256(canonical);
  return {
    schemaVersion: "lakda/adaptive-contracts/v1",
    algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
    canonicalizationVersion: FINGERPRINT_CANONICALIZATION_VERSION,
    value: `state:${observationDigest.slice(0, 24)}`,
    observationDigest,
    componentSummary: summarizeObservation(observation),
  };
}
