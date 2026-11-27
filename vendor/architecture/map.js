/* global document, matchMedia, Option, ResizeObserver, location, window */
import { parseFile, importDocuments, validateMap, MAX_BYTES, kindNames, severityNames } from '#lakda-map-model';
import { createFlows } from '#lakda-map-flows';

const $=id=>document.getElementById(id);
const page=JSON.parse($('map-data').textContent);
const ns='http://www.w3.org/2000/svg';
const priorities=[...severityNames.keys()];
const state={map:null,byId:new Map(),selected:null,mode:'all',packages:new Map(),load:0,note:''};
const diagram=$('diagram'), frame=$('frame');
let camera={x:0,y:0,zoom:1}, chart=null, selectedWire=null, wireChoices=[];
const offsets={all:new Map(),repos:new Map()};
const nodesDrawn=new Map(), wiresDrawn=new Map();
function html(tag,text,cls) {
  const e=document.createElement(tag);
  if (cls) e.className=cls;
  if (text!==undefined) e.textContent=text;
  return e;
}
function svg(tag,attrs={},text) {
  const e=document.createElementNS(ns,tag);
  for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,String(v));
  if (text!==undefined) e.textContent=text;
  return e;
}
function issues(id) { return state.map.findings.filter(f=>f.node===id); }
function eligible() { return state.map.nodes.filter(n=>state.mode==='all' || n.kind==='repository'); }
function incident(id) { return state.map.connections.filter(c=>c.from===id || c.to===id); }
function initial(nodes) {
  const wanted=new Set(nodes.map(n=>n.id));
  return state.map.findings.find(f=>wanted.has(f.node))?.node ?? nodes[0].id;
}

const flows=createFlows({
  choose(id) {
    if(state.mode==='repos' && state.byId.get(id)?.kind!=='repository') { state.mode='all';state.selected=id;render(); }
    select(id);
  },
  edit(map,flowId,step) { apply({map,source:'編集用コピー',edited:true},false,flowId,step); }
});
function apply(result,sample=false,flowId,step=0) {
  state.map=result.map;
  state.coverage=result.coverage === true;
  state.map.findings.sort((a,b)=>priorities.indexOf(a.severity)-priorities.indexOf(b.severity));
  state.byId=new Map(state.map.nodes.map(n=>[n.id,n]));
  state.mode='all';
  offsets.all.clear();offsets.repos.clear();selectedWire=null;
  resetGestures();
  chart=null;
  state.packages=result.packages || new Map();
  const flow=state.map.flows.find(f=>f.id===flowId) ?? state.map.flows[0];
  state.selected=flow?.steps[step]?.node ?? initial(state.map.nodes);
  state.note=result.note || '';
  $('nearby').checked=false;
  $('node-query').value='';
  $('workspace').hidden=false;
  $('error').hidden=true;
  $('reset').hidden=sample;
  $('name').textContent=state.map.name;
  $('source').textContent=sample ? '見本データ' : '読み込み元　'+result.source;
  $('counts').textContent=state.map.nodes.length+' 要素　／　'+state.map.connections.length+' 接続　／　'+state.map.findings.length+' 件の指摘';
  flows.load(state.map,flow,step,state.coverage ? page : null,result.edited===true);
  render();
}
function error(message) { $('error').textContent=message; $('error').hidden=false; }
function loadBundled(product = false) {
  ++state.load;
  try {
    if(product && page.productError) throw Error(page.productError);
    const map=validateMap(product ? page.product : page.sample);
    if(product) apply({map,source:page.productSource,coverage:page.behaviors!==null});
    else apply({map,note:'架空の構成とレビュー記録を使用しています。'},true);
    $('status').textContent=map.name+'を表示しました。';
  } catch(e) {
    error(e.message);
    if(!state.map) {
      $('name').textContent='構成図を表示できません';
      $('reset').hidden=false;
    }
  }
}
async function openFiles(files) {
  const version=++state.load;
  try {
    if (files.length>100 || files.some(file=>file.size>MAX_BYTES) || files.reduce((n,f)=>n+f.size,0)>4*MAX_BYTES) {
      throw Error('1ファイル1 MiB以下、一度に100ファイル・合計4 MiB以下で選んでください。');
    }
    const docs=[];
    for (const file of files) {
      const contents=await file.text();
      if (version!==state.load) return;
      docs.push({name:file.name,value:parseFile(contents,file.name)});
    }
    const result=importDocuments(docs,state.packages);
    if(version===state.load) { apply(result); $('status').textContent='構成図を読み込みました。'+result.source; }
  } catch(e) { if (version===state.load) error(e.message); }
}

