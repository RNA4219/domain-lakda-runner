import type { SurfaceReport } from "./report.js";
export function renderSurfaces(report: SurfaceReport, context = "", returnHref = "/") {
  const data = JSON.stringify(report).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  return String.raw`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>画面・API の到達状況 | Lakda</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#172435;font:16px/1.6 system-ui,sans-serif}header,main{max-width:1200px;margin:auto;padding:24px}header{display:flex;gap:24px;align-items:center}a{color:#225c9b}h1{font-size:clamp(24px,4vw,36px);line-height:1.3}h2{font-size:22px}.muted{color:#526172}.panel{background:white;padding:20px;border:1px solid #d8dfe7;border-radius:8px;margin:20px 0}.filters{display:flex;gap:12px;flex-wrap:wrap}label{display:flex;flex-direction:column;font-size:14px}select,input,button{font:inherit;border:1px solid #8b9bad;border-radius:4px;padding:8px;background:white;color:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #ca7913;outline-offset:3px}.table{overflow:auto}table{border-collapse:collapse;width:100%;min-width:550px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #d8dfe7}td button{border:0;padding:0;text-align:left;color:#225c9b;text-decoration:underline}small{display:block;overflow-wrap:anywhere}.pages{display:flex;align-items:center;gap:16px;margin-top:16px}.diagram{overflow:auto}svg{display:block;max-width:100%;height:auto}svg text{font:13px system-ui;fill:#172435}svg rect{fill:#eff4fb;stroke:#718ca7}svg line{stroke:#718ca7}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace}#evidence article{border-bottom:1px solid #d8dfe7;padding:12px 0}#summary{font-weight:600} @media(max-width:600px){header,main{padding:16px}.panel{padding:12px}.filters label{width:100%}}
</style><header><strong>Lakda</strong><a href="${esc(returnHref)}">テストの概要に戻る</a></header><main>
<p>${esc(report.product)} · ${esc(context)}</p><h1>画面・API の到達状況</h1>
<p class="muted">分母の版 ${esc(report.revision)} · 対象版 ${esc(report.version)} · 環境 ${esc(report.environment)}</p>
<p>到達は実行中の観測です。テスト合格と独立しています。未計測は旧結果・証跡不足を含みます。観測なしは、観測が完了したテストで呼び出しがなかった状態です。</p>
<p class="muted">Service Worker の応答と Worker 所有の通信は、upstream を呼ぶ構成でも分類不能です。親画面への実サーバー関係は推測しません。キャッシュ応答・通信の照合不能も分類不能に保ちます。</p>
<div class="panel"><div class="filters"><label>単位<select id="kind"><option value="screens">画面</option><option value="apis">API</option><option value="relations">画面 → API</option></select></label>
<label>通信の分類<select id="lane"><option value="all">すべて</option><option value="real">実サーバー（宣言＋通信観測）</option><option value="mock">差し替え</option><option value="unknown">分類不能</option></select></label>
<label>チャネル<select id="channel"><option value="">すべて</option></select></label><label>検索<input id="query" type="search"></label>
<label>表示<select id="status"><option value="all">すべて</option><option value="uncovered">未到達を優先</option><option value="observed">到達</option><option value="unmeasured">未計測</option><option value="not_observed">観測なし</option></select></label>
<label>並び順<select id="sort"><option value="frequency">利用頻度の高い順</option><option value="name">名前順</option></select></label></div>
<p id="summary" role="status"></p><button id="export" type="button">公開範囲の JSON を保存</button></div>
<div class="panel"><div class="table"><table><thead><tr><th>名前と場所</th><th>到達状況</th><th>利用頻度</th></tr></thead><tbody id="rows"></tbody></table></div><div class="pages"><button id="previous">前へ</button><span id="page"></span><button id="next">次へ</button></div></div>
<section class="panel" id="details" tabindex="-1"><h2 id="selection">要素を選ぶと部分図と証跡を確認できます</h2><p id="omitted"></p><div id="diagram" class="diagram"></div><div id="evidence"></div></section>
<p class="muted">real は対象の真正性やリリース受入の保証ではありません。許可された要素だけを表示・集計・保存します。</p></main><script type="application/json" id="data">${data}</script><script>
const report=JSON.parse(document.getElementById('data').textContent), $=id=>document.getElementById(id);
const labels={observed:'到達',not_observed:'観測なし',unmeasured:'未計測'}, laneNames={real:'実サーバー',mock:'差し替え',unknown:'分類不能'};
let page=0, selected=null, filtered=[];
function el(tag,text,parent){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.append(n);return n}
for(const c of [...new Set(report.screens.map(s=>s.channel))].sort()){$('channel').append(new Option(c,c))}
function redraw(){const kind=$('kind').value,lane=$('lane').value,status=$('status').value,q=$('query').value.toLowerCase();
filtered=report[kind].filter(r=>(!$('channel').value||r.channel===$('channel').value||r.kind==='apis'&&report.relations.some(edge=>edge.api===r.id&&edge.channel===$('channel').value))&&(!q||(r.name+' '+r.id+' '+r.location).toLowerCase().includes(q))&&(status==='all'||(status==='uncovered'?r.states[lane]!=='observed':r.states[lane]===status)));
filtered.sort((a,b)=>($('sort').value==='frequency'?b.frequency-a.frequency:0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
page=Math.min(page,Math.max(0,Math.ceil(filtered.length/50)-1));$('rows').replaceChildren();
for(const row of filtered.slice(page*50,(page+1)*50)){const tr=el('tr',undefined,$('rows')),td=el('td',undefined,tr),btn=el('button',row.name,td);btn.onclick=()=>choose(row);el('small',row.location,td);el('small',row.id+(row.channel?' · '+row.channel:''),td);el('td',labels[row.states[lane]],tr);el('td',String(row.frequency),tr)}
if(!filtered.length){const tr=el('tr',undefined,$('rows'));el('td','該当する要素はありません',tr).colSpan=3}
const s=report.summary[kind][lane];$('summary').textContent='公開分母 '+s.total+' · 到達 '+s.observed+' · 観測なし '+s.notObserved+' · 未計測 '+s.unmeasured+' · 絞り込み '+filtered.length;
$('page').textContent=(page+1)+' / '+Math.max(1,Math.ceil(filtered.length/50));$('previous').disabled=page===0;$('next').disabled=(page+1)*50>=filtered.length;
if(selected)choose(selected,false)}
function choose(row,focus=true){selected=row;$('selection').textContent=row.name;$('evidence').replaceChildren();
const evidence=row.evidence.filter(e=>$('lane').value==='all'||e.lane===$('lane').value);
if(!evidence.length)el('p',labels[row.states[$('lane').value]]+'：この分類の到達証跡はありません。',$('evidence'));
for(const e of evidence){const a=el('article',undefined,$('evidence'));el('strong',e.testId+' · '+e.outcome+' · '+laneNames[e.lane],a);el('pre','実行回 '+e.series+' / '+e.seriesAttempt+'\nrun '+e.runId+' / '+e.attempt+'\nテスト版 '+e.testRevision+'\n観測 '+e.source+'\n観測 SHA-256 '+e.observationSha256+'\nmanifest SHA-256 '+e.manifestSha256,a)}
const relations=report.relations.filter(r=>row.kind==='screens'?r.screen===row.id:row.kind==='apis'?r.api===row.id:r.id===row.id), nodes=new Map();
function add(kind,id){const key=kind+':'+id;if(nodes.has(key))return true;if(nodes.size>=40)return false;const n=report[kind].find(r=>r.id===id);if(!n)return false;nodes.set(key,n);return true}
if(row.kind!=='relations')add(row.kind,row.id);
const edges=[];for(const r of relations){if(edges.length>=80)break;if(nodes.size+Number(!nodes.has('screens:'+r.screen))+Number(!nodes.has('apis:'+r.api))>40)continue;if(add('screens',r.screen)&&add('apis',r.api))edges.push(r)}
$('omitted').textContent='選択した要素の近傍 '+nodes.size+' 要素 / '+edges.length+' 関係。省略 '+(relations.length-edges.length)+' 関係。全件は一覧で確認できます。';$('diagram').replaceChildren();
if(nodes.size){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),height=Math.max(100,Math.max([...nodes.values()].filter(n=>n.kind==='screens').length,[...nodes.values()].filter(n=>n.kind==='apis').length)*64);svg.setAttribute('viewBox','0 0 900 '+height);svg.setAttribute('role','img');svg.setAttribute('aria-label','選択した要素と関連する画面・API');$('diagram').append(svg);const positions=new Map(),counts={screens:0,apis:0};for(const [key,n]of nodes){positions.set(key,{x:n.kind==='screens'?10:500,y:counts[n.kind]++*64+8})}
for(const r of edges){const a=positions.get('screens:'+r.screen),b=positions.get('apis:'+r.api),line=document.createElementNS(ns,'line');for(const [k,v]of Object.entries({x1:a.x+380,y1:a.y+22,x2:b.x,y2:b.y+22}))line.setAttribute(k,v);svg.append(line)}
for(const [key,n]of nodes){const p=positions.get(key),g=document.createElementNS(ns,'g'),rect=document.createElementNS(ns,'rect'),t=document.createElementNS(ns,'text');for(const [k,v]of Object.entries({x:p.x,y:p.y,width:380,height:44,rx:5}))rect.setAttribute(k,v);t.setAttribute('x',p.x+10);t.setAttribute('y',p.y+27);t.textContent=(n.name.length>26?n.name.slice(0,26)+'…':n.name)+' · '+labels[n.states[$('lane').value]];g.append(rect,t);svg.append(g)}}
if(focus)$('details').focus()}
for(const id of ['kind','lane','channel','query','status','sort'])$(id).addEventListener('input',()=>{page=0;selected=null;$('diagram').replaceChildren();$('evidence').replaceChildren();$('selection').textContent='要素を選ぶと部分図と証跡を確認できます';$('omitted').textContent='';redraw()});
$('previous').onclick=()=>{page--;redraw()};$('next').onclick=()=>{page++;redraw()};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='surface-coverage.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),0)};redraw();
</script></html>`;
}
