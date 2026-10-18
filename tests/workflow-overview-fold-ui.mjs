import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Board above the fold, on real-size workflows. The Board once drew a graph per workflow, and on the built-in
// code-firstmate topology (28 nodes, stage boxes, back edges) a frame opened at 0,0 showed no node at all (captain
// report, 2026-10-16). The Board is now a task overview (docs/units/board.md round 6): the task rows and the
// waiting Task's link to its card are in the first viewport; each row's milestone track follows the definition's
// stages (code-firstmate) or its main path (a long chain of cards); a live move updates the row while a viewer's own
// scroll and selection stay; storage that throws does not break the page. Three code-firstmate Tasks wait on
// scope-card, dispatch and merge-card; a chain Task waits at q6 and jumps to q10; a fan Task waits at three branches.
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness.ts';
import {freePort,waitUp,withSession} from './boot.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
let pass=0,fail=0;const ok=(v,n,e='')=>{console.log(`${v?'ok':'FAIL'} ${n} ${e}`);v?pass++:fail++;};
const hook=(id,label)=>({id,kind:'hook',do:'route',label});
const card=(id,label,options)=>({id,kind:'card',label,card:{title:{en:label,'zh-TW':label},body:{en:'A fixture card: pick an option.','zh-TW':'測試用卡片：請選一個選項。'},options:options.map(o=>({id:o,label:o,labelZh:o,...(['rescope','changes'].includes(o)?{note:true}:{})}))}});
const nodes=[hook('intake','Capture intent'),hook('prepare','Worktree'),hook('spec','Spec'),hook('spec-fix','Refine spec'),card('dispatch','Dispatch card',['dispatch','rescope','drop']),hook('door','Door'),card('door-pick','Pick the door',['go']),hook('plan','Plan round'),hook('plan-fix','Refine plan'),hook('plan-accept','Accept plan'),hook('build','Build round'),hook('pr-open','Review request'),hook('ci','CI'),hook('review','Fresh reviewer'),hook('fix','Fix'),hook('remote-ready','Remote readiness'),card('merge-card','Merge card',['merge','changes','close']),hook('merge','Merge'),hook('after-merge','After merge'),hook('cleanup','Clean up'),hook('done','Merged'),card('step-back','Step-back card',['other-model','rescope','continue','park']),card('stalled','No-progress card',['rescope','continue','park']),card('budget','Round-budget card',['extend','rescope','park']),card('scope-card','Scope card',['rescope','park']),hook('parked','Parked'),hook('closed','Closed'),hook('dropped','Dropped')];
const edges=[['intake','prepare'],['prepare','spec'],['spec','dispatch','ok'],['spec','spec-fix','fail'],['spec-fix','spec','retry|report'],['spec-fix','dispatch','pass'],['spec-fix','scope-card','step-back|stalled|cap|door-change'],['dispatch','door','dispatch'],['dispatch','spec','rescope'],['dispatch','dropped','drop'],['door','plan','one-way'],['door','build','two-way'],['door','door-pick','undecided'],['door-pick','door'],['plan','plan-accept','ok'],['plan','plan-fix','fail'],['plan-fix','plan','retry|report'],['plan-fix','plan-accept','pass'],['plan-fix','scope-card','step-back|stalled|cap|door-change'],['plan-accept','build','accept'],['plan-accept','plan','revise'],['plan-accept','scope-card','escalate'],['build','pr-open','ok'],['pr-open','ci','ok'],['build','fix','fail'],['build','scope-card','blocked'],['build','door','door-change'],['ci','review','pass'],['ci','fix','fail'],['review','remote-ready','ok'],['remote-ready','build','rebase'],['build','build','rebase-more'],['remote-ready','closed','close'],['remote-ready','fix','fail'],['remote-ready','merge-card','ok'],['review','fix','fail'],['step-back','fix','other-model'],['fix','build','retry|report'],['fix','ci','pass'],['fix','step-back','step-back'],['fix','stalled','stalled'],['fix','budget','cap'],['fix','door','door-change'],['step-back','spec','rescope'],['step-back','build','continue'],['step-back','parked','park'],['stalled','spec','rescope'],['stalled','build','continue'],['stalled','parked','park'],['budget','build','extend'],['budget','spec','rescope'],['budget','parked','park'],['scope-card','spec','rescope'],['scope-card','parked','park'],['merge-card','merge','merge'],['merge-card','fix','changes'],['merge-card','closed','close'],['merge','after-merge'],['after-merge','cleanup'],['cleanup','done']];
// zlive: a wide chain of cards for live moves (q6 jumps to q10); fan: a small graph that fits its frame.
const chain=[...Array(13).keys()].map(n=>card('q'+n,'Step '+n,['go','jump']));
const zlive={id:'zlive',name:'Live chain',roles:[],nodes:[hook('start','Start'),...chain],edges:[['start','q0'],...chain.slice(1).map((c,n)=>['q'+n,c.id,'go']),['q6','q10','jump']]};
const fan={id:'fan',name:'Fan',roles:[],nodes:[hook('start','Start'),card('b1','Branch 1',['go']),card('b2','Branch 2',['go']),card('b3','Branch 3',['go']),hook('end','Done')],edges:[['start','b1'],['start','b2'],['start','b3'],['b1','end','go'],['b2','end','go'],['b3','end','go']]};
const H=await harness([Y({id:'code-firstmate',name:'Code firstmate',roles:[],nodes,edges})]);
const ROUTES={scope:{spec:'fail','spec-fix':'step-back'},merge:{door:'two-way',ci:'pass'}};
H.engine.actions.route=x=>ROUTES[x.run.text]?.[x.node.id]??'ok';
// zlive and fan run on a second server, so the first holds exactly the three code-firstmate Tasks waiting on cards.
const H2=await harness([Y(zlive),Y(fan)]);H2.engine.actions.route=()=>'ok';
const settled=(r,E=H.engine)=>!E.busy(r.id)&&['waiting','failed'].includes(E.get(r.id)?.status);
const openCard=(r,node,E=H.engine)=>E.cards.list({run:r.id,open:true}).find(c=>c.node===node);
const a=H.engine.start({workflow:'code-firstmate',text:'scope',title:'Scope question on a real-size workflow'}),top=H.engine.start({workflow:'code-firstmate',text:'dispatch',title:'Dispatch waits'}),late=H.engine.start({workflow:'code-firstmate',text:'merge',title:'Merge waits'});
const zl=H2.engine.start({workflow:'zlive',text:'zl',title:'Live mover'}),fa=H2.engine.start({workflow:'fan',text:'fan',title:'Fan waits'});
await until(()=>[a,top,late].every(r=>settled(r))&&[zl,fa].every(r=>settled(r,H2.engine)));
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
// What the viewer sees without scrolling: the Task rows inside #main and the viewport.
const seen=(p,task=top.id)=>p.evaluate(task=>{const m=document.querySelector('#main').getBoundingClientRect(),c={t:Math.max(m.top,0),b:Math.min(m.bottom,innerHeight)};
 const inView=e=>{const r=e.getBoundingClientRect();return r.top>=c.t&&r.bottom<=c.b&&r.left>=0&&r.right<=innerWidth;};
 const row=document.querySelector(`[data-task="${task}"]`),list=document.querySelector('.tb-list');
 return {list:!!list,listTop:list?Math.round(list.getBoundingClientRect().top):null,rows:[...document.querySelectorAll('[data-task]')].filter(inView).length,want:!!row&&inView(row),link:!!row?.querySelector('[data-inbox-link]')&&inView(row.querySelector('[data-inbox-link]')),scroll:document.querySelector('#main').scrollTop};},task);