// リポジトリだけの図は参照元からの距離で並べる。循環や独立した要素にも位置を割り当てる。
function repoBands(nodes,edges) {
  const outgoing=new Map(nodes.map(n=>[n.id,[]]));
  const incoming=new Set();
  for (const e of edges) { outgoing.get(e.from).push(e.to); incoming.add(e.to); }
  const levels=new Map();
  function visit(seeds) {
    const queue=seeds.map(n=>n.id);
    queue.forEach(id=>levels.set(id,0));
    for(let i=0;i<queue.length;i++){
      const id=queue[i];
      for(const other of outgoing.get(id)) if(!levels.has(other)) {
        levels.set(other,levels.get(id)+1);queue.push(other);
      }
    }
  }
  visit(nodes.filter(n=>!incoming.has(n.id)));
  for(const n of nodes) if(!levels.has(n.id)) visit([n]);
  const bands=[];
  for(const n of nodes) (bands[levels.get(n.id)] ??= {label:'',nodes:[]}).nodes.push(n);
  return bands;
}
function layout(nodes,edges,width) {
  const repoOnly=nodes.every(n=>n.kind==='repository');
  const groups=new Map();
  for(const n of nodes) {
    const label=n.role || kindNames.get(n.kind);
    if(!groups.has(label)) groups.set(label,[]);
    groups.get(label).push(n);
  }
  const bands=repoOnly && (state.mode==='repos' || nodes.every(n=>!n.role)) ? repoBands(nodes,edges) :
    [...groups].map(([label,nodes])=>({label,nodes}));
  const vertical=width<580 || bands.length>4 || bands.some(b=>b.nodes.length>6);
  const positions=new Map(), zones=[];
  const height=80, gap=36, margin=12;
  let bottom=0;
  if(vertical) {
    const capacity=Math.min(6,Math.max(1,Math.floor(width/175))), cell=(width-margin*2)/capacity;
    let top=14, used=0, rowHeight=0;
    for(const band of bands){
      const columns=Math.min(capacity,band.nodes.length);
      if(used+columns>capacity) {top+=rowHeight+22;used=0;rowHeight=0;}
      const left=margin+used*cell;
      const bw=Math.min(186,cell-18);
      const start=band.label ? 32 : 12;
      const rows=Math.ceil(band.nodes.length/columns);
      const zoneHeight=start+rows*(height+20);
      zones.push({x:left+2,y:top,w:columns*cell-4,h:zoneHeight,label:band.label});
      band.nodes.forEach((n,i)=>positions.set(n.id,{x:left+(i%columns+.5)*cell-bw/2,y:top+start+Math.floor(i/columns)*(height+20),w:bw,h:height,bandTop:top,bandBottom:top+zoneHeight}));
      used+=columns;rowHeight=Math.max(rowHeight,zoneHeight);
    }
    bottom=top+rowHeight+14;
  } else {
    const widthPer=(width-2*margin)/bands.length;
    const bw=Math.min(205,widthPer-46);
    const rows=Math.max(...bands.map(b=>b.nodes.length));
    bottom=Math.max(300,rows*(height+gap)+64);
    bands.forEach((band,col)=>{
      const left=margin+col*widthPer;
      zones.push({x:left+2,y:16,w:widthPer-4,h:bottom-32,label:band.label});
      const firstY=(bottom-band.nodes.length*(height+gap)+gap)/2+10;
      band.nodes.forEach((n,i)=>positions.set(n.id,{x:left+(widthPer-bw)/2,y:firstY+i*(height+gap),w:bw,h:height}));
    });
  }
  return {positions,zones,height:bottom};
}
function edgePath(a,b) {
  const ax=a.x+a.w/2, ay=a.y+a.h/2, bx=b.x+b.w/2, by=b.y+b.h/2;
  if(a.bandTop!==undefined && b.bandTop!==undefined && a.bandTop!==b.bandTop) {
    const corridor=by>ay ? a.bandBottom+10 : a.bandTop-10;
    return 'M '+(a.x+a.w)+' '+ay+' h 5 V '+corridor+' H '+(b.x-7)+' V '+by+' H '+(b.x-2);
  }
  if(Math.abs(ax-bx) < 5) {
    const side=Math.abs(ay-by)>a.h*2 ? -1 : 1;
    const x1=ax+side*a.w/2, x2=bx+side*b.w/2, lane=x1+side*14;
    return 'M '+x1+' '+ay+' C '+(lane+side*4)+' '+ay+' '+lane+' '+ay+' '+lane+' '+((ay+by)/2)+' S '+(lane+side*4)+' '+by+' '+(x2+side*2)+' '+by;
  }
  if(Math.abs(by-ay)>a.h*1.5 && Math.abs(bx-ax)<a.w*1.4) {
    const s=by>ay?1:-1, y1=ay+s*a.h/2, y2=by-s*(b.h/2+2), mid=(y1+y2)/2;
    return 'M '+ax+' '+y1+' C '+ax+' '+mid+' '+bx+' '+mid+' '+bx+' '+y2;
  }
  const s=bx>ax?1:-1, x1=ax+s*a.w/2, x2=bx-s*(b.w/2+2), mid=(x1+x2)/2;
  return 'M '+x1+' '+ay+' C '+mid+' '+ay+' '+mid+' '+by+' '+x2+' '+by;
}
const measure=document.createElement('canvas').getContext('2d');
const labelFont=window.getComputedStyle(diagram).fontFamily;
function fit(text,width,size,bold=false) {
  measure.font=(bold?'700 ':'')+size+'px '+labelFont;
  if(measure.measureText(text).width<=width) return text;
  let s='';
  for(const char of text){if(measure.measureText(s+char+'…').width>width) break; s+=char;}
  return s+'…';
}
const glyphs={
  repository:'M3 4h13v13H5a2 2 0 0 1-2-2z M6 4v9 M3 14h13',
  service:'M6 3h7l4 6-4 6H6L2 9z M7 9h5',
  store:'M3 5c0-4 13-4 13 0s-13 4-13 0 M3 5v9c0 4 13 4 13 0V5 M3 10c0 4 13 4 13 0',
  external:'M3 5h13v10H3z M6 9h7 M9 7l3 2-3 2'
};
function updateCamera() {
  const {x,y,zoom}=camera, width=frame.clientWidth/zoom, height=frame.clientHeight/zoom;
  diagram.setAttribute('viewBox',[x,y,width,height].join(' '));
  const background=$('grid-background');
  if(background) for(const [key,v] of Object.entries({x,y,width,height})) background.setAttribute(key,v);
  $('zoom-value').textContent=Math.round(zoom*100)+'%';
  $('zoom-out').disabled=zoom<=.05;$('zoom-in').disabled=zoom>=4;
  $('reset-layout').disabled=!offsets[state.mode].size;
}
function fitMap() {
  if(!chart || !chart.positions.size) return;
  const boxes=[...chart.positions.values()];
  const auto=!offsets[state.mode].size;
  const x=Math.min(...boxes.map(p=>p.x))-24, y=Math.min(...boxes.map(p=>p.y))-(auto?44:24);
  const w=Math.max(...boxes.map(p=>p.x+p.w))+24-x,h=Math.max(...boxes.map(p=>p.y+p.h))+24-y;
  const zoom=Math.min(1,frame.clientWidth/w,frame.clientHeight/h);
  camera={zoom,x:x+(w-frame.clientWidth/zoom)/2,y:y+(h-frame.clientHeight/zoom)/2};
  updateCamera();
}
function viewportPoint(clientX,clientY) {
  const rect=diagram.getBoundingClientRect();
  return {x:clientX-rect.left,y:clientY-rect.top};
}
function zoomAt(value,point={x:frame.clientWidth/2,y:frame.clientHeight/2}) {
  const next=Math.max(.05,Math.min(4,value));
  camera.x+=point.x*(1/camera.zoom-1/next);
  camera.y+=point.y*(1/camera.zoom-1/next);
  camera.zoom=next;updateCamera();
}
function reveal(target) {
  if(!target) return;
  const box=target.getBoundingClientRect(), view=diagram.getBoundingClientRect();
  const x=(box.left+box.right)/2, y=(box.top+box.bottom)/2;
  if(x<view.left+8 || x>view.right-8 || y<view.top+8 || y>view.bottom-8) {
    camera.x+=(x-view.left-view.width/2)/camera.zoom;
    camera.y+=(y-view.top-view.height/2)/camera.zoom;
    updateCamera();
  }
}
function readMap() {
  const selected=chart?.positions.get(state.selected);
  if(!selected) return;
  const boxes=[...chart.positions.values()];
  const center=(axis,size,room)=>{
    const min=Math.min(...boxes.map(b=>b[axis])),max=Math.max(...boxes.map(b=>b[axis]+b[size]));
    return max-min+32<=room ? (min+max-room)/2 : selected[axis]+(selected[size]-room)/2;
  };
  camera={zoom:1,x:center('x','w',frame.clientWidth),y:center('y','h',frame.clientHeight)};
  updateCamera();
}
function draw(reset=false){
  if(!state.map) return;
  const visible=eligible(), near=new Set([state.selected]);
  for(const c of incident(state.selected)){near.add(c.from);near.add(c.to);}
  const nodes=$('nearby').checked ? visible.filter(n=>near.has(n.id)) : visible;
  const ids=new Set(nodes.map(n=>n.id));
  const edges=state.map.connections.filter(c=>ids.has(c.from)&&ids.has(c.to));
  const width=Math.max(235,frame.clientWidth), initial=!chart || reset;
  chart=layout(nodes,edges,width);
  for(const [id,offset] of offsets[state.mode]){
    const p=chart.positions.get(id);
    if(p){p.x+=offset.x;p.y+=offset.y;delete p.bandTop;}
  }
  const active=document.activeElement?.closest?.('.node,.wire')?.dataset;
  nodesDrawn.clear();wiresDrawn.clear();
  const fragment=document.createDocumentFragment(),defs=svg('defs');
  for(const [id,color] of [['arrow','#8c8192'],['active-arrow','#674779']]){
    const marker=svg('marker',{id,viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:6,markerHeight:6,orient:'auto'});
    marker.append(svg('path',{d:'M0 1 L9 5 L0 9 z',fill:color}));defs.append(marker);
  }
  const grid=svg('pattern',{id:'grid',width:16,height:16,patternUnits:'userSpaceOnUse'});
  grid.append(svg('circle',{cx:1,cy:1,r:.9,fill:'#cfc5d5'}));defs.append(grid);
  fragment.append(defs,svg('rect',{id:'grid-background',fill:'url(#grid)','pointer-events':'none'}));
  const lanes=svg('g',{id:'lanes',visibility:offsets[state.mode].size?'hidden':'visible'});
  for(const z of chart.zones) if(z.label){
    lanes.append(svg('rect',{class:'lane',x:z.x,y:z.y,width:z.w,height:z.h,rx:9}));
    const label=svg('text',{class:'lane-title',x:z.x+10,y:z.y+22},fit(z.label,z.w-20,13,true));
    label.append(svg('title',{},z.label));lanes.append(label);
  }
  fragment.append(lanes);
  let focusTarget;
  for(const c of edges) {
    const key=JSON.stringify([c.from,c.to]);
    if(wiresDrawn.has(key)){wiresDrawn.get(key).records.push(c);continue;}
    const chosen=key===selectedWire;
    const activeEdge=chosen || (!selectedWire && (c.from===state.selected || c.to===state.selected));
    const label=state.byId.get(c.from).name+' → '+state.byId.get(c.to).name;
    const g=svg('g',{class:'wire'+(chosen?' selected':''),role:'button',tabindex:0,'data-wire':key,
      'aria-label':'接続　'+label,'aria-pressed':chosen});
    const path=svg('path',{class:'edge'+(activeEdge?' near':''),d:edgePath(chart.positions.get(c.from),chart.positions.get(c.to)),'data-from':c.from,'data-to':c.to,
      'marker-end':'url(#'+(activeEdge?'active-arrow':'arrow')+')'});
    const hit=svg('path',{class:'wire-hit',d:path.getAttribute('d')});
    g.append(svg('title',{},label+'　'+c.label),path,hit);fragment.append(g);
    wiresDrawn.set(key,{path,hit,records:[c]});
    if(active?.wire===key) focusTarget=g;
  }
  if(selectedWire && !wiresDrawn.has(selectedWire)) selectedWire=null;
  const emphasized=selectedWire ? new Set(JSON.parse(selectedWire)) : near;
  for(const n of nodes){
    const p=chart.positions.get(n.id), findings=issues(n.id), selected=!selectedWire && n.id===state.selected;
    const g=svg('g',{class:'node'+(selected?' selected':'')+(findings.length?' flagged':'')+(emphasized.has(n.id)?' near':''),
      transform:'translate('+p.x+' '+p.y+')',role:'button',tabindex:0,'aria-pressed':selected,'data-id':n.id});
    g.append(svg('rect',{class:'box',width:p.w,height:p.h,rx:8}));
    const color=n.kind==='repository'?'#68487a':n.kind==='store'?'#29676c':'#915031';
    g.append(svg('path',{class:'glyph',d:glyphs[n.kind],transform:'translate(9 8)',color}));
    g.append(svg('text',{class:'node-type',x:32,y:23},fit(n.role || n.type || kindNames.get(n.kind),p.w-(findings.length?61:42),12)));
    g.append(svg('text',{class:'node-title',x:11,y:48},fit(n.name,p.w-21,15,true)));
    if(findings.length){
      g.append(svg('text',{class:'node-issue',x:11,y:68},fit('指摘　'+findings[0].title,p.w-21,12)));
      g.append(svg('circle',{class:'alert-icon',cx:p.w-13,cy:15,r:9}),svg('text',{class:'alert-text',x:p.w-13,y:19,'text-anchor':'middle'},'!'));
    }
    const visibleLabel=[...g.querySelectorAll('text')].map(t=>t.textContent).join(' ');
    g.setAttribute('aria-label',visibleLabel+'。'+n.name+'、'+kindNames.get(n.kind)+'、指摘'+findings.length+'件');
    nodesDrawn.set(n.id,g);
    if(active?.id===n.id) focusTarget=g;
    fragment.append(g);
  }
  diagram.replaceChildren(fragment);
  if(initial) readMap();else updateCamera();
  if(focusTarget) focusTarget.focus({preventScroll:true});
}

