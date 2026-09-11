import { serializeReportData } from "./projection-values.js";
import type { ReportView } from "./types.js";

export const REPORT_FILES = { html: "index.html", data: "report-data.json", manifest: "report-manifest.json", css: "report.css", js: "report.js" } as const;

/** Interpolate only fixed localized markup and canonical, escaped, inert JSON. */
export function renderReportDocument(view: ReportView): string {
  const english = view.language === "en";
  const title = english ? "Lakda Execution Report" : "Lakda 実行レポート";
  return `<!doctype html>
<html lang="${english ? "en" : "ja"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${title}</title><link rel="stylesheet" href="report.css">
<script src="report.js" defer></script></head><body>
<header><h1>${title}</h1><p>${english ? "This report records input verification at generation time. Check acceptance decisions separately." : "生成時の入力検証を記録したレポートです。受入判定は別途確認してください。"}</p></header>
<main id="report"><p role="status">${english ? "Preparing the report." : "表示を準備しています。"}</p></main>
<noscript>${english ? "JavaScript is required to display this report. You can also inspect the saved report-data.json." : "表示にはJavaScriptが必要です。保存されたreport-data.jsonでも内容を確認できます。"}</noscript>
<script id="lakda-report-data" type="application/json">${serializeReportData(view)}</script>
</body></html>
`;
}
