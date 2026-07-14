import { sha256 } from "../core/redaction.js";

export type InputField = { fieldId: string; type: string; required?: boolean; minLength?: number; maxLength?: number; options?: string[] };
export type GeneratedInput = { caseId: string; fieldId: string; category: "equivalence" | "boundary" | "abnormal"; value: string };
function rng(seed: number): () => number { let value = seed >>> 0; return () => { value = Math.imul(value ^ (value >>> 15), value | 1) + 0x6d2b79f5; return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296; }; }
function normal(field: InputField, random: () => number): string {
  if (field.options?.length) return field.options[Math.floor(random() * field.options.length)];
  if (field.type === "email") return `lakda-${Math.floor(random() * 10_000)}@example.test`;
  if (field.type === "number") return String(1 + Math.floor(random() * 99));
  if (field.type === "date") return "2026-01-15";
  return `lakda-${Math.floor(random() * 10_000)}`;
}
export function generateInputs(fields: InputField[], seed: number): GeneratedInput[] {
  const random = rng(seed); const values: GeneratedInput[] = [];
  for (const field of [...fields].sort((left, right) => left.fieldId.localeCompare(right.fieldId))) {
    const push = (category: GeneratedInput["category"], value: string) => values.push({ caseId: `input-${sha256(`${seed}:${field.fieldId}:${category}:${value}`).slice(0, 16)}`, fieldId: field.fieldId, category, value });
    push("equivalence", normal(field, random));
    if (field.minLength !== undefined) push("boundary", "x".repeat(field.minLength));
    if (field.maxLength !== undefined) push("boundary", "x".repeat(field.maxLength + 1));
    if (field.required) push("abnormal", "");
    if (field.type === "number") push("abnormal", "not-a-number");
    if (field.type === "email") push("abnormal", "invalid@example");
  }
  return values;
}

export type ReplayStep = { id: string; dependsOn?: string[] };
export async function shrinkFailure<T extends ReplayStep>(sequence: T[], reproduces: (candidate: T[]) => Promise<boolean>): Promise<T[]> {
  let current = [...sequence]; let chunk = Math.max(1, Math.floor(current.length / 2));
  while (chunk >= 1) {
    let reduced = false;
    for (let start = 0; start < current.length; start += chunk) {
      const removed = new Set(current.slice(start, start + chunk).map(step => step.id));
      const candidate = current.filter(step => !removed.has(step.id) && !(step.dependsOn ?? []).some(dependency => removed.has(dependency)));
      if (candidate.length && await reproduces(candidate)) { current = candidate; reduced = true; break; }
    }
    if (!reduced) chunk = Math.floor(chunk / 2);
  }
  return current;
}
