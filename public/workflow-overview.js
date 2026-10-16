// Board overview: native persisted Tasks and their actual current frontiers only.
(() => {
const modes = new Map(), scrolls = new Map();
// Only immutable layout geometry is reusable. Current Tasks/cards/frontiers are
// rendered below on every event; cloned inputs/outputs keep the cache private.
const geometries = new Map(), geometryLimit = 32;
function geometry(def, options) {
 const key=JSON.stringify([def,options]);
 if(!geometries.has(key))geometries.set(key,structuredClone(crewLayout.layout(def,options)));
 const value=geometries.get(key);geometries.delete(key);geometries.set(key,value);
 while(geometries.size>geometryLimit)geometries.delete(geometries.keys().next().value);
 return structuredClone(value);
}

const active = r => !r.archived && !['closed','cancelled','succeeded'].includes(r.status);
const loc = x => L(x);
function frontiers(r, cards) {
  const failureNode = r.status === 'failed' ? [...(r.events || [])].reverse().find(e=>e.type==='failed')?.node : null;
  return Object.entries(r.nodes || {}).filter(([id,n]) => n.state === 'running' || n.waiting || (r.queue || []).includes(id) || (r.status === 'failed' && id === failureNode) || n.state === 'blocked').map(([id,n]) => {
    const card = n.waiting === 'card' ? cards.find(c => c.status === 'open' && c.run === r.id && c.node === id && c.visit === n.visits) : null;
    const state = card ? 'human' : n.state === 'blocked' ? 'blocked' : id === failureNode ? 'failed' : r.status === 'paused' ? 'paused' : n.waiting ? 'waiting' : n.state === 'running' ? 'running' : 'queued';
    return {r,id,n,card,state,since:n.waiting ? card?.createdAt || n.waitingAt || null : null};
  });
}
const label = s => ({human:T('Waiting for you','等你'),blocked:T('Blocked','受阻'),failed:T('Failed','失敗'),paused:T('Paused','暫停'),waiting:T('Waiting','等待'),running:T('Running','進行中'),queued:T('Queued','排隊中')})[s];
function token(t) {
  return h('a',{class:`wo-token wo-${t.state}`,href:t.card ? `#/inbox/${encodeURIComponent(t.card.id)}` : `#/tasks/${encodeURIComponent(t.r.id)}`, 'data-wo-task':t.r.id,'data-wo-node':t.id,'data-wo-card':t.card?.id || '',title:`${t.r.id} · ${t.r.title} · ${t.r.workflow} v${t.r.version} · ${label(t.state)}`},h('b',{},t.r.id),h('span',{class:'wo-title'},t.r.title),h('small',{},label(t.state)));
}
function render(runs,cards) {
 const groups = new Map();
 for (const r of runs.filter(active)) { if (!r.def) continue; if (!groups.has(r.workflow)) groups.set(r.workflow,[]);groups.get(r.workflow).push(r); }
 return h('section',{'aria-labelledby':'overviewH','data-workflow-overview':'1'},h('div',{class:'sec-head'},h('h2',{id:'overviewH'},T('Live workflows','即時工作流程')),h('span',{class:'faint'},T('Current Task nodes','任務目前節點'))),groups.size ? [...groups].sort(([a],[b])=>(a==='code-firstmate'?-1:b==='code-firstmate'?1:a.localeCompare(b))).map(([id,rs])=>workflow(id,rs,cards)) : h('div',{class:'card empty'},T('No unresolved native Tasks','沒有尚未解決的原生任務')));
}
function workflow(id,rs,cards) {
 // Different pinned versions share a read-only union of their actual node/edge identities.
 const nodes=new Map(), edges=new Map();
 for(const r of rs) {for(const n of r.def.nodes)if(!nodes.has(n.id))nodes.set(n.id,n);for(const e of r.def.edges)edges.set(JSON.stringify([e.from,e.to,e.when]),e);}
 const def={...rs[0].def,nodes:[...nodes.values()],edges:[...edges.values()]}, ts=rs.flatMap(r=>frontiers(r,cards)), by=new Map();
 for(const t of ts){if(!by.has(t.id))by.set(t.id,[]);by.get(t.id).push(t);}
 const max=Math.max(0,...[...by.values()].map(a=>a.length)), g=geometry(def,{row:96+max*78,foot:max*78+38}), box=g.bbox;
 const w=Math.ceil(box.w+32),height=Math.ceil(Math.max(box.h,...g.nodes.map(n=>n.y-box.y+n.h+(by.get(n.id)?.length||0)*78+60))+32);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`${box.x-16} ${box.y-16} ${w} ${height}`);svg.setAttribute('aria-hidden','true');svg.classList.add('wo-lines');
 const marker=document.createElementNS(svg.namespaceURI,'marker');marker.id='wo-arrow-'+id.replace(/[^a-z0-9_-]/gi,'_');marker.setAttribute('viewBox','0 0 10 10');marker.setAttribute('refX','9');marker.setAttribute('refY','5');marker.setAttribute('markerWidth','6');marker.setAttribute('markerHeight','6');marker.setAttribute('orient','auto');const tip=document.createElementNS(svg.namespaceURI,'path');tip.setAttribute('d','M 0 0 L 10 5 L 0 10 z');tip.style.fill='var(--text-3)';marker.append(tip);const defs=document.createElementNS(svg.namespaceURI,'defs');defs.append(marker);svg.append(defs);
 for(const e of g.edges){const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',crewLayout.pathD(e));p.setAttribute('marker-end',`url(#${marker.id})`);svg.append(p);}
 const canvas=h('div',{class:'wo-canvas',style:`width:${w}px;height:${height}px`},g.stages.map(st=>h('div',{class:'wo-stage',style:`left:${st.x-box.x+16}px;top:${st.y-box.y+16}px;width:${st.w}px;height:${st.h}px`},h('span',{},T(st.label,st.label_tw||st.label)))),svg,g.edges.filter(e=>e.label).map(e=>h('span',{class:'wo-edge-label',style:`left:${e.label.x-box.x+16}px;top:${e.label.y-box.y+16}px;max-width:${e.label.w}px`,title:e.label.full},e.label.text)),...g.nodes.map(n=>{
 const nt=by.get(n.id)||[],waits=nt.filter(t=>t.since).map(t=>t.since).sort();
 return h('div',{class:'wo-node',style:`left:${n.x-box.x+16}px;top:${n.y-box.y+16}px;width:${n.w}px`,'data-wo-group':n.id},h('div',{class:'wo-node-label'},h('b',{},loc(nodes.get(n.id)?.label)||n.id),h('small',{},nodes.get(n.id)?.kind||'')),nt.length?h('div',{class:'wo-stack'},h('div',{class:'wo-stack-meta'},T(`${nt.length} tasks`,`${nt.length} 個任務`),waits.length?h('span',{'data-oldest-wait':waits[0]},T('Oldest wait ','最久等待 '),ago(waits[0])):null),nt.map(token)):null);
 }));
 const graph=h('div',{class:'wo-frame',tabindex:0,onscroll:e=>{if(e.target.isConnected)scrolls.set(id,{left:e.target.scrollLeft,top:e.target.scrollTop});},'aria-label':T(`${id} workflow graph; scroll to explore`,`${id} 工作流程圖；可捲動查看`)},canvas);
 requestAnimationFrame(()=>{const pos=scrolls.get(id);if(pos&&graph.isConnected)graph.scrollTo(pos.left,pos.top);});
 const list=h('div',{class:'wo-list'},[...by].map(([node,nt])=>h('div',{class:'wo-list-node'},h('b',{},loc(nodes.get(node)?.label)||node),nt.map(token))),rs.filter(r=>!ts.some(t=>t.r.id===r.id)).map(r=>h('a',{class:'wo-unplaced',href:`#/tasks/${encodeURIComponent(r.id)}`},`${r.id} · ${r.title} · `,r.status==='failed'?T('Failed · no recorded current node','失敗 · 沒有記錄目前節點'):T('Awaiting a current node','等待目前節點'))));
 const mode=modes.get(id)||'graph';graph.hidden=mode!=='graph';list.hidden=mode!=='list';
 const toggle=h('button',{class:'btn',type:'button','data-wo-toggle':id,'aria-pressed':String(mode==='list'),onclick:()=>{const m=graph.hidden?'graph':'list';modes.set(id,m);graph.hidden=m!=='graph';list.hidden=m!=='list';toggle.textContent=m==='graph'?T('Show list','顯示清單'):T('Show graph','顯示流程圖');toggle.setAttribute('aria-pressed',String(m==='list'));}},mode==='graph'?T('Show list','顯示清單'):T('Show graph','顯示流程圖'));
 const versions=[...new Set(rs.map(r=>r.version))];
 return h('article',{class:'card wo-workflow','data-wo-workflow':id},h('div',{class:'wo-head'},h('div',{},h('h3',{},loc(def.name)||id),h('p',{class:'faint'},`${id} · ${rs.length} `,T('unresolved Tasks','個尚未解決任務'),versions.length>1?T(' · combined pinned versions',' · 合併顯示固定版本'):'')),toggle),graph,list,rs.some(r=>!ts.some(t=>t.r.id===r.id))?h('p',{class:'wo-note'},T('Some Tasks have no recorded current node; open the list for their details.','部分任務沒有記錄目前節點；請開清單查看。')):null);
}
window.crewWorkflowOverview={render,active,frontiers};
})();