// The captain's board runs with Firstmate attached, so no first-run welcome panel sits above the overview;
// this fixture server has no attached session, so the page is told what an attached one shows (no welcome).
const attached=ctx=>ctx.addInitScript(()=>Object.defineProperty(window,'crewFirstmateWelcome',{configurable:true,get:()=>()=>null,set(){}}));
const open=async(ctx,width,b=base,task=top.id)=>{await attached(ctx);const p=await ctx.newPage();await p.goto(`${b}/#/board`);await p.waitForSelector(`[data-task="${task}"] .tb-track i`);await p.locator('#chatClose').evaluate(b=>b.click());const hide=p.getByRole('button',{name:'Hide guide'});if(await hide.count())await hide.first().click();await p.waitForTimeout(400);return p;};
const stage=(p,id)=>p.textContent(`[data-task="${id}"] .tb-stage`).then(t=>t.trim());
try{await waitUp(base,app);await waitUp(two.base,two.app);browser=withSession(await chromium.launch({headless:true}),base);
for(const [width,height] of [[1280,800],[1440,900]]){
 const ctx=await browser.newContext({viewport:{width,height}}),p=await open(ctx,width),s=await seen(p);await p.screenshot({path:join(shots,`${width}x${height}-first-open.png`)});
 ok(s.list&&s.listTop<height,`the task list starts inside the first viewport at ${width}x${height}`,JSON.stringify(s));
 ok(s.rows>=3,`the three waiting Tasks' rows are visible on first open without scrolling at ${width}x${height}`,JSON.stringify(s));
 ok(s.want&&s.link,`the dispatch Task's row and its link to its card are visible on first open at ${width}x${height}`,JSON.stringify(s));
 ok(await p.locator('#view [data-wo-workflow], #view .wo-frame, #view svg.graph').count()===0,`no workflow graph on the Board at ${width}x${height}`);
 if(width===1280){
  // the built-in code-firstmate stages are the track: dispatch and scope-card are Intake, merge-card is Gates
  ok(/^Intake · /.test(await stage(p,top.id))&&/^Intake · /.test(await stage(p,a.id))&&/^Gates · /.test(await stage(p,late.id)),'a real-size definition\'s track is its stages, the current one named',JSON.stringify([await stage(p,top.id),await stage(p,a.id),await stage(p,late.id)]));
  // a re-render (a language switch) keeps the viewer's selection
  await p.locator(`[data-task="${late.id}"] .tb-title`).click();await p.evaluate(()=>setLang('zh-TW'));await p.waitForTimeout(300);
  ok(await p.locator(`[data-task-detail="${late.id}"]`).count()===1,'a re-render keeps the selected Task');await p.evaluate(()=>setLang('en'));
 }
 await ctx.close();
}
{ // phone: the list starts in the first viewport, with the bar that counts the Tasks waiting
 const ctx=await browser.newContext({viewport:{width:390,height:844}}),p=await open(ctx,390),s=await seen(p);await p.screenshot({path:join(shots,'390x844-first-open.png')});
 ok(s.list&&s.listTop<844&&s.rows>=1,'phone task list starts inside the first viewport',JSON.stringify(s));
 ok((await p.textContent('[data-tb-waitbar]')).includes('3 tasks waiting for you'),'phone bar counts the three waiting Tasks',await p.textContent('[data-tb-waitbar]').catch(()=>''));
 ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone page has no sideways scroll');
 await ctx.close();
}
{ // storage that throws (private window, blocked site data) must not break the Board
 const ctx=await browser.newContext({viewport:{width:1280,height:800}});await ctx.addInitScript(()=>{for(const k of ['getItem','setItem'])Storage.prototype[k]=function(){throw new Error('blocked storage');};});
 const p=await open(ctx,1280),s=await seen(p);ok(s.rows>=3&&s.want,'the Board opens with storage blocked',JSON.stringify(s));
 await p.locator('[data-tb-tab="you"]').click();ok(await p.locator('[data-task]').count()===3&&await p.getAttribute('[data-tb-tab="you"]','aria-selected')==='true','filters still work with storage blocked');
 await ctx.close();
}
{ // a fan: one Task waiting at three branches is one row, its three cards ringed on its path
 const ctx=await browser.newContext({viewport:{width:1280,height:800}}),p=await open(ctx,1280,two.base,fa.id);await p.locator(`[data-task="${fa.id}"] .tb-title`).click();
 ok(await p.locator(`[data-task="${fa.id}"]`).count()===1&&await p.locator(`[data-task-path="${fa.id}"] li.cur`).count()===3,'a Task waiting at three parallel branches is one row with three current nodes on its path');
 await ctx.close();
}
{ // live move: the row follows the Task from q6 to q10; a viewer's scroll and selection stay
 const ca=await browser.newContext({viewport:{width:1280,height:500}}),pa=await open(ca,1280,two.base,zl.id);
 ok(/^Step 6 · 7\/13$/.test(await stage(pa,zl.id)),'a chain\'s track is its main path: the Task is at Step 6, 7 of 13',await stage(pa,zl.id));
 await pa.locator(`[data-task="${zl.id}"] .tb-title`).click();await pa.evaluate(()=>{document.querySelector('#main').scrollTop=40;});await pa.waitForTimeout(150);const mine=(await seen(pa,zl.id)).scroll;
 const q6=await pa.evaluate(async run=>(await fetch('/api/scards?open=1').then(x=>x.json())).cards.find(c=>c.run===run&&c.node==='q6')?.id,zl.id);
 const answered=await pa.evaluate(async id=>(await fetch(`/api/scards/${id}/answer`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({choice:'jump',by:'captain'})})).status,q6);ok(answered===200,'answer q6 with jump through the real server',String(answered));
 const moved=await pa.waitForFunction(id=>/^Step 10 · 11\/13$/.test(document.querySelector(`[data-task="${id}"] .tb-stage`)?.textContent||''),zl.id,{timeout:10000}).then(()=>true,()=>false);
 await pa.screenshot({path:join(shots,'1280x500-live-follow.png')});ok(moved,'the row follows the Task from q6 to q10, live',await stage(pa,zl.id));
 const kept=await seen(pa,zl.id);ok(mine>0&&kept.scroll===mine&&await pa.locator(`[data-task-detail="${zl.id}"]`).count()===1,'the viewer\'s scroll and selection stay through the live move',JSON.stringify({mine,kept}));
 await ca.close();
}
}finally{await browser?.close();for(const s of [one,two]){s.app.kill();await new Promise(r=>s.app.exitCode!==null?r():s.app.once('exit',r));}}
console.log(`workflow-overview-fold-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
