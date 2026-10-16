// Board "Live workflows": the graph must show real graph content on first open, without scrolling.
// The fixture has the built-in code-firstmate topology (28 nodes, its stage boxes, its back edges):
// its canvas is several times the frame in both directions and its top-left corner is empty, so a
// frame opened at 0,0 showed no node at all (captain report, 2026-10-16). Three Tasks wait on
// different nodes (dispatch is the topmost, then leftmost). Until the viewer scrolls, the frame
// follows the current node, also through partial renders and live moves; a graph that already fits
// its frame stays at 0,0 with no added room.
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness.ts';
import {freePort,waitUp,withSession} from './boot.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
let pass=0,fail=0;const ok=(v,n,e='')=>{console.log(`${v?'ok':'FAIL'} ${n} ${e}`);v?pass++:fail++;};
const hook=(id,label)=>({id,kind:'hook',do:'route',label});
const card=(id,label,options)=>({id,kind:'card',label,card:{title:{en:label,'zh-TW':label},options:options.map(o=>({id:o,label:o}))}});
const nodes=[hook('intake','Capture intent'),hook('prepare','Worktree'),hook('spec','Spec'),hook('spec-fix','Refine spec'),card('dispatch','Dispatch card',['dispatch','rescope','drop']),hook('door','Door'),card('door-pick','Pick the door',['go']),hook('plan','Plan round'),hook('plan-fix','Refine plan'),hook('plan-accept','Accept plan'),hook('build','Build round'),hook('pr-open','Review request'),hook('ci','CI'),hook('review','Fresh reviewer'),hook('fix','Fix'),hook('remote-ready','Remote readiness'),card('merge-card','Merge card',['merge','changes','close']),hook('merge','Merge'),hook('after-merge','After merge'),hook('cleanup','Clean up'),hook('done','Merged'),card('step-back','Step-back card',['other-model','rescope','continue','park']),card('stalled','No-progress card',['rescope','continue','park']),card('budget','Round-budget card',['extend','rescope','park']),card('scope-card','Scope card',['rescope','park']),hook('parked','Parked'),hook('closed','Closed'),hook('dropped','Dropped')];
const edges=[['intake','prepare'],['prepare','spec'],['spec','dispatch','ok'],['spec','spec-fix','fail'],['spec-fix','spec','retry|report'],['spec-fix','dispatch','pass'],['spec-fix','scope-card','step-back|stalled|cap|door-change'],['dispatch','door','dispatch'],['dispatch','spec','rescope'],['dispatch','dropped','drop'],['door','plan','one-way'],['door','build','two-way'],['door','door-pick','undecided'],['door-pick','door'],['plan','plan-accept','ok'],['plan','plan-fix','fail'],['plan-fix','plan','retry|report'],['plan-fix','plan-accept','pass'],['plan-fix','scope-card','step-back|stalled|cap|door-change'],['plan-accept','build','accept'],['plan-accept','plan','revise'],['plan-accept','scope-card','escalate'],['build','pr-open','ok'],['pr-open','ci','ok'],['build','fix','fail'],['build','scope-card','blocked'],['build','door','door-change'],['ci','review','pass'],['ci','fix','fail'],['review','remote-ready','ok'],['remote-ready','build','rebase'],['build','build','rebase-more'],['remote-ready','closed','close'],['remote-ready','fix','fail'],['remote-ready','merge-card','ok'],['review','fix','fail'],['step-back','fix','other-model'],['fix','build','retry|report'],['fix','ci','pass'],['fix','step-back','step-back'],['fix','stalled','stalled'],['fix','budget','cap'],['fix','door','door-change'],['step-back','spec','rescope'],['step-back','build','continue'],['step-back','parked','park'],['stalled','spec','rescope'],['stalled','build','continue'],['stalled','parked','park'],['budget','build','extend'],['budget','spec','rescope'],['budget','parked','park'],['scope-card','spec','rescope'],['scope-card','parked','park'],['merge-card','merge','merge'],['merge-card','fix','changes'],['merge-card','closed','close'],['merge','after-merge'],['after-merge','cleanup'],['cleanup','done']];
// zlive: a wide chain of cards for live moves (q6 jumps to q10); fan: a small graph that fits its frame.
const chain=[...Array(13).keys()].map(n=>card('q'+n,'Step '+n,['go','jump']));
const zlive={id:'zlive',name:'Live chain',roles:[],nodes:[hook('start','Start'),...chain],edges:[['start','q0'],...chain.slice(1).map((c,n)=>['q'+n,c.id,'go']),['q6','q10','jump']]};
const fan={id:'fan',name:'Fan',roles:[],nodes:[hook('start','Start'),card('b1','Branch 1',['go']),card('b2','Branch 2',['go']),card('b3','Branch 3',['go']),hook('end','Done')],edges:[['start','b1'],['start','b2'],['start','b3'],['b1','end','go'],['b2','end','go'],['b3','end','go']]};
const H=await harness([Y({id:'code-firstmate',name:'Code firstmate',roles:[],nodes,edges}),Y({id:'notes',name:'Notes',roles:[],nodes:[{id:'start',kind:'hook',do:'note',label:'Start'},{id:'end',kind:'hook',do:'note',label:'Done'}],edges:[['start','end']]})]);
const ROUTES={scope:{spec:'fail','spec-fix':'step-back'},merge:{door:'two-way',ci:'pass'}};
H.engine.actions.route=x=>ROUTES[x.run.text]?.[x.node.id]??'ok';
H.engine.actions.note=x=>{if(x.run.text==='fail')throw new Error('Known fixture failure');return 'ok';};
// zlive and fan run on a second server, so the first keeps a realistic Needs-you list above the overview.
const H2=await harness([Y(zlive),Y(fan)]);H2.engine.actions.route=()=>'ok';
const settled=(r,E=H.engine)=>!E.busy(r.id)&&['waiting','failed'].includes(E.get(r.id)?.status);
const openCard=(r,node,E=H.engine)=>E.cards.list({run:r.id,open:true}).find(c=>c.node===node);
const a=H.engine.start({workflow:'code-firstmate',text:'scope',title:'Scope question on a real-size workflow'}),top=H.engine.start({workflow:'code-firstmate',text:'dispatch',title:'Dispatch waits'}),late=H.engine.start({workflow:'code-firstmate',text:'merge',title:'Merge waits'}),d=H.engine.start({workflow:'notes',text:'fail',title:'Explicit failure'});
const zl=H2.engine.start({workflow:'zlive',text:'zl',title:'Live mover'}),fa=H2.engine.start({workflow:'fan',text:'fan',title:'Fan waits'});
await until(()=>[a,top,late,d].every(r=>settled(r))&&[zl,fa].every(r=>settled(r,H2.engine)));
await H.engine.answer(openCard(late,'dispatch').id,{choice:'dispatch',by:'captain'});await until(()=>!!openCard(late,'merge-card'));
for(let n=0;n<6;n++){await H2.engine.answer(openCard(zl,'q'+n,H2.engine).id,{choice:'go',by:'captain'});await until(()=>!!openCard(zl,'q'+(n+1),H2.engine));}
await until(()=>settled(late)&&settled(zl,H2.engine));
ok(!!openCard(a,'scope-card')&&!!openCard(top,'dispatch')&&!!openCard(late,'merge-card')&&!!openCard(zl,'q6',H2.engine)&&H2.engine.cards.list({run:fa.id,open:true}).length===3,'fixture Tasks wait at scope-card, dispatch, merge-card, q6 and three fan branches');
const root=join(import.meta.dir,'..');process.env.CREW_SESSION_TOKEN='test-session';
const serve=async H=>{H.stop();mkdirSync(join(H.data,'fm','state'),{recursive:true});const port=await freePort();
 const app=spawn('bun',['src/server.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,CREW_DATA:H.data,CREW_PORT:String(port),CREW_CHAT_PROVIDER:'stub',CREW_GH:'0',CREW_READONLY:'1',CREW_RETRO_AUTO:'0',CREW_SESSION_TOKEN:'test-session',CREW_FM_STATE:join(H.data,'fm','state'),CREW_CLAUDE_BIN:'/nonexistent',CREW_CODEX_BIN:'/nonexistent'}});
 return {app,base:`http://127.0.0.1:${port}`};};
const one=await serve(H),two=await serve(H2),base=one.base,app=one.app;
const shots=join(root,'tests/out/workflow-overview-fold');mkdirSync(shots,{recursive:true});let browser;
// What the viewer sees without scrolling: graph nodes and Task tokens inside the frame, the scroll area and the viewport.
const seen=(p,wf='code-firstmate',task=top.id)=>p.evaluate(({wf,task})=>{const art=document.querySelector(`[data-wo-workflow="${wf}"]`),fr=art?.querySelector('.wo-frame');if(!fr)return {frame:false};
 const f=fr.getBoundingClientRect(),m=document.querySelector('#main').getBoundingClientRect(),c={t:Math.max(f.top,m.top,0),b:Math.min(f.bottom,m.bottom,innerHeight),l:Math.max(f.left,m.left,0),r:Math.min(f.right,m.right,innerWidth)};
 const rects=s=>[...fr.querySelectorAll(s)].map(e=>e.getBoundingClientRect());
 return {frame:true,frameTop:Math.round(f.top),nodes:rects('.wo-node-label').filter(n=>n.top>=c.t&&n.bottom<=c.b&&n.left>=c.l&&n.right<=c.r).length,tokens:rects('.wo-token').filter(n=>n.top>=c.t&&n.bottom<=c.b&&n.left>=c.l&&n.right<=c.r).length,scroll:[fr.scrollLeft,fr.scrollTop],want:rects(`.wo-token[data-wo-task="${task}"]`).some(n=>n.top>=c.t&&n.bottom<=c.b&&n.left>=c.l&&n.right<=c.r),inFrame:rects(`.wo-token[data-wo-task="${task}"]`).some(n=>n.top>=f.top&&n.bottom<=f.bottom&&n.left>=f.left&&n.right<=f.right),margin:fr.querySelector('.wo-canvas').style.marginBottom||'',fits:fr.scrollWidth<=fr.clientWidth&&fr.scrollHeight<=fr.clientHeight};},{wf,task});
// The captain's board runs with Firstmate attached, so no first-run welcome panel sits above the overview;
// this fixture server has no attached session, so the page is told what an attached one shows (no welcome).
const attached=ctx=>ctx.addInitScript(()=>Object.defineProperty(window,'crewFirstmateWelcome',{configurable:true,get:()=>()=>null,set(){}}));
const open=async(ctx,width,b=base,wf='code-firstmate')=>{await attached(ctx);const p=await ctx.newPage();await p.goto(`${b}/#/board`);await p.waitForSelector(`[data-wo-workflow="${wf}"] .wo-frame [data-wo-task]`);await p.evaluate(()=>document.body.classList.add('chat-closed'));const hide=p.getByRole('button',{name:'Hide guide'});if(await hide.count())await hide.first().click();await p.waitForTimeout(400);return p;};
try{await waitUp(base,app);await waitUp(two.base,two.app);browser=withSession(await chromium.launch({headless:true}),base);
for(const [width,height] of [[1280,800],[1440,900]]){
 const ctx=await browser.newContext({viewport:{width,height}}),p=await open(ctx,width),s=await seen(p);await p.screenshot({path:join(shots,`${width}x${height}-first-open.png`)});
 ok(s.frame&&s.frameTop<height,`graph frame starts inside the first viewport at ${width}x${height}`,JSON.stringify(s));
 ok(s.nodes>=1,`graph nodes are visible on first open without scrolling at ${width}x${height}`,JSON.stringify(s));
 ok(s.want,`the topmost waiting Task's token (dispatch, of three Tasks) is visible on first open at ${width}x${height}`,JSON.stringify(s));
 if(width===1280){
  // a viewer's own scroll still wins over the first-open focus across live re-renders
  await p.locator('[data-wo-workflow="code-firstmate"] .wo-frame').evaluate(e=>{e.scrollLeft=7;e.scrollTop=5;});await p.waitForTimeout(150);
  await p.evaluate(()=>setLang('zh-TW'));await p.waitForTimeout(300);const kept=await seen(p);ok(kept.scroll[0]===7&&kept.scroll[1]===5,'a re-render keeps the viewer scroll',JSON.stringify(kept));await p.evaluate(()=>setLang('en'));
  // the graph/list choice is remembered per viewer, in this browser only
  await p.locator('[data-wo-toggle="code-firstmate"]').click();await p.reload();await p.waitForSelector('[data-wo-workflow="code-firstmate"]');
  ok(await p.locator('[data-wo-workflow="code-firstmate"] .wo-list').isVisible()&&!await p.locator('[data-wo-workflow="code-firstmate"] .wo-frame').isVisible(),'list choice survives a reload');
  await p.locator('[data-wo-toggle="code-firstmate"]').click();await p.waitForTimeout(300);const back=await seen(p);await p.screenshot({path:join(shots,'1280x800-back-to-graph.png')});ok(back.nodes>=1&&back.want,'back to graph opens on the current node',JSON.stringify(back));
  await p.reload();await p.waitForSelector('[data-wo-workflow="code-firstmate"]');ok(await p.locator('[data-wo-workflow="code-firstmate"] .wo-frame').isVisible(),'graph choice survives a reload');
 }
 await ctx.close();
}
{ // phone: the frame starts in the first viewport (three Needs-you rows above it); the token is reached by scrolling the page only
 const ctx=await browser.newContext({viewport:{width:390,height:844}}),p=await open(ctx,390),s=await seen(p);await p.screenshot({path:join(shots,'390x844-first-open.png')});
 ok(s.frame&&s.frameTop<844,'phone graph frame starts inside the first viewport',JSON.stringify(s));
 await p.locator('[data-wo-workflow="code-firstmate"] .wo-frame').evaluate(e=>e.scrollIntoView({block:'start'}));await p.waitForTimeout(150);const t=await seen(p);await p.screenshot({path:join(shots,'390x844-frame.png')});
 ok(t.nodes>=1&&t.want,'phone frame opens on the current node',JSON.stringify(t));
 ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone page has no sideways scroll');
 await ctx.close();
}
{ // storage that throws (private window, blocked site data) must not break the overview
 const ctx=await browser.newContext({viewport:{width:1280,height:800}});await ctx.addInitScript(()=>{for(const k of ['getItem','setItem'])Storage.prototype[k]=function(){throw new Error('blocked storage');};});
 const p=await open(ctx,1280),s=await seen(p);ok(s.nodes>=1&&s.want,'graph opens on the current node with storage blocked',JSON.stringify(s));
 await p.locator('[data-wo-toggle="code-firstmate"]').click();ok(await p.locator('[data-wo-workflow="code-firstmate"] .wo-list').isVisible(),'toggle still works with storage blocked');
 await ctx.close();
}
{ // a graph that already fits its frame stays at 0,0 with no added room
 const ctx=await browser.newContext({viewport:{width:1280,height:800}}),p=await open(ctx,1280,two.base,'fan');await p.locator('[data-wo-workflow="fan"] .wo-frame').scrollIntoViewIfNeeded();await p.waitForTimeout(200);
 const s=await seen(p,'fan',fa.id);ok(s.scroll[0]===0&&s.scroll[1]===0&&!s.margin&&s.inFrame,'a graph that fits its frame opens at 0,0 with no margin',JSON.stringify(s));
 await ctx.close();
}
{ // partial-load race: a first render with one Task (bottom-most) then the full three must land on the topmost
 const ctx=await browser.newContext({viewport:{width:1280,height:800}}),p=await open(ctx,1280);
 const r=await p.evaluate(async({ids,topId})=>{
  const runs=await Promise.all(ids.map(id=>fetch('/api/tasks/'+id).then(x=>x.json()))),cards=(await fetch('/api/scards?open=1').then(x=>x.json())).cards;
  for(const run of runs)run.workflow='race-probe';
  const box=document.createElement('div');box.style.cssText='position:absolute;left:0;top:0;width:700px;z-index:99;background:var(--bg)';document.body.append(box);
  const frames=()=>new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(res,120))));
  box.replaceChildren(crewWorkflowOverview.render([runs[0]],cards));await frames();
  const first=box.querySelector('.wo-frame');first.dispatchEvent(new Event('scroll'));await frames();
  box.replaceChildren(crewWorkflowOverview.render(runs,cards));await frames();
  const fr=box.querySelector('.wo-frame'),f=fr.getBoundingClientRect(),t=box.querySelector(`.wo-frame .wo-token[data-wo-task="${topId}"]`)?.getBoundingClientRect();
  const visible=!!t&&t.top>=f.top&&t.bottom<=f.bottom&&t.left>=f.left&&t.right<=f.right;const out={visible,scroll:[fr.scrollLeft,fr.scrollTop],frame:[fr.clientWidth,fr.clientHeight],token:t&&[Math.round(t.left-f.left),Math.round(t.top-f.top)]};box.remove();return out;
 },{ids:[a.id,late.id,top.id],topId:top.id});
 ok(r.visible,'after a partial first render the frame follows the topmost Task',JSON.stringify(r));
 await ctx.close();
}
{ // live move: an untouched frame follows the Task; a frame the viewer scrolled keeps its place
 const ca=await browser.newContext({viewport:{width:1280,height:800}}),pa=await open(ca,1280,two.base,'zlive'),cb=await browser.newContext({viewport:{width:1280,height:800}}),pb=await open(cb,1280,two.base,'zlive');
 for(const p of [pa,pb])await p.locator('[data-wo-workflow="zlive"] .wo-frame').scrollIntoViewIfNeeded();
 const before=await seen(pa,'zlive',zl.id);ok(before.inFrame,'live chain frame opens on q6',JSON.stringify(before));
 const fb=pb.locator('[data-wo-workflow="zlive"] .wo-frame'),box=await fb.boundingBox();await pb.mouse.move(box.x+box.width/2,box.y+box.height/2);await pb.mouse.wheel(-160,0);await pb.waitForTimeout(300);
 const mine=(await seen(pb,'zlive',zl.id)).scroll;
 const q6=await pa.evaluate(async run=>(await fetch('/api/scards?open=1').then(x=>x.json())).cards.find(c=>c.run===run&&c.node==='q6')?.id,zl.id);
 const answered=await pa.evaluate(async id=>(await fetch(`/api/scards/${id}/answer`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({choice:'jump',by:'captain'})})).status,q6);ok(answered===200,'answer q6 with jump through the real server',String(answered));
 for(const p of [pa,pb])await p.waitForSelector(`[data-wo-workflow="zlive"] .wo-frame [data-wo-task="${zl.id}"][data-wo-node="q10"]`);await pa.waitForTimeout(300);await pb.waitForTimeout(300);
 const after=await seen(pa,'zlive',zl.id);await pa.screenshot({path:join(shots,'1280x800-live-follow.png')});ok(after.inFrame,'an untouched frame follows the Task from q6 to q10',JSON.stringify({before,after}));
 const kept=await seen(pb,'zlive',zl.id);ok(kept.scroll[0]===mine[0]&&kept.scroll[1]===mine[1],'a frame the viewer scrolled keeps its position through the live move',JSON.stringify({mine,kept}));
 await ca.close();await cb.close();
}
}finally{await browser?.close();for(const s of [one,two]){s.app.kill();await new Promise(r=>s.app.exitCode!==null?r():s.app.once('exit',r));}}
console.log(`workflow-overview-fold-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
