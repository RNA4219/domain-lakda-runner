/* global document, Option, TextEncoder, structuredClone */
import { kindNames, MAX_BYTES, SCHEMA, validateMap } from '#lakda-map-model';

const el=id=>document.getElementById(id);
function element(tag,text) {
  const item=document.createElement(tag);
  if(text!==undefined) item.textContent=text;
  return item;
}
function options(select,items) {
  select.replaceChildren(...items.map(([value,label])=>new Option(label,value)));
}
function freshId(items,prefix) {
  const ids=new Set(items.map(item=>item.id));
  let n=1;
  while(ids.has(prefix+n)) n++;
  return prefix+n;
}
const laneNames={real:'実サーバー',mock:'差し替え',unknown:'分類不能'};
const reachNames={observed:'観測あり',not_observed:'観測なし',unmeasured:'未計測'};

export function createFlows({choose,edit,focusMap}) {
  let map,byId,flow,index=0,report;
  function nodeRole(node) {return node.role || kindNames.get(node.kind);}
  function incoming() {
    const s=flow.steps[index];
    return s.via && map.connections.find(e=>e.from===flow.steps[index-1].node && e.to===s.node && e.label===s.via);
  }
  function stepInfo() {
    const node=byId.get(flow.steps[index].node),edge=incoming();
    const info=el('flow-info'), title=element('h3',node.name);
    info.replaceChildren(title);
    const repository=node.repository ? byId.get(node.repository).name : node.kind==='repository' ? node.name : '未登録';
    info.append(element('p',nodeRole(node)+'　／　担当リポジトリ　'+repository));
    if(index>0) {
      const prior=byId.get(flow.steps[index-1].node);
      info.append(element('p',edge ? '設計上の接続　'+prior.name+' → '+node.name+'（'+edge.label+'）' : '手順上の順序のみ・接続未指定'));
      const observation=edge && report?.observations?.find(o=>o.from===edge.from && o.to===edge.to && o.label===edge.label);
      info.append(element('p','今回の通信観測　'+(observation ? reachNames[observation.state] : '未計測')));
      if(observation?.evidence.length) {
        const evidence=element('details'), list=element('ul');
        evidence.append(element('summary','画面からAPIへの観測証跡（'+observation.evidence.length+'件）'),list);
        for(const e of observation.evidence) list.append(element('li',[e.testId+' @ '+e.testRevision,'ケース結果 '+e.outcome,laneNames[e.lane],e.runId+' / '+e.attempt,e.source,e.observationSha256].join(' · ')));
        info.append(evidence);
      }
    }
    const matches=(report?.behaviors ?? []).flatMap((b,i)=>b.targets.some(t=>t===node.id ||
      (edge && typeof t==='object' && t.from===edge.from && t.to===edge.to && t.label===edge.label)) ? [{b,i}] : []);
    if(!matches.length) info.append(element('p',report ? '対応テスト　未登録' : '対応テスト　実行結果の参照なし'));
    else {
      const list=element('ul'), more=element('details'), additional=element('ul');
      more.append(element('summary','残りの対応テスト（'+(matches.length-3)+'件）'),additional);
      for(const {b,i} of matches) {
        const row=element('li'), link=element('a',b.title);link.href='#behavior-'+i;
        row.append(link,element('small','　'+b.state));
        if(b.cases?.length) {
          const cases=element('details');
          cases.append(element('summary','確認項目の結果（'+b.cases.length+'ケース）'));
          for(const c of b.cases) cases.append(element('p',c));
          row.append(cases);
        }
        (list.childElementCount<3 ? list : additional).append(row);
      }
      info.append(element('p','対応テスト'),list);
      if(additional.childElementCount) info.append(more);
    }
  }
  function renderStep() {
    const track=el('flow-track'), focus=track.contains(document.activeElement);
    const start=Math.min(Math.max(0,index-2),Math.max(0,flow.steps.length-5));
    track.replaceChildren();
    for(let i=start;i<Math.min(flow.steps.length,start+5);i++) {
      const node=byId.get(flow.steps[i].node),li=element('li'),button=element('button');
      button.type='button';button.append(element('small',(i+1)+' · '+nodeRole(node)),element('strong',node.name));
      if(i===index) button.setAttribute('aria-current','step');
      button.addEventListener('click',()=>go(i));li.append(button);track.append(li);
    }
    const current=track.querySelector('[aria-current=step]');
    if(focus) current.focus({preventScroll:true});
    el('flow-step').value=String(index);
    el('flow-prev').disabled=index===0;el('flow-next').disabled=index===flow.steps.length-1;
    stepInfo();
  }
  function renderFlow() {
    el('no-flows').hidden=!!flow;el('flow-content').hidden=!flow;el('flow-switch').hidden=!flow;
    if(!flow) {el('flow-info').replaceChildren();el('flow-track').replaceChildren();return;}
    el('flow-choice').value=flow.id;
    el('step-list').open=flow.steps.length<=5;
    el('step-list-label').textContent=flow.steps.length<=5 ? '工程一覧（'+flow.steps.length+'件）' : '前後の工程を見る（全'+flow.steps.length+'件）';
    options(el('flow-step'),flow.steps.map((s,i)=>[String(i),(i+1)+' / '+flow.steps.length+'　'+byId.get(s.node).name]));
    renderStep();
  }
  function go(i) {
    index=i;renderStep();choose(flow.steps[i].node);
  }
  el('flow-prev').addEventListener('click',()=>go(index-1));
  el('flow-next').addEventListener('click',()=>go(index+1));
  el('flow-step').addEventListener('change',e=>go(Number(e.target.value)));
  el('flow-map').addEventListener('click',()=>{choose(flow.steps[index].node);focusMap();});
  el('flow-choice').addEventListener('change',e=>{
    flow=map.flows.find(f=>f.id===e.target.value);index=0;renderFlow();choose(flow.steps[0].node);
    el('edit-flow').value=flow.id;editorFields();
  });

  function editorFields() {
    const existing=map.flows.find(f=>f.id===el('edit-flow').value), node=byId.get(el('edit-node').value);
    el('new-flow-field').hidden=!!existing;el('new-flow').required=!existing;
    el('new-node-field').hidden=!!node;el('new-node').required=!node;el('new-kind-field').hidden=!!node;
    el('via-field').hidden=!existing;el('edit-via').value='';
    const last=existing?.steps.at(-1).node;
    options(el('via-options'),map.connections.filter(c=>c.from===last && c.to===node?.id).map(c=>[c.label,c.label]));
  }
  function editNode() {
    const node=byId.get(el('edit-node').value);
    el('edit-role').value=node?.role ?? '';el('edit-owner').value=node?.repository ?? '';
    editorFields();
  }
  el('edit-node').addEventListener('change',editNode);
  el('edit-flow').addEventListener('change',editorFields);
  el('flow-form').addEventListener('submit',e=>{
    e.preventDefault();
    try {
      const draft=structuredClone(map);
      let operation=draft.flows.find(f=>f.id===el('edit-flow').value);
      if(!operation) {
        operation={id:freshId(draft.flows,'flow-'),name:el('new-flow').value.trim(),steps:[]};draft.flows.push(operation);
      }
      let node=draft.nodes.find(n=>n.id===el('edit-node').value);
      if(!node) {
        node={id:freshId(draft.nodes,'node-'),name:el('new-node').value.trim(),kind:el('new-kind').value};draft.nodes.push(node);
      }
      const role=el('edit-role').value.trim(), owner=el('edit-owner').value;
      if(role) node.role=role;else delete node.role;
      if(owner) node.repository=owner;else delete node.repository;
      const previous=operation.steps.at(-1)?.node, via=previous && el('edit-via').value.trim();
      if(via && !draft.connections.some(c=>c.from===previous && c.to===node.id && c.label===via))
        draft.connections.push({from:previous,to:node.id,label:via,evidence:''});
      operation.steps.push(via ? {node:node.id,via} : {node:node.id});
      const definition={schema:SCHEMA,...draft},checked=validateMap(definition);
      if(new TextEncoder().encode(JSON.stringify({schema:SCHEMA,...checked},null,2)).length>MAX_BYTES) throw Error('構成ファイルの上限は1 MiBです。');
      edit(checked,operation.id,operation.steps.length-1);
      el('status').textContent='「'+operation.name+'」に工程を追加しました。';
    } catch(error) {el('edit-error').textContent=error.message;el('edit-error').hidden=false;}
  });
  return {
    load(value,operation,step,data,edited) {
      map=value;flow=operation;index=step;report=data;byId=new Map(map.nodes.map(n=>[n.id,n]));
      el('flows').hidden=false;options(el('flow-choice'),map.flows.map(f=>[f.id,f.name]));renderFlow();
      const available=map.flows.map(f=>[f.id,f.name]);
      options(el('edit-flow'),[['','新しい操作'],...available]);el('edit-flow').value=flow?.id ?? '';
      options(el('edit-node'),[...map.nodes.map(n=>[n.id,n.name]),['','新しい構成要素']]);
      options(el('new-kind'),[...kindNames]);el('new-kind').value='service';
      options(el('edit-owner'),[['','未登録'],...map.nodes.filter(n=>n.kind==='repository').map(n=>[n.id,n.name])]);
      options(el('role-options'),[...new Set(['画面','API','処理','保存先','キュー','バッチ','外部連携','イベント','認証',...map.nodes.map(nodeRole)])].map(r=>[r,r]));
      el('new-flow').value='';el('new-node').value='';el('edit-error').hidden=true;editNode();
      const save=el('save-flow');save.hidden=!edited;
      if(edited) save.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify({schema:SCHEMA,...map},null,2));
      else {save.removeAttribute('href');el('flow-editor').open=false;}
    },
    follow(id) {
      if(!flow || flow.steps[index].node===id) return;
      const step=flow.steps.findIndex(s=>s.node===id);
      if(step>=0) {index=step;renderStep();}
    }
  };
}
