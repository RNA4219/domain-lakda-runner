import type { CoverageReport } from "./report.js";

const escape = (s: string | number) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;"})[c]!);
const states = { excluded:"対象外", undesigned:"ケース未設計", pending:"今回未判定", failed:"不合格", passed:"合格" };
const checks = { passed:"合格", failed:"不合格", partial:"判定できず", unreported:"未報告" };

export function renderCoverage(report: CoverageReport, inputHref?: string): string {
  const { totals:t, architecture:g, behaviors } = report;
  const names = new Map(g.nodes.map(n => [n.id,n.name]));
  const anchor = (id:string) => "behavior-" + behaviors.findIndex(b => b.id === id);
  const byId = new Map(behaviors.map(b => [b.id,b]));
  const links = (ids:string[]) => ids.length ? ids.map(id => {
    const b = byId.get(id)!;
    return '<a href="#'+anchor(id)+'">'+escape(b.title)+'</a> <small>'+states[b.state]+'</small>';
  }).join("<br>") : "振る舞い未登録";
  const ratio = (n:number) => t.total ? n+" / "+t.total+"（"+Math.round(100*n/t.total)+"%）" : "算出できない";
  const parts = behaviors.map(b => {
    const items = b.cases.map(c => '<li><strong>'+escape(c.id)+'</strong>（版 '+escape(c.revision)+'）<ul>'+
      c.checks.map(h => '<li>'+escape(h.id)+' · '+checks[h.result as keyof typeof checks]+
        (h.source ? ' <code>'+escape(h.source)+'</code>' : '')+
        (h.comparisons.length ? '<ul>'+h.comparisons.map(v => '<li>'+escape(v.field)+'　期待 '+
          escape(JSON.stringify(v.expected))+' ／ 観測 '+escape(JSON.stringify(v.actual))+'</li>').join("")+'</ul>' : '')+
        '</li>').join("")+'</ul></li>').join("");
    return '<article id="'+anchor(b.id)+'"><small>'+escape(b.domain)+'</small><h3>'+escape(b.title)+'</h3>'+
      '<p class="'+b.state+'">'+states[b.state]+'</p><p>受入条件 '+escape(b.criterion)+' · 出典 '+escape(b.source)+'</p>'+
      (b.excluded ? '<p>対象外の理由　'+escape(b.excluded)+'</p>' : '')+
      (items ? '<details><summary>確認項目と今回の証跡</summary><ul>'+items+'</ul></details>' : '')+'</article>';
  }).join("");
  const architecture = [...g.nodes.map(n => [n.name,n.type || "構成要素",links(n.behaviors)]),
    ...g.connections.map(e => [names.get(e.from)+' → '+names.get(e.to), e.label,links(e.behaviors),e.evidence])];
  return '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<title>'+escape(report.product)+'の検証範囲</title><style> *{box-sizing:border-box}body{margin:0;color:#192e36;background:#fafbf9;font:1rem/1.65 system-ui,sans-serif}main{max-width:68rem;margin:auto;padding:clamp(1rem,4vw,3rem)}h1,h2,h3,p{margin:.35em 0}h2{margin-top:1.7em}h3{font-size:1.07rem}a{color:#005776}summary{cursor:pointer;color:#005776}article,li,td,th,code{overflow-wrap:anywhere}article{padding:1rem 0;border-top:1px solid #a9b9bc}small{color:#425860}.failed{color:#932a22}code{font-size:.85em}table{border-collapse:collapse;width:100%}td,th{text-align:left;vertical-align:top;padding:.55em;border-bottom:1px solid #c2cdcf}th{color:#37505a}article:target{outline:2px solid #257181;outline-offset:3px}ul{padding-left:1.4rem}body{overflow-wrap:anywhere}</style><main>'+
    '<h1>'+escape(report.product)+'の検証範囲</h1><p>対象版 '+escape(report.version)+' · '+(report.runId ? '実行回 '+escape(report.runId) : '設計時点')+'</p>'+
    '<p><strong>今回判定済み '+ratio(t.judged)+'</strong>　設計済み '+ratio(t.designed)+'</p>'+
    '<p>不合格 '+t.failed+'件　今回未判定 '+(t.designed-t.judged)+'件　ケース未設計 '+(t.total-t.designed)+'件</p>'+
    '<h2>'+escape(g.name)+'</h2><table><thead><tr><th scope="col">要素・接続</th><th scope="col">保証する振る舞い</th></tr></thead><tbody>'+
    architecture.map(([name,kind,target,source]) => '<tr><td>'+escape(name)+'<br><small>'+escape(kind)+'</small>'+
      (source ? '<details><summary>接続の出典</summary>'+escape(source)+'</details>':'')+'</td><td>'+target+'</td></tr>').join("")+
    '</tbody></table><h2>業務ごとの確認結果</h2>'+ (parts || '<p>振る舞い未登録</p>') +
    (report.unmappedCases.length ? '<h2>対応のないケース</h2><ul>'+report.unmappedCases.map(c => '<li>'+escape(c.id)+'（版 '+escape(c.revision)+'）</li>').join("")+'</ul>' : '')+
    (report.evidence ? '<details><summary>参照した実行記録</summary><p>'+
      (inputHref ? '<a href="'+escape(inputHref)+'">'+escape(report.evidence.file)+'</a>' : escape(report.evidence.file))+
      '</p><code>'+escape(report.evidence.sha256)+'</code></details>' : '')+'</main></html>';
}
