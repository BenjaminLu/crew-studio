import {revealEditorControl} from './reveal-editor-control.mjs';
// The caller created this workflow through the real New workflow dialog.
export async function verifyNodeDeletion(p, {ok,lang,tag}) {
 const close=async()=>{if(await p.locator('[data-inspector-close]').isVisible())await p.locator('[data-inspector-close]').click();};
 const fit=async()=>{await close();await revealEditorControl(p,'[data-fit]');await p.locator('[data-fit]').click();};
 const select=async id=>{await fit();await p.locator(`[data-node="${id}"]`).click();};
 const nextDef=()=>p.waitForRequest(r=>r.url().endsWith('/api/wf/validate')&&r.method()==='POST').then(r=>r.postDataJSON().def);
 const connect=async(a,b,when)=>{await select(a);await p.getByRole('combobox',{name:lang==='en'?'Connect to':'連到',exact:true}).selectOption(b);await p.getByRole('textbox',{name:lang==='en'?'Edge outcome':'邊的結果',exact:true}).fill(when);const pending=nextDef();await p.locator('[data-connect]').click();return pending;};
 await fit();await p.locator('[data-view-toggle="detail"]').click();await p.locator('[data-add="hook"]').click();await fit();await p.locator('[data-edge="hook→done"] [data-edge-hit]').click();await p.locator('[data-del-edge]').click();await connect('hook','hook-2','next');await connect('hook-2','done','end');
 let baseline;
 for(const id of ['hook','hook-2']){await select(id);await p.locator('[data-field="label"]').fill('Same label');const pending=nextDef();await p.locator('[data-field="label"]').press('Tab');baseline=await pending;}
 const ids=xs=>xs.map(n=>typeof n==='string'?n:n.id).sort(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),modifier=process.platform==='darwin'?'Meta':'Control';
 for(const view of ['simple','detail']) for(const removed of ['hook','start','done']) {
  await fit();await p.locator(`[data-view-toggle="${view}"]`).click();await select(removed);const deleted=nextDef();await p.locator(`[data-del-node="${removed}"]`).click();const after=await deleted;
  const expectedNodes=baseline.nodes.filter(n=>n.id!==removed),expectedEdges=baseline.edges.filter(e=>e.from!==removed&&e.to!==removed);
  ok(same(after.nodes,expectedNodes)&&same(after.edges,expectedEdges),`single ${removed} deletion preserves exact other IDs/settings and only removes incident edges ${view} ${tag}`);
  const visible=await p.locator('[data-node]').evaluateAll(xs=>xs.map(x=>x.dataset.node).sort());ok(same(visible,ids(expectedNodes)),`remaining disconnected nodes stay visible in ${view} after deleting ${removed} ${tag}`);
  const clipped=await p.locator('svg.rt-graph').evaluate(svg=>{const frame=svg.getBoundingClientRect();return [...svg.querySelectorAll('[data-node]')].filter(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return x<frame.x||x>frame.right||y<frame.y||y>frame.bottom;}).map(el=>el.dataset.node);});
  ok(clipped.length===0,`surviving nodes are actually inside the canvas after deletion ${view}/${removed} ${tag}`,JSON.stringify(clipped));
  // Native selection must still reach every surviving node, including repeated labels.
  for(const node of expectedNodes){await select(node.id);ok(await p.locator(`[data-del-node="${node.id}"]`).isVisible(),`remaining ${node.id} is selectable for repair ${view} ${tag}`);}
  await close();const undo=nextDef();await p.keyboard.press(modifier+'+z');const restored=await undo;ok(same(restored.nodes,baseline.nodes)&&same(restored.edges,baseline.edges)&&same(restored.roles,baseline.roles),`Undo restores exact nodes, edges and settings ${view}/${removed} ${tag}`);
  const redo=nextDef();await p.keyboard.press(modifier+'+Shift+z');const repeated=await redo;ok(same(repeated.nodes,expectedNodes)&&same(repeated.edges,expectedEdges),`Redo deletes only the same node ${view}/${removed} ${tag}`);
  const finalUndo=nextDef();await p.keyboard.press(modifier+'+z');await finalUndo;
 }
 // Keyboard Delete has the same exact-ID behavior, without manual graph mutation.
 await fit();await p.locator('[data-view-toggle="detail"]').click();await select('hook-2');await close();await p.locator('[data-node="hook-2"]').focus();const deleted=nextDef();await p.keyboard.press('Delete');const after=await deleted;
 ok(same(ids(after.nodes),ids(baseline.nodes.filter(n=>n.id!=='hook-2')))&&same(after.edges,baseline.edges.filter(e=>e.from!=='hook-2'&&e.to!=='hook-2')),`native keyboard Delete preserves every neighboring node ${tag}`);
 const undo=nextDef();await p.keyboard.press(modifier+'+z');await undo;
 for(const view of ['simple','detail']){await fit();await p.locator(`[data-view-toggle="${view}"]`).click();let remaining=[...baseline.nodes];
  for(const node of [...baseline.nodes].reverse()){await select(node.id);const deleted=nextDef();await p.locator(`[data-del-node="${node.id}"]`).click();await deleted;remaining=remaining.filter(n=>n.id!==node.id);ok(same(await p.locator('[data-node]').evaluateAll(xs=>xs.map(x=>x.dataset.node).sort()),ids(remaining)),`sequential deletion through the final node stays truthful ${view}/${node.id} ${tag}`);}
  const bounds=await p.locator('svg.rt-graph').getAttribute('viewBox');ok(bounds.split(' ').map(Number).every(Number.isFinite)&&await p.locator('[data-editor-undo]').isEnabled(),`empty ${view} graph remains finite and undoable ${tag}`);
  for(const node of baseline.nodes){const pending=nextDef();await p.keyboard.press(modifier+'+z');await pending;}
  ok(same(await p.locator('[data-node]').evaluateAll(xs=>xs.map(x=>x.dataset.node).sort()),ids(baseline.nodes)),`Undo restores every node after emptying ${view} ${tag}`);
 }
}

