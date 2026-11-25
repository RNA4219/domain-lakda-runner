import type { CoverageReport } from "./report.js";
import { renderArchitecturePage } from "./architecture-view.js";

const escape = (s: string | number) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;"})[c]!);
const states = { excluded:"対象外", undesigned:"ケース未設計", pending:"今回未判定", failed:"不合格", passed:"合格" };
const checks = { passed:"合格", failed:"不合格", partial:"判定できず", unreported:"未報告" };

export interface ConsoleCoverage {
  name: string;
  suiteName: string;
  attemptLabel: string;
  suiteLinks: { name:string; href:string; current:boolean }[];
  returnHref?: string;
  caseLinks: Map<string,string>;
}

export function renderCoverage(report: CoverageReport, inputHref?: string, architectureDefinition?: unknown, context?: ConsoleCoverage): string {
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
        '</li>').join("")+'</ul>'+
      (context?.caseLinks.has(c.id) && c.checks.some(h=>h.source) ? '<a href="'+escape(context.caseLinks.get(c.id)!)+'">この回の操作ログを見る →</a>' : '')+'</li>').join("");
    return '<article id="'+anchor(b.id)+'"><small>'+escape(b.domain)+'</small><h3>'+escape(b.title)+'</h3>'+
      '<p class="'+b.state+'">'+states[b.state]+'</p><p>受入条件 '+escape(b.criterion)+' · 出典 '+escape(b.source)+'</p>'+
      (b.excluded ? '<p>対象外の理由　'+escape(b.excluded)+'</p>' : '')+
      (items ? '<details><summary>確認項目と今回の証跡</summary><ul>'+items+'</ul></details>' : '')+'</article>';
  }).join("");
  const architecture = [...g.nodes.map(n => [n.name,n.type || "構成要素",links(n.behaviors)]),
    ...g.connections.map(e => [names.get(e.from)+' → '+names.get(e.to), e.label,links(e.behaviors),e.evidence])];
  const gaps = behaviors.filter(b => ["failed","pending","undesigned"].includes(b.state));
  const suiteNav = context && context.suiteLinks.length > 1 ? '<nav class="suite-switch" aria-label="スイート">'+
    context.suiteLinks.map(s => '<a href="'+escape(s.href)+'"'+(s.current?' aria-current="true"':'')+'>'+escape(s.name)+'</a>').join("")+'</nav>' : '';
  const head = context ? '<div class="scope-head"><div><p class="eyebrow">'+escape(context.name)+' ／ '+escape(context.suiteName)+'</p>'+
    '<h1>検証範囲</h1><p>'+escape(context.attemptLabel)+' · 対象版 <code title="'+escape(report.version)+'">'+escape(report.version.slice(0,8))+'</code></p></div>'+
    '<p class="fraction">今回判定済み <strong>'+ (t.total ? t.judged+' / '+t.total : '算出できない') +'</strong> 設計済み '+(t.total?t.designed+' / '+t.total:'算出できない')+'</p></div>'+
    suiteNav+'<section class="to-review"><h2>'+(gaps.length ? '確認が残る振る舞い' : t.total ? '対象の振る舞いをすべて確認しました' : '対象の振る舞いはありません')+'</h2>'+
    (gaps.length ? '<ul>'+gaps.map(b=>'<li><span class="'+b.state+'">'+states[b.state]+'</span><a href="#'+anchor(b.id)+'">'+escape(b.title)+'</a></li>').join('')+'</ul>' : '')+
    '</section>' : '<h1>'+escape(report.product)+'の検証範囲</h1><p>対象版 '+escape(report.version)+' · '+(report.runId ? '実行回 '+escape(report.runId) : '設計時点')+'</p>'+
    '<p><strong>今回判定済み '+ratio(t.judged)+'</strong>　設計済み '+ratio(t.designed)+'</p>'+
    '<p>不合格 '+t.failed+'件　今回未判定 '+(t.designed-t.judged)+'件　ケース未設計 '+(t.total-t.designed)+'件</p>';
  const body = head+(context ? '<details class="scope-table"><summary>構成別の対応一覧</summary>' : '')+
    '<h2>'+escape(g.name)+'</h2><table><thead><tr><th scope="col">要素・接続</th><th scope="col">保証する振る舞い</th></tr></thead><tbody>'+
    architecture.map(([name,kind,target,source]) => '<tr><td>'+escape(name)+'<br><small>'+escape(kind)+'</small>'+
      (source ? '<details><summary>接続の出典</summary>'+escape(source)+'</details>':'')+'</td><td>'+target+'</td></tr>').join("")+
    '</tbody></table>'+(context ? '</details><details id="behavior-details" class="scope-table"><summary>受入条件とケース証跡（'+behaviors.length+'項目）</summary>' : '<h2>業務ごとの確認結果</h2>')+
    (parts || '<p>振る舞い未登録</p>')+(context ? '</details>' : '')+
    (report.unmappedCases.length ? '<h2>対応のないケース</h2><ul>'+report.unmappedCases.map(c => '<li>'+escape(c.id)+'（版 '+escape(c.revision)+'）</li>').join("")+'</ul>' : '')+
    (report.evidence ? '<details><summary>参照した実行記録</summary><p>'+
      (inputHref ? '<a href="'+escape(inputHref)+'">'+escape(report.evidence.file)+'</a>' : escape(report.evidence.file))+
      '</p><code>'+escape(report.evidence.sha256)+'</code></details>' : '');
  return renderArchitecturePage({
    product: architectureDefinition ?? { schema:"aym.architecture/v1", ...g },
    productSource: report.product + " の構成定義",
    startWithProduct: true,
    consoleReturn: context ? context.returnHref ?? "/" : undefined,
    report: { title: (context?.name ?? report.product) + "の検証範囲", body,
      behaviors: behaviors.map(b => ({ title:b.title, state:states[b.state], targets:b.targets })) }
  });
}
