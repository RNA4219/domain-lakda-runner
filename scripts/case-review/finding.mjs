export function caseValue(check, value) {
  if (value == null) return "取得できず";
  if (check.currency === "JPY") return value.toLocaleString("ja-JP") + "円";
  if (check.currency) return (value / 100).toLocaleString("ja-JP", { style: "currency", currency: check.currency });
  if (check.kind === "増減件数") return (value > 0 ? "+" : "") + value + "件";
  return check.kind === "一覧の件数" ? value + "件" : String(value);
}

// 概要とケース詳細は同じ回の操作・観測と、同じ版の受入条件を使う。
export function caseFinding(model, run, criteria, soleConditionFailed = false) {
  const stop = run.observations.find(o => o.result !== "passed");
  const soleFailure = !stop && soleConditionFailed && model.checks.length === 1;
  const check = stop ? model.checks[stop.index - 1] : soleFailure ? model.checks[0] : undefined;
  const action = check?.action
    ? run.actions.find(a => a.actionId === check.action && a.status === "completed")
    : run.actions.findLast(a => a.status === "completed");
  const name = action && (model.actionLabels[action.actionId] ?? action.actionId);
  const context = name === "結果行を押す" ? "結果行を押した後、" : name ? "「" + name + "」の後、" : "完了した操作を特定できず。";
  let condition = "未達条件を特定できず";
  if (check) {
    const subject = check.target ?? "";
    const excerpt = check.ref && model.checks.filter(c => c.ref === check.ref).length === 1 && criteria[model.ac.indexOf(check.ref)];
    if (check.kind === "表示状態" && subject) condition = subject + "の表示を確認できず";
    else if (excerpt) condition = "「" + excerpt + "」を確認できず";
    else condition = (subject ? subject + "の" : "") + check.kind + "の期待値「" + caseValue(check, check.expected) + "」を確認できず";
  }
  const end = run.actions.indexOf(action);
  const trail = end < 0 ? [] : run.actions.slice(Math.max(0, end - 1), end + 1).map(a => ({
    name: model.actionLabels[a.actionId] ?? a.actionId, offsetMs: a.offsetMs, status: a.status,
  }));
  return { context, condition, unmet: stop?.result === "failed" || soleFailure, trail, sequence: action?.sequence };
}
