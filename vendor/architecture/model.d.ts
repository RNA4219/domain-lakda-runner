export const SCHEMA: "aym.architecture/v1";
export const MAX_BYTES: number;
export function parseFile(text: string, filename: string): unknown;
export function validateMap(raw: unknown): {
  name: string;
  nodes: { id: string; name: string; kind: string; type: string; description: string }[];
  connections: { from: string; to: string; label: string; evidence: string }[];
  findings: { node: string; severity: string; title: string; evidence: string; action: string }[];
};
