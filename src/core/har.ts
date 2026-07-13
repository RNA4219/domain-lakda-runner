import { readFile } from "node:fs/promises";
import { writeText } from "./artifact-store.js";
import { findSensitive, redact } from "./redaction.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const sensitiveKey = /authorization|cookie|token|secret|password|api[-_]?key|set-cookie/i;

function sanitize(value: JsonValue, key = ""): JsonValue | undefined {
  const lower = key.toLowerCase();
  if (lower === "postdata" || lower === "text" || lower === "body" || lower === "cookies" || lower === "requestcookies" || lower === "responsecookies") return undefined;
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (lower === "url" && typeof value === "string") {
    try { const url = new URL(value); url.search = ""; url.hash = ""; return redact(url.toString()); }
    catch { return redact(value); }
  }
  if (lower === "querystring" && Array.isArray(value)) return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return sanitize(item);
    const name = typeof item.name === "string" ? item.name : "";
    return { name: redact(name), value: sensitiveKey.test(name) ? "[REDACTED]" : redact(typeof item.value === "string" ? item.value : "") };
  }).filter((item): item is JsonValue => item !== undefined);
  if (Array.isArray(value)) return value.map(item => sanitize(item)).filter((item): item is JsonValue => item !== undefined);
  if (value && typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const clean = sanitize(childValue, childKey);
      if (clean !== undefined) result[childKey] = clean;
    }
    return result;
  }
  return typeof value === "string" ? redact(value) : value;
}

export async function writeSanitizedHar(source: string, destination: string): Promise<void> {
  const raw = JSON.parse(await readFile(source, "utf8")) as JsonValue;
  const sanitized = sanitize(raw);
  const serialized = JSON.stringify(sanitized);
  if (findSensitive(serialized).length > 0) throw new Error("sanitized HARにsecret/PIIが残っています");
  await writeText(destination, serialized);
}
