// Board "Live workflows": the graph must show real graph content on first open, without scrolling.
// The fixture has the built-in code-firstmate topology (28 nodes, its stage boxes, its back edges):
// its canvas is several times the frame in both directions and its top-left corner is empty, so a
// frame opened at 0,0 showed no node at all (captain report, 2026-10-16). One Task waits at the
// scope card, as on the captain's board, plus one failed Task in a second workflow.
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness.ts';
import {freePort,waitUp,withSession} from './boot.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
let pass=0,fail=0;const ok=(v,n,e='')=>{console.log(`${v?'ok':'FAIL'} ${n} ${e}`);v?pass++:fail++;};
const hook=(id,label,out)=>({id,kind:'hook',do:out?'set':'note',label,...(out?{args:{key:'route',value:id,out}}:{})});
const card=(id,label,options)=>({id,kind:'card',label,card:{title:{en:label,'zh-TW':label},options:options.map(o=>({id:o,label:o}))}});
const nodes=[hook('intake','Capture intent'),hook('prepare','Worktree'),hook('spec','Spec','fail'),hook('spec-fix','Refine spec','step-back'),card('dispatch','Dispatch card',['dispatch','rescope','drop']),hook('door','Door'),card('door-pick','Pick the door',['go']),hook('plan','Plan round'),hook('plan-fix','Refine plan'),hook('plan-accept','Accept plan'),hook('build','Build round'),hook('pr-open','Review request'),hook('ci','CI'),hook('review','Fresh reviewer'),hook('fix','Fix'),hook('remote-ready','Remote readiness'),card('merge-card','Merge card',['merge','changes','close']),hook('merge','Merge'),hook('after-merge','After merge'),hook('cleanup','Clean up'),hook('done','Merged'),card('step-back','Step-back card',['other-model','rescope','continue','park']),card('stalled','No-progress card',['rescope','continue','park']),card('budget','Round-budget card',['extend','rescope','park']),card('scope-card','Scope card',['rescope','park']),hook('parked','Parked'),hook('closed','Closed'),hook('dropped','Dropped')];
const edges=[['intake','prepare'],['prepare','spec'],['spec','dispatch','ok'],['spec','spec-fix','fail'],['spec-fix','spec','retry|report'],['spec-fix','dispatch','pass'],['spec-fix','scope-card','step-back|stalled|cap|door-change'],['dispatch','door','dispatch'],['dispatch','spec','rescope'],['dispatch','dropped','drop'],['door','plan','one-way'],['door','build','two-way'],['door','door-pick','undecided'],['door-pick','door'],['plan','plan-accept','ok'],['plan','plan-fix','fail'],['plan-fix','plan','retry|report'],['plan-fix','plan-accept','pass'],['plan-fix','scope-card','step-back|stalled|cap|door-change'],['plan-accept','build','accept'],['plan-accept','plan','revise'],['plan-accept','scope-card','escalate'],['build','pr-open','ok'],['pr-open','ci','ok'],['build','fix','fail'],['build','scope-card','blocked'],['build','door','door-change'],['ci','review','pass'],['ci','fix','fail'],['review','remote-ready','ok'],['remote-ready','build','rebase'],['build','build','rebase-more'],['remote-ready','closed','close'],['remote-ready','fix','fail'],['remote-ready','merge-card','ok'],['review','fix','fail'],['step-back','fix','other-model'],['fix','build','retry|report'],['fix','ci','pass'],['fix','step-back','step-back'],['fix','stalled','stalled'],['fix','budget','cap'],['fix','door','door-change'],['step-back','spec','rescope'],['step-back','build','continue'],['step-back','parked','park'],['stalled','spec','rescope'],['stalled','build','continue'],['stalled','parked','park'],['budget','build','extend'],['budget','spec','rescope'],['budget','parked','park'],['scope-card','spec','rescope'],['scope-card','parked','park'],['merge-card','merge','merge'],['merge-card','fix','changes'],['merge-card','closed','close'],['merge','after-merge'],['after-merge','cleanup'],['cleanup','done']];
const H=await harness([Y({id:'code-firstmate',name:'Code firstmate',roles:[],nodes,edges}),Y({id:'notes',name:'Notes',roles:[],nodes:[{id:'start',kind:'hook',do:'note',label:'Start'},{id:'end',kind:'hook',do:'note',label:'Done'}],edges:[['start','end']]})]);
H.engine.actions.note=x=>{if(x.run.text==='fail')throw new Error('Known fixture failure');return 'ok';};
const a=H.engine.start({workflow:'code-firstmate',text:'a',title:'Scope question on a real-size workflow'}),d=H.engine.start({workflow:'notes',text:'fail',title:'Explicit failure'});
await until(()=>H.engine.get(a.id)?.status==='waiting'&&H.engine.get(d.id)?.status==='failed'&&![a,d].some(r=>H.engine.busy(r.id)));
ok(H.engine.get(a.id)?.nodes?.['scope-card']?.waiting==='card','fixture Task waits at the scope card',JSON.stringify(H.engine.get(a.id)?.status));
H.stop();mkdirSync(join(H.data,'fm','state'),{recursive:true});
const root=join(import.meta.dir,'..'),port=await freePort(),base=`http://127.0.0.1:${port}`;process.env.CREW_SESSION_TOKEN='test-session';
const app=spawn('bun',['src/server.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,CREW_DATA:H.data,CREW_PORT:String(port),CREW_CHAT_PROVIDER:'stub',CREW_GH:'0',CREW_READONLY:'1',CREW_RETRO_AUTO:'0',CREW_SESSION_TOKEN:'test-session',CREW_FM_STATE:join(H.data,'fm','state'),CREW_CLAUDE_BIN:'/nonexistent',CREW_CODEX_BIN:'/nonexistent'}});
const shots=join(root,'tests/out/workflow-overview-fold');mkdirSync(shots,{recursive:true});let browser;
// What the viewer sees without scrolling: graph nodes and Task tokens inside the frame, the scroll area and the viewport.
const seen=p=>p.evaluate(()=>{const art=document.querySelector('[data-wo-workflow="code-firstmate"]'),fr=art?.querySelector('.wo-frame');if(!fr)return {frame:false};
 const f=fr.getBoundingClientRect(),m=document.querySelector('#main').getBoundingClientRect(),c={t:Math.max(f.top,m.top,0),b:Math.min(f.bottom,m.bottom,innerHeight),l:Math.max(f.left,m.left,0),r:Math.min(f.right,m.right,innerWidth)};
 const rects=s=>[...fr.querySelectorAll(s)].map(e=>e.getBoundingClientRect());
 return {frame:true,frameTop:Math.round(f.top),nodes:rects('.wo-node-label').filter(n=>n.top>=c.t&&n.bottom<=c.b&&n.left>=c.l&&n.right<=c.r).length,tokens:rects('.wo-token').filter(n=>n.top>=c.t&&n.bottom<=c.b&&n.left>=c.l&&n.right<=c.r).length,scroll:[fr.scrollLeft,fr.scrollTop]};});
// The captain's board runs with Firstmate attached, so no first-run welcome panel sits above the overview;
// this fixture server has no attached session, so the page is told what an attached one shows (no welcome).
const attached=ctx=>ctx.addInitScript(()=>Object.defineProperty(window,'crewFirstmateWelcome',{configurable:true,get:()=>()=>null,set(){}}));
const open=async(ctx,width)=>{await attached(ctx);const p=await ctx.newPage();await p.goto(`${base}/#/board`);await p.waitForSelector('[data-wo-workflow="code-firstmate"] .wo-frame [data-wo-task]');await p.evaluate(()=>document.body.classList.add('chat-closed'));const hide=p.getByRole('button',{name:'Hide guide'});if(await hide.count())await hide.first().click();await p.waitForTimeout(400);return p;};
try{await waitUp(base,app);browser=withSession(await chromium.launch({headless:true}),base);
for(const [width,height] of [[1280,800],[1440,900]]){
 const ctx=await browser.newContext({viewport:{width,height}}),p=await open(ctx,width),s=await seen(p);await p.screenshot({path:join(shots,`${width}x${height}-first-open.png`)});
 ok(s.frame&&s.frameTop<height,`graph frame starts inside the first viewport at ${width}x${height}`,JSON.stringify(s));
 ok(s.nodes>=1,`graph nodes are visible on first open without scrolling at ${width}x${height}`,JSON.stringify(s));
 ok(s.tokens>=1,`the waiting Task's token is visible on first open at ${width}x${height}`,JSON.stringify(s));
 if(width===1280){
  // a viewer's own scroll still wins over the first-open focus across live re-renders
  await p.locator('[data-wo-workflow="code-firstmate"] .wo-frame').evaluate(e=>{e.scrollLeft=7;e.scrollTop=5;});await p.waitForTimeout(150);
  await p.evaluate(()=>setLang('zh-TW'));await p.waitForTimeout(300);const kept=await seen(p);ok(kept.scroll[0]===7&&kept.scroll[1]===5,'a re-render keeps the viewer scroll',JSON.stringify(kept));await p.evaluate(()=>setLang('en'));
  // the graph/list choice is remembered per viewer, in this browser only
  await p.locator('[data-wo-toggle="code-firstmate"]').click();await p.reload();await p.waitForSelector('[data-wo-workflow="code-firstmate"]');
  ok(await p.locator('[data-wo-workflow="code-firstmate"] .wo-list').isVisible()&&!await p.locator('[data-wo-workflow="code-firstmate"] .wo-frame').isVisible(),'list choice survives a reload');
  await p.locator('[data-wo-toggle="code-firstmate"]').click();await p.waitForTimeout(300);const back=await seen(p);await p.screenshot({path:join(shots,'1280x800-back-to-graph.png')});ok(back.nodes>=1&&back.tokens>=1,'back to graph opens on the current node',JSON.stringify(back));
  await p.reload();await p.waitForSelector('[data-wo-workflow="code-firstmate"]');ok(await p.locator('[data-wo-workflow="code-firstmate"] .wo-frame').isVisible(),'graph choice survives a reload');
 }
 await ctx.close();
}
{ // phone: the frame starts in the first viewport and shows graph content; the token is reached by scrolling the page only
 const ctx=await browser.newContext({viewport:{width:390,height:844}}),p=await open(ctx,390),s=await seen(p);await p.screenshot({path:join(shots,'390x844-first-open.png')});
 ok(s.frame&&s.frameTop<844&&s.nodes>=1,'phone graph frame starts inside the first viewport and shows the current node',JSON.stringify(s));
 await p.locator('[data-wo-workflow="code-firstmate"] .wo-frame').evaluate(e=>e.scrollIntoView({block:'start'}));await p.waitForTimeout(150);const t=await seen(p);await p.screenshot({path:join(shots,'390x844-frame.png')});
 ok(t.nodes>=1&&t.tokens>=1,'phone frame opens on the current node',JSON.stringify(t));
 ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone page has no sideways scroll');
 await ctx.close();
}
{ // storage that throws (private window, blocked site data) must not break the overview
 const ctx=await browser.newContext({viewport:{width:1280,height:800}});await ctx.addInitScript(()=>{for(const k of ['getItem','setItem'])Storage.prototype[k]=function(){throw new Error('blocked storage');};});
 const p=await open(ctx,1280),s=await seen(p);ok(s.nodes>=1&&s.tokens>=1,'graph opens on the current node with storage blocked',JSON.stringify(s));
 await p.locator('[data-wo-toggle="code-firstmate"]').click();ok(await p.locator('[data-wo-workflow="code-firstmate"] .wo-list').isVisible(),'toggle still works with storage blocked');
 await ctx.close();
}
}finally{await browser?.close();app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));}
console.log(`workflow-overview-fold-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
