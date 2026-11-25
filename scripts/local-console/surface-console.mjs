// Catalog-enabled consoles publish only projected surface evidence. General recordings
// may contain an excluded screen even when a test also touches a public screen.
export function publicJob(job) {
  return job ? { number: job.number, state: job.state } : null;
}
export function publicCatalog(catalog) {
  return { product: { productId: catalog.product.productId, revision: catalog.product.revision, environment: catalog.product.environment },
    suites: catalog.suites.map(s => ({ id: s.id, name: s.name, next: s.next, latest: publicJob(s.latest) })) };
}
export function surfaceExecutionPage() {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>画面・API のテスト実行 | Lakda</title>
<style>body{max-width:960px;margin:auto;padding:24px;background:#f6f7f9;color:#172435;font:16px/1.6 system-ui}article{padding:20px;background:white;border:1px solid #d8dfe7;border-radius:8px;margin:20px 0}button,a{font:inherit;margin:8px 16px 8px 0}button{padding:10px;border:1px solid #718ca7;border-radius:4px;background:white;color:#172435;cursor:pointer}a{color:#225c9b}:focus-visible{outline:3px solid #ca7913;outline-offset:3px}</style>
<header><strong>Lakda</strong></header><main><h1>画面・API のテスト実行</h1><p>公開を許可された要素の到達状況を確認します。動画・一般ケースの詳細は、この公開画面から配信しません。</p><div id="suites"></div><p id="message" role="status"></p></main><script>
const $=id=>document.getElementById(id),states={running:'実行中',complete:'実行完了',error:'実行エラー'};
async function refresh(){const res=await fetch('/api/suites');if(!res.ok)throw Error();const c=await res.json();$('suites').replaceChildren();for(const s of c.suites){const a=document.createElement('article'),h=document.createElement('h2');h.textContent=s.name;a.append(h);const p=document.createElement('p');p.textContent=s.latest?'第'+s.latest.number+'回 · '+states[s.latest.state]:'初回実行前';a.append(p);const b=document.createElement('button');b.textContent='第'+s.next+'回を実行';b.disabled=c.suites.some(s=>s.latest?.state==='running');b.onclick=async()=>{b.disabled=true;try{const r=await fetch('/api/runs/'+encodeURIComponent(s.id)+'/'+s.next,{method:'POST',headers:{'x-lakda-action':'start'}});if(!r.ok)throw Error();await refresh()}catch{$('message').textContent='実行を開始できませんでした。登録と実行状況を確認してください。'}};a.append(b);const link=document.createElement('a');link.textContent='画面・API の到達状況';link.href='/surfaces?suite='+encodeURIComponent(s.id)+(s.latest?'&attempt='+s.latest.number:'');a.append(link);$('suites').append(a)}}
refresh().catch(()=>{$('message').textContent='登録したテストを取得できません。'});setInterval(()=>refresh().catch(()=>{}),2000);
</script></html>`;
}
