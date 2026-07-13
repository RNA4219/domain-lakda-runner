import { createHash } from "node:crypto";

const secretRules: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*bearer\s+)[^\s,;"'}\]]+/gi, "$1[REDACTED]"],
  [/((?:token|api[_-]?key|secret|password|cookie)\s*[:=]\s*)[^\s,;"'}\]]+/gi, "$1[REDACTED]"],
];
const piiRules: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
  [/(?<![\dA-Fa-f])(?:\+\d{1,3}[ -]\d{2,4}(?:[ -]\d{2,4}){2,3}|0\d{1,3}[- ]\d{2,4}[- ]\d{2,4}|\d{3}[- ]\d{3}[- ]\d{4})(?![\dA-Fa-f-])/g, "[REDACTED_PHONE]"],
];

export type SensitiveFinding = "secret" | "pii";

export function findSensitive(value: string): SensitiveFinding[] {
  const scanValue = value.replace(/\[REDACTED(?:_EMAIL|_PHONE)?\]/g, "");
  const matches = (rules: Array<[RegExp, string]>): boolean => rules.some(([pattern]) => {
    pattern.lastIndex = 0;
    const found = pattern.test(scanValue);
    pattern.lastIndex = 0;
    return found;
  });
  const findings = new Set<SensitiveFinding>();
  if (matches(secretRules)) findings.add("secret");
  if (matches(piiRules)) findings.add("pii");
  return [...findings];
}

export function redact(value: string): string {
  return [...secretRules, ...piiRules].reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function redactJson(value: unknown): string {
  return redact(JSON.stringify(value));
}
