import { isAbsolute } from "node:path";
import { canonicalJson } from "../core/plan.js";
import { findSensitive, redact } from "../core/redaction.js";
import { ReportInputError } from "./contracts.js";
import type { Classification } from "./types.js";

/** Only apply to explicitly selected display fields, never to whole input objects. */
export function cleanReportText(value: string): string {
  if (isAbsolute(value) || /^file:\/\//i.test(value) || /^[a-z]:[\\/]/i.test(value)) return "[PATH]";
  const cleaned = redact(value)
    .replace(/(?:(?:token|api[_-]?key|secret|password|cookie)\s*[:=]\s*|authorization\s*[:=]\s*bearer\s+)\[REDACTED\]/gi, "[REDACTED]")
    .replace(/\b[A-Za-z]:[\\/][^\s<>"']+/g, "[PATH]")
    .replace(/file:\/\/[^\s<>"']+/gi, "[PATH]")
    .replace(/(?<![\w:<])\/(?:home|Users|tmp|var|etc|opt|mnt|private|workspace)\/[^\s<>"']+/g, "[PATH]");
  if (findSensitive(cleaned).length) throw new ReportInputError("sensitive-projection", "レポート表示fieldの秘密値検査に失敗しました");
  return cleaned;
}

export function serializeReportData(value: unknown): string {
  return canonicalJson(value).replace(/[<>&\u2028\u2029]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function maximumClassification(values: Classification[]): Classification {
  const order: Classification[] = ["public", "internal", "confidential", "restricted"];
  let maximum = 0;
  for (const value of values) {
    const rank = order.indexOf(value);
    if (rank < 0) throw new ReportInputError("invalid-classification", "レポート入力の機密区分が不正です");
    maximum = Math.max(maximum, rank);
  }
  return order[maximum]!;
}