function select(id,showDetail=false) {
  if(!state.byId.has(id)) return;
  selectedWire=null;
  state.selected=id;
  if(![...$('choose').options].some(o=>o.value===id)) { $('node-query').value='';renderPicker(); }
  $('choose').value=id;
  draw();details();
  if(camera.zoom<1) readMap();else reveal(nodesDrawn.get(id));
  flows.follow(id);
  $('status').textContent=state.byId.get(id).name+'、指摘'+issues(id).length+'件を選択しました。';
  if(showDetail && matchMedia('(max-width:900px)').matches) {
    $('detail').focus({preventScroll:true});$('detail').scrollIntoView({block:'start'});
  }
}
function selectWire(key,choices=[]) {
  if(!wiresDrawn.has(key)) return;
  selectedWire=key;wireChoices=choices;draw();details();
  $('choose').value='';
  $('status').textContent='接続を選択しました。'+$('detail-name').textContent;
  if(matchMedia('(max-width:900px)').matches) $('detail').focus();
}
function showBehaviors() {
  $('mapped-behaviors').hidden=!state.coverage;
  if(!state.coverage) { $('behavior-list').replaceChildren();return; }
  const records=selectedWire ? wiresDrawn.get(selectedWire).records : null;
  const list=html('ul');
  page.behaviors.forEach((behavior,index)=>{
    const matches=behavior.targets.some(target=>records
      ? typeof target==='object' && records.some(c=>c.from===target.from && c.to===target.to && c.label===target.label)
      : target===state.selected);
    if(!matches) return;
    const row=html('li'), link=html('a',behavior.title);
    link.href='#behavior-'+index;
    row.append(link,html('small','　'+behavior.state));
    list.append(row);
  });
  $('behavior-list').replaceChildren(list.childElementCount ? list : html('p','振る舞い未登録','hint'));
}
function details(){
  showBehaviors();
  if(selectedWire) {
    const records=wiresDrawn.get(selectedWire).records, {from,to}=records[0];
    const source=state.byId.get(from), target=state.byId.get(to);
    $('detail-kind').textContent='選択中の接続';
    $('detail-name').textContent=source.name+' → '+target.name;
    $('description').hidden=true;
    $('finding-count').textContent='接続の理由と根拠';
    $('findings').replaceChildren(...records.map(c=>{
      const box=html('div',undefined,'connection-record');
      box.append(html('h4',c.label),html('p',c.evidence || '根拠の記録はありません。','link-evidence'));
      return box;
    }));
    if(wireChoices.length>1) {
      const label=html('label','この位置の接続','connection-choice'), menu=html('select');
      for(const key of wireChoices) {
        const line=wiresDrawn.get(key)?.records[0];if(!line) continue;
        menu.add(new Option(state.byId.get(line.from).name+' → '+state.byId.get(line.to).name,key));
      }
      menu.value=selectedWire;
      menu.addEventListener('change',()=>{selectWire(menu.value,wireChoices);$('findings').querySelector('select')?.focus({preventScroll:true});});
      label.append(menu);$('findings').append(label);
    }
    $('links-title').textContent='接続する要素';
    $('links').replaceChildren(...[[source,'接続元'],[target,'接続先']].map(([node,role])=>{
      const row=html('li'), button=html('button',node.name,'link');
      button.addEventListener('click',()=>select(node.id,true));
      row.append(html('p',role,'kind'),button);return row;
    }));
    return;
  }
  $('links-title').textContent='この要素の接続';
  const n=state.byId.get(state.selected), list=issues(n.id);
  $('detail-name').textContent=n.name;
  $('detail-kind').textContent=[n.role || kindNames.get(n.kind),n.type].filter(Boolean).join('　/　');
  $('description').textContent=n.description;
  $('description').hidden=!n.description;
  $('finding-count').textContent=list.length?'この要素の指摘　'+list.length+' 件':'この要素の指摘';
  const records=list.map(f=>{
    const item=html('article',undefined,'finding');
    const dl=html('dl');dl.append(html('dt','根拠'),html('dd',f.evidence),html('dt','確認・対応'),html('dd',f.action));
    item.append(html('span','重要度　'+severityNames.get(f.severity),'level'),html('h3',f.title),dl);
    return item;
  });
  $('findings').replaceChildren(...(records.length?records:[html('p','このデータには指摘の記録がありません。','hint')]));
  const links=incident(n.id).map(c=>{
    const out=c.from===n.id, other=state.byId.get(out?c.to:c.from);
    const row=html('li');
    row.append(html('p',(out?'接続先':'接続元')+'　·　'+c.label,'kind'));
    const button=html('button',other.name,'link');
    button.addEventListener('click',()=>{
      if(state.mode==='repos' && other.kind!=='repository'){state.mode='all';state.selected=other.id;render();}
      select(other.id,true);
    });
    row.append(button);
    if(c.evidence) row.append(html('p',c.evidence,'link-evidence'));
    return row;
  });
  $('links').replaceChildren(...(links.length?links:[html('li','接続の記録はありません。','hint')]));
}
function renderPicker() {
  const query=$('node-query').value.trim().toLocaleLowerCase();
  const nodes=eligible().filter(n=>[n.name,n.role,n.type,kindNames.get(n.kind)].some(v=>v?.toLocaleLowerCase().includes(query)));
  $('choose').replaceChildren(...nodes.map(n=>new Option(n.name+(issues(n.id).length?'　· 指摘あり':''),n.id)));
  const wireOption=new Option(!nodes.length?'該当する要素なし':selectedWire?'接続線を選択中':'要素を選択','');wireOption.disabled=true;
  $('choose').prepend(wireOption);
  $('choose').value=!selectedWire && nodes.some(n=>n.id===state.selected) ? state.selected : '';
}
$('node-query').addEventListener('input',renderPicker);
$('node-query').addEventListener('keydown',e=>{
  const first=$('choose').options[1];
  if(e.key==='Enter' && !e.isComposing && first) {e.preventDefault();select(first.value);}
});
function render() {
  const nodes=eligible();
  $('repos').disabled=!state.map.nodes.some(n=>n.kind==='repository');
  $('repos').setAttribute('aria-pressed',state.mode==='repos');$('all').setAttribute('aria-pressed',state.mode==='all');
  renderPicker();
  $('map-title').textContent=state.mode==='repos'?'リポジトリの依存関係':'構成と接続';
  $('flags').replaceChildren();
  const flagged=nodes.filter(n=>issues(n.id).length);
  if(flagged.length) {
    $('flags').append(html('h3','指摘のある要素'));
    const more=html('details');
    more.append(html('summary','ほか '+Math.max(0,flagged.length-4)+' 件'));
    flagged.forEach((n,i)=>{
      const button=html('button',n.name,'chip');
      button.addEventListener('click',()=>select(n.id,true));
      (i<4 ? $('flags') : more).append(button);
    });
    if(flagged.length>4) $('flags').append(more);
  }
  $('note').textContent=state.note;
  draw();details();
}
for(const mode of ['all','repos']) $(mode).addEventListener('click',()=>{
  selectedWire=null;chart=null;
  state.mode=mode;const nodes=eligible();
  if(!nodes.some(n=>n.id===state.selected)) state.selected=initial(nodes);
  render();
});
$('choose').addEventListener('change',()=>select($('choose').value,true));
$('nearby').addEventListener('change',()=>{selectedWire=null;$('choose').value=state.selected;draw(true);details();});
function highlight(id) {
  if(selectedWire) return;
  for (const edge of $('diagram').querySelectorAll('.edge')) {
    const near=edge.dataset.from===id || edge.dataset.to===id;
    edge.classList.toggle('near',near);
    edge.setAttribute('marker-end',near?'url(#active-arrow)':'url(#arrow)');
  }
}
$('diagram').addEventListener('pointerover',e=>{
  const n=e.target.closest('.node'); if(e.pointerType==='mouse' && n) highlight(n.dataset.id);
});
$('diagram').addEventListener('pointerout',e=>{
  if(e.pointerType==='mouse' && !e.relatedTarget?.closest?.('.node')) highlight(state.selected);
});
$('diagram').addEventListener('focusin',e=>{
  if(e.target.dataset.id) highlight(e.target.dataset.id);
  if(e.target.matches(':focus-visible')) reveal(e.target);
});
$('diagram').addEventListener('focusout',e=>{if(!e.relatedTarget?.closest?.('.node')) highlight(state.selected);});
function moveNode(id,dx,dy) {
  const p=chart.positions.get(id);
  if(!p || (!dx && !dy)) return;
  const offset=offsets[state.mode].get(id) || {x:0,y:0};
  offsets[state.mode].set(id,{x:offset.x+dx,y:offset.y+dy});
  p.x+=dx;p.y+=dy;delete p.bandTop;
  nodesDrawn.get(id).setAttribute('transform','translate('+p.x+' '+p.y+')');
  $('lanes').setAttribute('visibility','hidden');$('reset-layout').disabled=false;
  for(const {records,path,hit} of wiresDrawn.values()) {
    const {from,to}=records[0];
    if(from!==id && to!==id) continue;
    const d=edgePath(chart.positions.get(from),chart.positions.get(to));
    path.setAttribute('d',d);hit.setAttribute('d',d);
  }
}
const pointers=new Map();
let gesture=null, pinch=null;
function resetGestures() {
  for(const id of pointers.keys()) if(diagram.hasPointerCapture(id)) diagram.releasePointerCapture(id);
  pointers.clear();gesture=null;pinch=null;diagram.classList.remove('dragging');
}
function fingerPair() {
  const [a,b]=pointers.values();
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
}
function wireDistance(path,point) {
  const length=path.getTotalLength(), segments=Math.max(4,Math.min(180,Math.ceil(length*camera.zoom/5)));
  let a=path.getPointAtLength(0), best=Infinity;
  for(let i=1;i<=segments;i++) {
    const b=path.getPointAtLength(length*i/segments),dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
    best=Math.min(best,Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy));a=b;
  }
  return best;
}
function activate(target,event) {
  if(target?.classList.contains('wire')) {
    if(!event){selectWire(target.dataset.wire);return;}
    const {clientX,clientY}=event, pixel=viewportPoint(clientX,clientY);
    const point={x:camera.x+pixel.x/camera.zoom,y:camera.y+pixel.y/camera.zoom};
    const keys=new Set(document.elementsFromPoint(clientX,clientY).map(el=>el.closest('.wire')?.dataset.wire).filter(Boolean));
    if(!keys.size){selectWire(target.dataset.wire);return;}
    if(keys.size===1){selectWire([...keys][0]);return;}
    const hits=[...keys].map(key=>({key,d:wireDistance(wiresDrawn.get(key).path,point)})).sort((a,b)=>a.d-b.d);
    selectWire(hits[0].key,hits.map(hit=>hit.key));
  }
  else if(target?.classList.contains('node')) select(target.dataset.id,true);
}
diagram.addEventListener('pointerdown',e=>{
  if(e.button!==0 && e.button!==1) return;
  if(e.button===1) e.preventDefault();
  const point=viewportPoint(e.clientX,e.clientY);
  pointers.set(e.pointerId,point);diagram.setPointerCapture(e.pointerId);
  if(pointers.size===1) {
    const target=e.button===0 ? e.target.closest('.node,.wire') : null;
    target?.focus({preventScroll:true});
    gesture={start:point,last:point,target,moved:false};
  } else if(pointers.size===2) {
    const pair=fingerPair();
    pinch={x:camera.x+pair.x/camera.zoom,y:camera.y+pair.y/camera.zoom,
      zoom:camera.zoom,distance:pair.distance};
    gesture=null;
  }
});
diagram.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId)) return;
  const point=viewportPoint(e.clientX,e.clientY);
  pointers.set(e.pointerId,point);
  if(pinch && pointers.size===2) {
    const pair=fingerPair(), zoom=Math.min(4,Math.max(.05,pinch.zoom*pair.distance/pinch.distance));
    camera={zoom,x:pinch.x-pair.x/zoom,y:pinch.y-pair.y/zoom};updateCamera();return;
  }
  if(!gesture) return;
  if(!gesture.moved && Math.hypot(point.x-gesture.start.x,point.y-gesture.start.y)<4) return;
  gesture.moved=true;diagram.classList.add('dragging');
  const dx=(point.x-gesture.last.x)/camera.zoom,dy=(point.y-gesture.last.y)/camera.zoom;
  const id=gesture.target?.dataset.id;
  if(id) moveNode(id,dx,dy);
  else {camera.x-=dx;camera.y-=dy;updateCamera();}
  gesture.last=point;
});
function endPointer(e) {
  if(!pointers.delete(e.pointerId)) return;
  const tapped=e.type==='pointerup' && gesture && !gesture.moved ? gesture.target : null;
  gesture=null;pinch=null;diagram.classList.remove('dragging');
  if(tapped) activate(tapped,e);
}
for(const type of ['pointerup','pointercancel','lostpointercapture']) diagram.addEventListener(type,endPointer);
diagram.addEventListener('click',e=>{if(e.detail===0) activate(e.target.closest('.node,.wire'));});
frame.addEventListener('keydown',e=>{
  const target=e.target.closest('.node,.wire');
  if((e.key==='Enter'||e.key===' ') && target){e.preventDefault();activate(target);return;}
  const step=e.shiftKey?40:10, arrows={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
  if(Object.hasOwn(arrows,e.key)){
    e.preventDefault();const [x,y]=arrows[e.key];
    if(target?.dataset.id) {moveNode(target.dataset.id,x,y);reveal(target);}
    else {camera.x+=x/camera.zoom;camera.y+=y/camera.zoom;updateCamera();}
  } else if(e.key==='Home'){e.preventDefault();fitMap();}
  else if(!e.ctrlKey && !e.metaKey && ['+','=','-'].includes(e.key)){
    e.preventDefault();zoomAt(camera.zoom*(e.key==='-'?.8:1.25));
  }
});
diagram.addEventListener('wheel',e=>{
  if(e.deltaY===0) return;
  e.preventDefault();zoomAt(camera.zoom*(e.deltaY<0?1.15:1/1.15),viewportPoint(e.clientX,e.clientY));
},{passive:false});
$('zoom-in').addEventListener('click',()=>zoomAt(camera.zoom*1.25));
$('zoom-out').addEventListener('click',()=>zoomAt(camera.zoom*.8));
$('fit-map').addEventListener('click',fitMap);
$('read-map').addEventListener('click',readMap);
$('reset-layout').addEventListener('click',()=>{offsets[state.mode].clear();draw();readMap();});
$('return').addEventListener('click',()=>{const target=diagram.querySelector('[aria-pressed="true"]');target?.focus();frame.scrollIntoView({block:'center'});});
$('file').addEventListener('change',e=>{const files=[...e.target.files];e.target.value='';if(files.length) openFiles(files);});
$('reset').addEventListener('click',()=>loadBundled());
$('product-map').addEventListener('click',()=>loadBundled(true));
$('download').href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(page.sample,null,2)+'\n');
let chartWidth=0;
new ResizeObserver(([entry])=>{
  const width=entry.contentRect.width;
  if(!width) return;
  if(width!==chartWidth) {chartWidth=width;draw(true);} else if(chart) updateCamera();
}).observe(frame);

let initialized=false;
function showSection(navigate=false) {
  const report=$('coverage'), showMap=!report || location.hash==='#architecture';
  $('architecture').hidden=!showMap;
  if(report) {
    report.hidden=showMap;
    document.querySelector('.skip').hash=showMap?'architecture':'coverage';
    for(const link of document.querySelectorAll('.top nav a')) {
      if(link.hash===(showMap?'#architecture':'#coverage')) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
  }
  if(showMap && !initialized) { initialized=true;loadBundled(page.startWithProduct); }
  if(!report) return;
  const target=/^#behavior-\d+$/.test(location.hash) ? $(location.hash.slice(1)) : null;
  if(target) {
    const group=target.closest('details');
    if(group) group.open=true;
    target.tabIndex=-1;
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'start'});
  } else if(navigate) {
    const section=showMap ? $('architecture') : report;
    section.focus({preventScroll:true});section.scrollIntoView({block:'start'});
  }
}
window.addEventListener('hashchange',()=>showSection(true));
showSection();
