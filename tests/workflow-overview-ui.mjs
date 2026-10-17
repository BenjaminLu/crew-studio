import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Real native engine/server Board frontier regression; no projected state.
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness.ts';
import {freePort,waitUp,withSession} from './boot.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
async function fullCapture(p,path){
 const selectors=['body','.shell','#main'];const saved=await p.evaluate(selectors=>selectors.map(s=>{const e=document.querySelector(s);if(!e)return null;const old=e.getAttribute('style');e.style.overflow='visible';if(s==='.shell')e.style.height='auto';return {s,old};}),selectors);
 await p.locator('#chatFab').evaluate(e=>e.style.visibility='hidden');await p.screenshot({path,fullPage:true});await p.locator('#chatFab').evaluate(e=>e.style.visibility='');await p.evaluate(saved=>saved.forEach(x=>{if(x){const e=document.querySelector(x.s);x.old===null?e.removeAttribute('style'):e.setAttribute('style',x.old);}}),saved);
}
let pass=0,fail=0;const ok=(v,n,e='')=>{console.log(`${v?'ok':'FAIL'} ${n} ${e}`);v?pass++:fail++;};
const card=id=>({id,kind:'card',label:id,card:{title:{en:`Decide ${id}`,'zh-TW':`決定 ${id}`},options:[{id:'go',label:'Continue'}]}});
const H=await harness([Y({id:'code-firstmate',name:'Code firstmate',roles:[],nodes:[{id:'start',kind:'hook',do:'note',label:'Start'},card('q'),card('q2'),{id:'end',kind:'hook',do:'note',label:'Done'}],edges:[['start','q'],['q','q2','go'],['q2','end','go']]}),Y({id:'notes',name:'Parallel notes',roles:[],nodes:[{id:'start',kind:'hook',do:'note',label:'Start'},card('left'),card('right'),{id:'end',kind:'hook',do:'note',label:'Done'}],edges:[['start','left'],['start','right'],['left','end','go'],['right','end','go']]})]);
H.engine.actions.note=x=>{if(x.run.text==='fail')throw new Error('Known fixture failure');return 'ok';};
const a=H.engine.start({workflow:'code-firstmate',text:'a',title:'Older captain wait'});await until(()=>H.engine.get(a.id)?.status==='waiting');
const b=H.engine.start({workflow:'code-firstmate',text:'b',title:'Newer captain wait'}),c=H.engine.start({workflow:'notes',text:'c',title:'Parallel captain waits'}),d=H.engine.start({workflow:'notes',text:'fail',title:'Explicit failure'});
await until(()=>H.engine.get(b.id)?.status==='waiting'&&H.engine.get(c.id)?.status==='waiting'&&H.engine.get(d.id)?.status==='failed'&&[a,b,c,d].every(r=>!H.engine.busy(r.id)));
const ended=H.engine.start({workflow:'code-firstmate',text:'ended',title:'Already completed'}),cancelled=H.engine.start({workflow:'code-firstmate',text:'cancelled',title:'Already cancelled'}),archived=H.engine.start({workflow:'notes',text:'fail',title:'Already archived failure'});
await until(()=>H.engine.get(ended.id)?.status==='waiting'&&H.engine.get(cancelled.id)?.status==='waiting'&&H.engine.get(archived.id)?.status==='failed');
for(let n=0;n<2;n++){await H.engine.answer(H.engine.cards.list({run:ended.id,open:true})[0].id,{choice:'go',by:'captain'});await until(()=>n===0?H.engine.cards.list({run:ended.id,open:true}).length>0:H.engine.get(ended.id)?.status==='succeeded');}
await H.engine.cancel(cancelled.id,'Fixture cancellation');await until(()=>!H.engine.busy(archived.id));H.engine.archive(archived.id,true,'captain');
const ac=H.engine.cards.list({run:a.id,open:true})[0];
ok(H.engine.cards.list({run:c.id,open:true}).length===2,'fixture has two real parallel waiting frontiers');
H.stop();mkdirSync(join(H.data,'fm','state'),{recursive:true});
const root=join(import.meta.dir,'..'),port=await freePort(),base=`http://127.0.0.1:${port}`;process.env.CREW_SESSION_TOKEN='test-session';
const app=spawn('bun',['src/server.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,CREW_DATA:H.data,CREW_PORT:String(port),CREW_CHAT_PROVIDER:'stub',CREW_GH:'0',CREW_READONLY:'1',CREW_RETRO_AUTO:'0',CREW_SESSION_TOKEN:'test-session',CREW_FM_STATE:join(H.data,'fm','state'),CREW_CLAUDE_BIN:'/nonexistent',CREW_CODEX_BIN:'/nonexistent'}});
const shots=join(root,'tests/out/workflow-overview');mkdirSync(shots,{recursive:true});let browser;
try{await waitUp(base,app);
browser=withSession(await chromium.launch({headless:true}),base);
// A fresh data dir auto-opens the first-project guide on Board (public/onboarding.js): it holds #main's height and covers the cue.
// This suite is about a captain past onboarding, so every page starts with the guide hidden, as Hide guide leaves it (as chat-history-ui does).
{const nc=browser.newContext.bind(browser);browser.newContext=async o=>{const c=await nc(o);await c.addInitScript(()=>{try{localStorage.setItem('crew.onboarding.journey.dismissed.v1','1');}catch{}});return c;};}
// Pure presentation geometry probes use real persisted native Task inputs, never authorize work.
{
 const ctx=await browser.newContext({viewport:{width:1440,height:900}}),p=await ctx.newPage();await p.goto(base+'/#/board');await p.waitForSelector('[data-workflow-overview]');
 const result=await p.evaluate(async({first,second})=>{
  const [one,two,opened]=await Promise.all([fetch('/api/tasks/'+first).then(r=>r.json()),fetch('/api/tasks/'+second).then(r=>r.json()),fetch('/api/scards?open=1').then(r=>r.json())]);
  const source=crewLayout.layout,path=crewLayout.pathD;let calls=0,last,edge;crewLayout.layout=(...args)=>{calls++;last=source(...args);return last;};crewLayout.pathD=e=>{edge=e;return path(e);};
  const render=(runs)=>crewWorkflowOverview.render(runs,opened.cards);const shape=el=>JSON.stringify([...el.querySelectorAll('.wo-lines > path')].map(p=>p.getAttribute('d')));
  try{
   // A distinct semantic label avoids reusing the page's earlier initial render.
   one.def.name='Geometry probe initial';two.def=structuredClone(one.def);const before=render([one]),geometry=shape(before),initial=calls;
   const fresh=structuredClone(one);fresh.title='Fresh presentation title';const again=render([fresh]);const repeated=calls===initial&&shape(again)===geometry&&again.textContent.includes(fresh.title);
   last.nodes[0].x+=999999;if(edge?.segs?.[0])edge.segs[0].a[0]+=999999;const isolated=shape(render([one]))===geometry;
   const version=structuredClone(one);version.def.version+=1;render([version]);const versionChanged=calls===initial+1;
   const label=structuredClone(version);label.def.nodes[0].label='Changed semantic node';render([label]);const definitionChanged=calls===initial+2;
   const tall=render([one,two]);const concurrencyChanged=calls===initial+3&&tall.querySelectorAll('.wo-frame [data-wo-task]').length===2&&parseFloat(tall.querySelector(".wo-canvas").style.height)>parseFloat(before.querySelector(".wo-canvas").style.height);
   const rebound=structuredClone(one);rebound.nodes.q.waiting='external';const current=render([rebound]);const freshFrontier=current.querySelector('[data-wo-task]')?.getAttribute('href')==='#/tasks/'+one.id&&calls===initial+3;
   for(let n=0;n<33;n++){const changed=structuredClone(one);changed.def.name='Eviction probe '+n;render([changed]);}const after=calls;render([one]);const evicted=calls===after+1;
   return {initial,repeated,isolated,versionChanged,definitionChanged,concurrencyChanged,freshFrontier,evicted,calls};
  }finally{crewLayout.layout=source;crewLayout.pathD=path;}
 },{first:a.id,second:b.id});
 for(const key of ['repeated','isolated','versionChanged','definitionChanged','concurrencyChanged','freshFrontier','evicted'])ok(result[key],'pure geometry cache '+key+' preserves current native presentation',JSON.stringify(result));await ctx.close();
}
for(const width of [1440,390])for(const theme of ['light','dark'])for(const language of ['en','zh-TW']){
 const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),p=await ctx.newPage(),tag=`${width}-${theme}-${language}`;
 const capture=async(name,full=true)=>{const path=join(shots,`${tag}-${name}.png`);if(full)await fullCapture(p,path);else await p.screenshot({path});};
 await p.goto(`${base}/#/board`);await p.waitForSelector('[data-board]');await p.evaluate(({theme,language})=>{document.documentElement.dataset.theme=theme;document.body.classList.add('chat-closed');setLang(language);},{theme,language});await p.waitForTimeout(500);
 const found=await p.locator('[data-wo-workflow]').count();ok(found===2,`two native workflow graphs ${tag}`,String(found));if(found!==2){await ctx.close();continue;}
 const graph=p.locator('[data-wo-workflow="code-firstmate"]');
 ok(await p.locator(`.wo-frame [data-wo-task="${ended.id}"],.wo-frame [data-wo-task="${cancelled.id}"],.wo-frame [data-wo-task="${archived.id}"]`).count()===0,'succeeded cancelled archived Tasks excluded');
 ok(await p.locator('[data-ended-run]').count()>=2,'recent ended section retained');
 ok(await p.evaluate(()=>crewWorkflowOverview.frontiers({id:'native-failed',status:'failed',nodes:{old:{state:'error'},current:{state:'error'}},events:[{type:'failed',node:'current'}],queue:[]},[]).map(t=>t.id).join() === 'current'),'only authoritative terminal failure node is current');
 ok(await p.evaluate(()=>crewWorkflowOverview.frontiers({id:'native-stalled',status:'failed',nodes:{old:{state:'error'}},events:[{type:'failed',summary:'Stalled'}],queue:[]},[]).length===0),'stalled infrastructure failure invents no node or blocked token');
 ok(await p.evaluate(()=>crewWorkflowOverview.frontiers({id:'synthetic-native',status:'waiting',nodes:{n:{state:'running',waiting:'external',startedAt:'2000-01-01',visits:2}},queue:[]},[])[0].since===null),'missing actual wait timestamp is not guessed from start');
 ok(await p.evaluate(()=>!crewWorkflowOverview.frontiers({id:'synthetic-native',status:'waiting',nodes:{n:{state:'running',waiting:'card',visits:2}},queue:[]},[{run:'synthetic-native',node:'n',visit:1,status:'open',id:'stale-card'}])[0].card),'a previous visit card is never used as current');
 ok(await p.locator('[data-wo-workflow]').first().getAttribute('data-wo-workflow')==='code-firstmate','code-firstmate first');
 ok(await p.locator('#needs').evaluate(e=>e.compareDocumentPosition(document.querySelector('#workflowOverview'))&Node.DOCUMENT_POSITION_FOLLOWING),'Needs you precedes graphs');
 ok(await graph.locator('.wo-frame [data-wo-task]').count()===2,'two same-node real captain tokens');
 ok(await graph.locator('[data-wo-group="q"] .wo-stack-meta').textContent().then(t=>t.includes('2')),'same-node stack count');
 ok(await graph.locator('[data-oldest-wait]').getAttribute('data-oldest-wait')===ac.createdAt,'oldest actual captain wait');
 ok(await graph.locator(`.wo-frame [data-wo-task="${a.id}"]`).getAttribute('href')===`#/inbox/${ac.id}`,'waiting token targets actual card');
 ok(await p.locator(`[data-wo-workflow="notes"] .wo-frame [data-wo-task="${c.id}"]`).count()===2,'parallel Task has both actual frontier tokens');
 ok(await p.locator(`.wo-frame [data-wo-task="${d.id}"]`).getAttribute('href')===`#/tasks/${d.id}`,'ordinary failed token targets canonical Task/Rounds');
 ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#main').scrollWidth<=document.querySelector('#main').clientWidth+1),'page and main have no sideways scroll');
 ok(await graph.locator('[data-wo-toggle]').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),'list toggle fits viewport');
 ok(await graph.locator('.wo-frame').evaluate(e=>e.scrollWidth>e.clientWidth||innerWidth===1440),'phone graph owns horizontal scroll');
 await capture('graph');await graph.scrollIntoViewIfNeeded();await capture('middle',false);
 const keys=await graph.locator('.wo-frame [data-wo-task]').evaluateAll(es=>es.map(e=>e.dataset.woTask+':'+e.dataset.woNode).sort().join('|'));
 await graph.locator('[data-wo-toggle]').click();ok(await graph.locator('.wo-list').isVisible()&&!await graph.locator('.wo-frame').isVisible(),'one tap equivalent list');
 ok(await graph.locator('.wo-list [data-wo-task]').evaluateAll(es=>es.map(e=>e.dataset.woTask+':'+e.dataset.woNode).sort().join('|'))===keys,'graph and list tokens identical');await capture('list');await graph.locator('[data-wo-toggle]').click();
 await graph.locator(`.wo-frame [data-wo-task="${a.id}"]`).click();await p.waitForSelector(`[data-scard="${ac.id}"]`);ok(p.url().endsWith(`#/inbox/${ac.id}`),'one tap opens real captain card');await capture('card');
 await p.goto(`${base}/#/tasks/${d.id}`);await p.waitForSelector('[data-rounds]');await capture('failed-rounds');
 await p.goto(`${base}/#/board`);await p.waitForSelector('[data-wo-workflow]');
 if(width===390){await p.evaluate(()=>{document.querySelector('#main').scrollTop=document.querySelector('#main').scrollHeight;});await capture('phone-end',false);ok(await p.evaluate(()=>{const f=document.querySelector('#chatFab').getBoundingClientRect(),last=document.querySelector('.crewline').getBoundingClientRect();return last.bottom<f.top||last.right<f.left;}),'page end clears firstmate FAB');}
 await ctx.close();
}
if(!await browser.newContext().then(async ctx=>{const p=await ctx.newPage();await p.goto(`${base}/#/board`);await p.waitForSelector("[data-board]");const yes=await p.evaluate(()=>!!window.crewWorkflowOverview);await ctx.close();return yes;})) throw new Error("Missing native workflow overview on base");
// Every changed live state captured in the same open documents, all view variants.
const live=[];
for(const width of [1440,390,320])for(const theme of ['light','dark'])for(const language of ['en','zh-TW']){
 const ctx=await browser.newContext({viewport:{width,height:900}}),p=await ctx.newPage();await p.goto(`${base}/#/board`);await p.waitForSelector('[data-wo-workflow]');await p.evaluate(({theme,language})=>{document.documentElement.dataset.theme=theme;document.body.classList.add('chat-closed');setLang(language);window.overviewPageNonce='same-document';},{theme,language});if(width===390)await p.locator('[data-wo-workflow="code-firstmate"] .wo-frame').evaluate(e=>e.scrollLeft=100);live.push({ctx,p,width,tag:`${width}-${theme}-${language}`});
}
const p=live[0].p,mutate=async(path,body)=>p.evaluate(async({path,body})=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{path,body});
const cueClearance=async(page,tag)=>{const result=await page.evaluate(()=>{const cue=document.querySelector('.rt-cue'),fab=document.querySelector('#chatFab');if(!cue||!fab)return {clear:false};const a=cue.getBoundingClientRect(),b=fab.getBoundingClientRect();return {clear:a.bottom<=b.top-8||a.right<=b.left-8||a.left>=b.right+8,fits:a.left>=0&&a.right<=innerWidth&&a.top>=0&&a.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight,rects:{cue:a.toJSON(),fab:b.toJSON()}};});ok(result.clear&&result.fits,`live cue and whole Firstmate FAB clear viewport ${tag}`,JSON.stringify(result));};
// The fixture's 'code-firstmate' id is staffing-guarded (src/domain/staffing.ts): a new Task there needs a signed captain staffing approval.
// The notice only needs a real native Task with a captain card, so it is created on the unguarded 'notes' fixture workflow.
const nativeNotice=async(v,label)=>{const r=await mutate('/api/tasks',{workflow:'notes',version:c.version,text:label,title:label});if(r.status!==200)throw new Error('Native notice fixture creation failed');await v.p.waitForSelector('.rt-cue');};
const captures=async(state)=>{for(const v of live){
 await nativeNotice(v,`Notice ${state} ${v.tag}`);
 await fullCapture(v.p,join(shots,`${v.tag}-live-${state}.png`));await v.p.evaluate(()=>document.querySelector('#workflowOverview')?.scrollIntoView({block:'start'}));await cueClearance(v.p,`${state}-middle-${v.tag}`);await v.p.screenshot({path:join(shots,`${v.tag}-live-${state}-middle.png`)});
 if(v.width<=390){await v.p.evaluate(()=>{const m=document.querySelector('#main');m.scrollTop=m.scrollHeight;});await cueClearance(v.p,`${state}-end-${v.tag}`);await v.p.screenshot({path:join(shots,`${v.tag}-live-${state}-end.png`)});}
 let opened=false;try{await v.p.locator('#chatFab').click({timeout:800});opened=await v.p.locator('#chatIn').isVisible();}catch{}ok(opened,`actual Firstmate button opens with live cue ${state}-${v.tag}`);if(opened){const reachable=await v.p.evaluate(()=>['#chatClose','[data-new-card-show]','[data-new-card-dismiss]'].every(sel=>{const e=document.querySelector(sel),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));ok(reachable,`open Firstmate drawer and cue controls remain reachable ${state}-${v.tag}`);await v.p.screenshot({path:join(shots,`${v.tag}-live-${state}-drawer-cue.png`)});await v.p.locator('#chatClose').click();}
 await v.p.locator('[data-new-card-show]').click();await v.p.waitForURL(/#\/inbox/);ok(true,`actual cue Show opens Inbox ${state}-${v.tag}`);await v.p.goto(`${base}/#/board`);await v.p.waitForSelector('[data-wo-workflow]');
 await nativeNotice(v,`Dismiss ${state} ${v.tag}`);await v.p.locator('[data-new-card-dismiss]').click();ok(await v.p.locator('.rt-cue').count()===0,`actual cue Dismiss closes notice ${state}-${v.tag}`);
 }};
const answered=await mutate(`/api/scards/${ac.id}/answer`,{choice:'go',by:'captain'});ok(answered.status===200,'answer actual card through real server');
for(const v of live){await v.p.waitForSelector(`.wo-frame [data-wo-task="${a.id}"][data-wo-node="q2"]`);ok(await v.p.locator(`.wo-frame [data-wo-task="${a.id}"][data-wo-node="q"]`).count()===0,`SSE moves token after Round completion ${v.tag}`);if(v.width===390){await v.p.waitForFunction(()=>document.querySelector('[data-wo-workflow="code-firstmate"] .wo-frame')?.scrollLeft>=99);ok(true,'live updates preserve graph scroll');}}
const rounds=await p.evaluate(async id=>(await(await fetch(`/api/tasks/${id}`)).json()).rounds,a.id);ok(rounds.some(r=>r.node==='q'&&r.endedAt),'captain Round really ended');await captures('moved');
let result=await mutate(`/api/tasks/${d.id}/archive`,{});ok(result.status===200,'archive real failed Task');for(const v of live)await v.p.waitForSelector(`.wo-frame [data-wo-task="${d.id}"]`,{state:'detached'});await captures('archived');
result=await mutate(`/api/tasks/${d.id}/archive`,{archived:false});ok(result.status===200,'unarchive real failed Task',JSON.stringify(result));for(const v of live)await v.p.waitForSelector(`.wo-frame [data-wo-task="${d.id}"]`);await captures('unarchived');
result=await mutate(`/api/tasks/${d.id}/delete`,{confirm:d.id});ok(result.status===200,'remove real failed Task',JSON.stringify(result));if(result.status===200)for(const v of live)await v.p.waitForSelector(`.wo-frame [data-wo-task="${d.id}"]`,{state:'detached'});await captures('removed');
for(const v of live){ok(await v.p.evaluate(()=>window.overviewPageNonce==='same-document'),`all live transitions retain document ${v.tag}`);await v.ctx.close();}
}finally{await browser?.close();app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));}
console.log(`workflow-overview-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
