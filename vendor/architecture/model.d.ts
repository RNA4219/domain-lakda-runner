export const SCHEMA: "aym.architecture/v1";
export const MAX_BYTES: number;
export interface ArchitectureNode { id:string; name:string; kind:string; type:string; description:string; role?:string; repository?:string }
export interface ArchitectureEdge { from:string; to:string; label:string; evidence:string; observe?:"screen-api" }
export interface ArchitectureFlow { id:string; name:string; steps:{node:string; via?:string}[] }
export function readFlowDefinition(raw:unknown,nodes:ArchitectureNode[],connections:ArchitectureEdge[]): {flows:ArchitectureFlow[]};
export function parseFile(text: string, filename: string): unknown;
export function validateMap(raw: unknown): {
  name: string;
  nodes: ArchitectureNode[];
  connections: ArchitectureEdge[];
  flows: ArchitectureFlow[];
  findings: { node: string; severity: string; title: string; evidence: string; action: string }[];
};