// Existing close/closed branches must be visible before deletion, not suddenly
// promoted from the run-summary projection after an unrelated step disappears.
export async function verifyCloseBranchDeletion(p, base, ok) {
 await p.goto(`${base}/#/workflows/trivial-lane`);await p.locator('svg.rt-graph').waitFor();await p.locator('[data-view-toggle="simple"]').click();
 const before=(await (await p.request.get(`${base}/api/wf/trivial-lane`)).json()).def,sorted=xs=>[...xs].sort(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const shown=()=>p.locator('svg.rt-graph [data-node]').evaluateAll(xs=>xs.map(x=>x.dataset.node));
 const initial=await shown();ok(same(sorted(initial),sorted(before.nodes.map(n=>n.id)))&&initial.includes('close')&&initial.includes('closed'),'editor Overview shows actual close branches before any deletion',JSON.stringify(initial));
 const next=()=>p.waitForRequest(r=>r.url().endsWith('/api/wf/validate')&&r.method()==='POST').then(r=>r.postDataJSON().def),modifier=process.platform==='darwin'?'Meta':'Control';
 for(const target of ['done','merge','recipe','approve']){
  if(await p.locator('[data-inspector-close]').isVisible())await p.locator('[data-inspector-close]').click();await revealEditorControl(p,'[data-fit]');await p.locator('[data-fit]').click();
  const visibleBefore=await shown();await p.locator(`[data-node="${target}"]`).click();const pending=next();await p.locator(`[data-del-node="${target}"]`).click();const after=await pending,expectedNodes=before.nodes.filter(n=>n.id!==target),expectedEdges=before.edges.filter(e=>e.from!==target&&e.to!==target);
  ok(same(after.nodes,expectedNodes)&&same(after.edges,expectedEdges)&&same(after.roles,before.roles),`deleting ${target} changes only its exact object and incident edges; no node or reconnection added`);
  const visibleAfter=await shown();ok(same(sorted(visibleAfter),sorted(visibleBefore.filter(id=>id!==target)))&&same(sorted(visibleAfter),sorted(expectedNodes.map(n=>n.id))),`deleting ${target} neither introduces close nor removes any other visual node`,JSON.stringify({visibleBefore,visibleAfter}));
  const undo=next();await p.keyboard.press(modifier+'+z');const restored=await undo;ok(same(restored.nodes,before.nodes)&&same(restored.edges,before.edges)&&same(sorted(await shown()),sorted(initial)),`Undo ${target} restores exact data and original visible IDs`);
 }
}
