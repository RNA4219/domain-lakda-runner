import { findSensitive, redact, sha256 } from "../../core/redaction.js";
import type { ActionCandidate, LocatorRecipe, LocatorScope, MutationClassification, MutationKind, Observation } from "../../adaptive/contracts.js";
import type { Control } from "./observation.js";

const version = "lakda/adaptive-contracts/v1" as const;
export const allowedRoles = new Set(["button", "link", "textbox", "checkbox", "combobox", "option", "menuitem", "tab"]);
export const publicText = (value?: string): string | undefined => value ? redact(value.replace(/\s+/g, " ").trim().slice(0, 160)) : undefined;
export const publicLocator = (value?: string): value is string => Boolean(value && findSensitive(value).length === 0);
type ClassifiedMutation = { mutationKind: MutationKind; mutationClassification: MutationClassification };
const mutationKinds = new Set<MutationKind>(["none", "create", "update", "delete", "purchase", "publish", "external-message", "credential-change", "parameter-mutation", "skip", "reorder", "double-execution", "race", "unknown"]);
function methodMutation(method: string): MutationKind | undefined {
  if (["get", "head", "options"].includes(method)) return "none";
  if (["post", "put", "patch"].includes(method)) return "update";
  if (method === "delete") return "delete";
  return undefined;
}
function heuristicMutation(value: string, actionKind: Control["actionKind"]): MutationKind | undefined {
  if (actionKind !== "click") return "none";
  const text = value.toLowerCase();
  if (/(?:not\s+(?:save|submit|change|delete)|(?:save|submit|変更|保存)しない)/.test(text)) return undefined;
  if (/(delete|remove|destroy|削除)/.test(text)) return "delete";
  if (/(purchase|buy|checkout|order|payment|決済|購入|注文)/.test(text)) return "purchase";
  if (/(publish|post|公開|投稿)/.test(text)) return "publish";
  if (/(send|message|email|送信)/.test(text)) return "external-message";
  if (/(password|credential|認証情報|パスワード)/.test(text)) return "credential-change";
  if (/(search|filter|next|previous|back|open|view|detail|close|cancel|検索|絞り込み|次|前|戻る|表示|詳細|閉じる|キャンセル)/.test(text)) return "none";
  if (/(create|save|submit|update|登録|保存|更新|変更|作成|追加)/.test(text)) return "update";
  return undefined;
}
export function candidateScopes(control: Control): LocatorScope[] {
    const scopes: LocatorScope[] = [];
    const seen = new Set<string>();
    const add = (scope: LocatorScope) => {
      const key = `${scope.strategy}:${scope.value}:${scope.name ?? ""}`;
      if (!seen.has(key)) { seen.add(key); scopes.push(scope); }
    };
    for (const hint of control.scopeHints) if (hint.testId && publicLocator(hint.testId)) add({ strategy: "test-id", value: hint.testId, boundary: hint.boundary, keySource: "test-id" });
    for (const hint of control.scopeHints) if (hint.name && publicLocator(hint.name)) add({ strategy: "role", value: hint.role, name: hint.name, boundary: hint.boundary, keySource: "heading" });
    for (const hint of control.scopeHints) if (hint.identifierHash) add({ strategy: "stable-key", value: hint.identifierHash, boundary: hint.boundary, keySource: "identifier-hash" });
    return scopes;
  }

export function classifyMutation(control: Control, actionContracts: ReadonlyMap<string, MutationKind>): ClassifiedMutation {
    const actionId = control.actionId ? { actionId: control.actionId } : {};
    if (control.declaredMutationKind && !mutationKinds.has(control.declaredMutationKind as MutationKind)) {
      return { mutationKind: "unknown", mutationClassification: { source: "unknown", ruleId: "invalid-data-lakda-mutation-kind/v1", ...actionId } };
    }
    if (control.formMethod && !methodMutation(control.formMethod)) {
      return { mutationKind: "unknown", mutationClassification: { source: "unknown", ruleId: "unsupported-http-method/v1", ...actionId } };
    }
    const evidence: ClassifiedMutation[] = [];
    if (control.declaredMutationKind) evidence.push({ mutationKind: control.declaredMutationKind as MutationKind, mutationClassification: { source: "mechanical", ruleId: "data-lakda-mutation-kind/v1", ...actionId } });
    if (control.formMethod) evidence.push({ mutationKind: methodMutation(control.formMethod)!, mutationClassification: { source: "mechanical", ruleId: `http-method/${control.formMethod}/v1`, ...actionId } });
    const contracted = control.actionId ? actionContracts.get(control.actionId) : undefined;
    if (contracted) evidence.push({ mutationKind: contracted, mutationClassification: { source: "action-contract", ruleId: "action-contract/v1", ...actionId } });
    const inferred = heuristicMutation(control.hint, control.actionKind);
    if (inferred !== undefined) evidence.push({ mutationKind: inferred, mutationClassification: { source: "heuristic", ruleId: "label-heuristic/v1", ...actionId } });
    if (!evidence.length) return { mutationKind: "unknown", mutationClassification: { source: "unknown", ruleId: control.actionId ? "unmapped-action-id/v1" : "unclassified-control/v1", ...actionId } };
    if (new Set(evidence.map(value => value.mutationKind)).size > 1) return { mutationKind: "unknown", mutationClassification: { source: "conflict", ruleId: "mutation-classification-conflict/v1", ...actionId } };
    return evidence[0]!;
  }
export function createCandidate(adapterId: string, actionContracts: ReadonlyMap<string, MutationKind>, observation: Observation, control: Control, sourceFingerprint: string, recipe: LocatorRecipe): ActionCandidate {
    const inputProfileRef = control.actionKind === "fill" || control.actionKind === "select" ? `input-field:${control.fieldId}` : undefined;
    const scope = recipe.scope ? `${recipe.scope.strategy}:${recipe.scope.value}:${recipe.scope.name ?? ""}` : "";
    const framePath = observation.targetRef.framePath ? { framePath: [...observation.targetRef.framePath] } : {};
    const locatorRecipe = { ...recipe, ...framePath };
    const { mutationKind, mutationClassification } = classifyMutation(control, actionContracts);
    return {
      schemaVersion: version,
      candidateId: `pw-${sha256(`${observation.targetRef.targetId}:${control.actionKind}:${recipe.strategy}:${recipe.value}:${recipe.name ?? ""}:${scope}:${inputProfileRef ?? ""}`).slice(0, 20)}`,
      adapterId: adapterId,
      targetRef: observation.targetRef,
      sourceFingerprint,
      actionKind: control.actionKind,
      locatorRecipe,
      ...(inputProfileRef ? { inputProfileRef } : {}),
      generatedBy: { ruleId: recipe.strategy === "scoped-role" ? "visible-enabled-scoped-control/v1" : "visible-enabled-unique-control/v1", observationId: observation.observationId, reason: recipe.strategy === "scoped-role" ? "visible-enabled-scoped-control" : "visible-enabled-unique-control" },
      risk: { weight: mutationKind === "none" ? 1 : mutationKind === "update" ? 4 : 10, mutationCost: mutationKind === "none" ? 1 : 4 },
      mutationKind,
      mutationClassification,
    };
  }
