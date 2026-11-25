import { resolve } from "node:path";
import { loadCatalog } from "../../dist/surface-coverage/catalog.js";
import { readSurfaceIndex, surfaceReport } from "../../dist/surface-coverage/report.js";
import { renderSurfaces } from "../../dist/surface-coverage/html.js";

export async function surfacePage(cfg, base, app, params) {
  const { product, suites } = app.catalog();
  const suiteId = params.get("suite") ?? cfg.suites.find(s => s.surfaceCatalog)?.id ?? suites[0]?.id;
  const registered = cfg.suites.find(s => s.id === suiteId), suite = suites.find(s => s.id === suiteId);
  const attempt = params.get("attempt");
  const empty = (status, message) => ({ status, html: '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>画面・API の到達状況</title><main><a href="/run">テストの概要に戻る</a><h1>画面・API の到達状況</h1><p>' + message + '</p></main></html>' });
  if (!suite || (attempt !== null && (!/^[1-9]\d*$/.test(attempt) || !Number.isSafeInteger(Number(attempt))))) return empty(404, "この実行回は見つかりません。");
  const ctx = app.coverageContext(suiteId, attempt === null ? null : Number(attempt));
  if (!ctx) return empty(404, "この実行回は見つかりません。");
  if (!registered.surfaceCatalog) return empty(200, "画面・API の分母は未登録です。suite の surfaceCatalog に所有者のカタログを登録してください。");
  try {
    const catalog = await loadCatalog(resolve(base, registered.surfaceCatalog));
    if (catalog.product !== product.productId || catalog.version !== product.revision || catalog.environment !== product.environment) throw Error();
    let tests = [];
    if (ctx.index) {
      if (ctx.index.executionOrigin !== "local" || ctx.index.localRunId !== suiteId || ctx.index.localRunAttempt !== ctx.number) throw Error();
      tests = await readSurfaceIndex(catalog, ctx.index, ctx.directory);
    }
    const report = surfaceReport(catalog, tests);
    return { status: 200, report, html: renderSurfaces(report, suite.name + (ctx.number ? " · 第" + ctx.number + "回" : " · 初回実行前") + (ctx.state === "running" ? " · 実行中" : ""),
      ctx.hasJob ? "/run?suite=" + encodeURIComponent(suiteId) + "&attempt=" + ctx.number : "/run") };
  } catch { return empty(422, "分母または同じ実行回の証跡を照合できません。登録した対象版・環境と観測記録を確認してください。"); }
}
