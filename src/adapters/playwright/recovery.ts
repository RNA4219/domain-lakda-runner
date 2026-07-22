import type { Page } from "playwright";
import type { TargetRef } from "../../adaptive/contracts.js";
import type { RecoverContext, RecoveryResult } from "../types.js";
import type { Target } from "./observation.js";

export async function recoverPlaywrightTarget(
  target: Target | undefined,
  targetKind: TargetRef["kind"] | undefined,
  context: RecoverContext,
  currentRef?: () => TargetRef,
): Promise<RecoveryResult> {
  try {
    if (context.strategy === "backtrack" && targetKind === "page") await (target as Page).goBack({ waitUntil: "domcontentloaded", timeout: 5_000 });
    else if (context.strategy === "reload" && targetKind === "page") await (target as Page).reload({ waitUntil: "domcontentloaded", timeout: 5_000 });
    else if (context.strategy !== "dismiss-dialog") return { recovered: false, strategy: context.strategy, evidenceRefs: [] };
    const targetRef = currentRef?.();
    return { recovered: true, strategy: context.strategy, ...(targetRef ? { targetRef } : {}), evidenceRefs: [] };
  } catch {
    const targetRef = currentRef?.();
    return { recovered: false, strategy: context.strategy, ...(targetRef ? { targetRef } : {}), evidenceRefs: [] };
  }
}
