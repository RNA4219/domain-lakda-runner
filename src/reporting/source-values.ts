import type { ManifestSnapshot } from "../runs/manifest-snapshot.js";
import { ReportInputError } from "./contracts.js";

export function snapshotText(snapshot: ManifestSnapshot, ref: string): string {
  const bytes = snapshot.snapshots.get(ref)?.bytes;
  if (!bytes) throw new ReportInputError("source-incomplete", "必須の保存記録がHATE manifestにありません");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ReportInputError("invalid-text", "保存記録が有効なUTF-8ではありません"); }
}

export function snapshotJson(snapshot: ManifestSnapshot, ref: string): unknown {
  const text = snapshotText(snapshot, ref);
  try { return JSON.parse(text); }
  catch { throw new ReportInputError("invalid-json", "保存記録が有効なJSONではありません"); }
}

export function snapshotLines(snapshot: ManifestSnapshot, ref: string, limit: number): string[] {
  const lines = snapshotText(snapshot, ref).split(/\r?\n/).filter(Boolean);
  if (lines.length > limit) throw new ReportInputError("record-limit", "保存記録の件数上限を超えています");
  return lines;
}

export function reportTimestamp(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  const year = Number(parts?.[1]);
  const month = Number(parts?.[2]);
  const day = Number(parts?.[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  if (!parts || day < 1 || day > days || !Number.isFinite(Date.parse(value))) {
    throw new ReportInputError("invalid-timestamp", "保存記録の日時が有効なISO日時ではありません");
  }
  return new Date(value).toISOString();
}
