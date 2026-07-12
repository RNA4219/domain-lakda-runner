import { createHash } from "node:crypto";

const rules: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*bearer\s+)[^\s,;"'}\]]+/gi, "$1[REDACTED]"],
  [/((?:token|api[_-]?key|secret|password|cookie)\s*[:=]\s*)[^\s,;"'}\]]+/gi, "$1[REDACTED]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
  [/\b(?:\+?\d{1,3}[ -]?)?(?:\d{2,4}[ -]?){2,4}\d{2,4}\b/g, "[REDACTED_PHONE]"],
];

export function redact(value: string): string {
  return rules.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function redactJson(value: unknown): string {
  return redact(JSON.stringify(value));
}
