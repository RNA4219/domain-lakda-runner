import { sha256 } from "../core/redaction.js";

export const INPUT_GENERATOR_VERSION = "lakda-input-generator/v1" as const;
export type InputCategory = "equivalence" | "boundary" | "boundary-outside" | "empty" | "null-equivalent" | "format-invalid" | "length-invalid";
export type InputField = {
  fieldId: string;
  type: string;
  domainRef?: string;
  required?: boolean;
  nullable?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  options?: string[];
};
export type GeneratedInput = {
  caseId: string;
  fieldId: string;
  category: InputCategory;
  value: string;
  generatorVersion: typeof INPUT_GENERATOR_VERSION;
  seed: number;
  domainRef: string;
  validity: "valid" | "invalid";
  expectedOracleRef: string;
};
export type RecordedInputCase = Omit<GeneratedInput, "value"> & { valueDigest: `sha256:${string}` };

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value ^ (value >>> 15), value | 1) + 0x6d2b79f5;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function normal(field: InputField, random: () => number): string {
  if (field.options?.length) return field.options[Math.floor(random() * field.options.length)];
  if (field.type === "email") return `lakda-${Math.floor(random() * 10_000)}@example.test`;
  if (field.type === "number" || field.type === "range") {
    const lower = field.minimum ?? 1;
    const upper = field.maximum ?? Math.max(lower, 99);
    return String(lower + Math.floor(random() * Math.max(1, upper - lower + 1)));
  }
  if (field.type === "date") return "2026-01-15";
  if (field.type === "select" || field.type === "select-one") return "1";
  return `lakda-${Math.floor(random() * 10_000)}`;
}

export function generateInputs(fields: InputField[], seed: number): GeneratedInput[] {
  const random = rng(seed);
  const values: GeneratedInput[] = [];
  for (const field of [...fields].sort((left, right) => left.fieldId.localeCompare(right.fieldId))) {
    const domainRef = field.domainRef ?? `field:${field.fieldId}`;
    const push = (category: InputCategory, value: string, validity: GeneratedInput["validity"]): void => {
      const expectedOracleRef = validity === "valid" ? "input-accepted-or-contract-pass" : "input-rejected-or-contract-failure";
      values.push({
        caseId: `input-${sha256(`${INPUT_GENERATOR_VERSION}:${seed}:${domainRef}:${field.fieldId}:${category}:${value}:${validity}`).slice(0, 16)}`,
        fieldId: field.fieldId,
        category,
        value,
        generatorVersion: INPUT_GENERATOR_VERSION,
        seed,
        domainRef,
        validity,
        expectedOracleRef,
      });
    };

    push("equivalence", normal(field, random), "valid");

    if (field.minLength !== undefined) push("boundary", "x".repeat(field.minLength), "valid");
    if (field.maxLength !== undefined) push("boundary", "x".repeat(field.maxLength), "valid");
    if (field.minimum !== undefined) push("boundary", String(field.minimum), "valid");
    if (field.maximum !== undefined) push("boundary", String(field.maximum), "valid");
    if (field.options?.length) {
      push("boundary", field.options[0], "valid");
      if (field.options.length > 1) push("boundary", field.options[field.options.length - 1], "valid");
    }

    if (field.minLength !== undefined && field.minLength > 0) push("boundary-outside", "x".repeat(field.minLength - 1), "invalid");
    if (field.maxLength !== undefined) push("boundary-outside", "x".repeat(field.maxLength + 1), "invalid");
    if (field.minimum !== undefined) push("boundary-outside", String(field.minimum - 1), "invalid");
    if (field.maximum !== undefined) push("boundary-outside", String(field.maximum + 1), "invalid");
    if (field.options?.length) push("boundary-outside", "__lakda_outside_domain__", "invalid");

    push("empty", "", field.required ? "invalid" : "valid");
    push("null-equivalent", "", field.nullable || !field.required ? "valid" : "invalid");

    if (field.type === "email") push("format-invalid", "lakda-invalid-format", "invalid");
    else if (field.type === "number" || field.type === "range") push("format-invalid", "not-a-number", "invalid");
    else if (field.type === "date") push("format-invalid", "not-a-date", "invalid");
    else if (field.pattern) push("format-invalid", "__lakda_pattern_mismatch__", "invalid");

    if (field.minLength !== undefined && field.minLength > 0) push("length-invalid", "x".repeat(field.minLength - 1), "invalid");
    if (field.maxLength !== undefined) push("length-invalid", "x".repeat(field.maxLength + 1), "invalid");
  }
  return values;
}

export function recordInputCase(input: GeneratedInput): RecordedInputCase {
  const { value, ...metadata } = input;
  return { ...metadata, valueDigest: `sha256:${sha256(value)}` };
}

export function matchesRecordedInputCase(recorded: RecordedInputCase, generated: GeneratedInput): boolean {
  return recorded.caseId === generated.caseId
    && recorded.fieldId === generated.fieldId
    && recorded.category === generated.category
    && recorded.generatorVersion === generated.generatorVersion
    && recorded.seed === generated.seed
    && recorded.domainRef === generated.domainRef
    && recorded.validity === generated.validity
    && recorded.expectedOracleRef === generated.expectedOracleRef
    && recorded.valueDigest === `sha256:${sha256(generated.value)}`;
}

export type ReplayStep = { id: string; dependsOn?: string[] };
export async function shrinkFailure<T extends ReplayStep>(sequence: T[], reproduces: (candidate: T[]) => Promise<boolean>): Promise<T[]> {
  let current = [...sequence];
  let chunk = Math.max(1, Math.floor(current.length / 2));
  while (chunk >= 1) {
    let reduced = false;
    for (let start = 0; start < current.length; start += chunk) {
      const removed = new Set(current.slice(start, start + chunk).map(step => step.id));
      const candidate = current.filter(step => !removed.has(step.id) && !(step.dependsOn ?? []).some(dependency => removed.has(dependency)));
      if (candidate.length && await reproduces(candidate)) {
        current = candidate;
        reduced = true;
        break;
      }
    }
    if (!reduced) chunk = Math.floor(chunk / 2);
  }
  return current;
}
