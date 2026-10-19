import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Real native engine/server Board regression; no projected state. The Board is a task overview (docs/units/board.md
// round 6): one row per unresolved Task, each linking to the card it actually waits on; no workflow graph.
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
const card=id=>({id,kind:'card',label:id,card:{ body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, title:{en:`Decide ${id}`,'zh-TW':`決定 ${id}`},options:[{id:'go',label:'Continue', labelZh: 'Continue'}]}});
const H=await harness([Y({id:'code-firstmate',name:'Code firstmate',roles:[],nodes:[{id:'start',kind:'hook',do:'note',label:'Start'},card('q'),card('q2'),{id:'end',kind:'hook',do:'note',label:'Done'}],edges:[['start','q'],['q','q2','go'],['q2','end','go']]}),Y({id:'notes',name:'Parallel notes',roles:[],nodes:[{id:'start',kind:'hook',do:'note',label:'Start'},card('left'),card('right'),{id:'end',kind:'hook',do:'note',label:'Done'}],edges:[['start','left'],['start','right'],['left','end','go'],['right','end','go']]}),Y({id:'cue-notice',name:'Cue notice fixture',roles:[],nodes:[card('notice')],edges:[]})]);
H.engine.actions.note=x=>{if(x.run.text==='fail')throw new Error('Known fixture failure');return 'ok';};
const a=H.engine.start({workflow:'code-firstmate',text:'a',title:'Older captain wait'});await until(()=>H.engine.get(a.id)?.status==='waiting');
const b=H.engine.start({workflow:'code-firstmate',text:'b',title:'Newer captain wait'}),c=H.engine.start({workflow:'notes',text:'c',title:'Parallel captain waits'}),d=H.engine.start({workflow:'notes',text:'fail',title:'Explicit failure'});
await until(()=>H.engine.get(b.id)?.status==='waiting'&&H.engine.get(c.id)?.status==='waiting'&&H.engine.get(d.id)?.status==='failed'&&[a,b,c,d].every(r=>!H.engine.busy(r.id)));
const ended=H.engine.start({workflow:'code-firstmate',text:'ended',title:'Already completed'}),cancelled=H.engine.start({workflow:'code-firstmate',text:'cancelled',title:'Already cancelled'}),archived=H.engine.start({workflow:'notes',text:'fail',title:'Already archived failure'});
await until(()=>H.engine.get(ended.id)?.status==='waiting'&&H.engine.get(cancelled.id)?.status==='waiting'&&H.engine.get(archived.id)?.status==='failed');
for(let n=0;n<2;n++){await H.engine.answer(H.engine.cards.list({run:ended.id,open:true})[0].id,{choice:'go',by:'captain'});await until(()=>n===0?H.engine.cards.list({run:ended.id,open:true}).length>0:H.engine.get(ended.id)?.status==='succeeded');}
await H.engine.cancel(cancelled.id,'Fixture cancellation');await until(()=>!H.engine.busy(archived.id));H.engine.archive(archived.id,true,'captain');
const ac=H.engine.cards.list({run:a.id,open:true})[0];
const dFailureCard=H.engine.get(d.id)?.failureCard??null; // every failure raises its card (the captain's recovery choices)
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
// The Board as a task overview, on the real native engine: one row per Task, each waiting Task linking to its actual card.
const row=(p,id)=>p.locator(`[data-task="${id}"]`);
const link=(p,id)=>p.locator(`[data-task="${id}"] [data-inbox-link]`).getAttribute('href').catch(()=>null);
// what the Board derives from a real run, without the page: the pure view of one Task (public/board.js crewBoard.task)
{
 const ctx=await browser.newContext({viewport:{width:1440,height:900}}),p=await ctx.newPage();await p.goto(base+'/#/board');await p.waitForSelector(`[data-task="${a.id}"]`);
 const v=await p.evaluate(async({first,failed,parallel})=>{
  const [one,dd,cc,opened]=await Promise.all([fetch('/api/tasks/'+first).then(r=>r.json()),fetch('/api/tasks/'+failed).then(r=>r.json()),fetch('/api/tasks/'+parallel).then(r=>r.json()),fetch('/api/scards?open=1').then(r=>r.json())]);
  const t=(r,cards=opened.cards)=>crewBoard.task(r,cards);
  // a card raised on an earlier visit of its node is never the one the Task waits on now
  const stale=structuredClone(one);stale.nodes.q.visits=2;
  return {waiting:t(one),failed:t(dd),parallel:t(cc),stale:t(stale).card,noCard:t(one,[]).group,ms:crewBoard.milestones(one.def).map(m=>m.id)};
 },{first:a.id,failed:d.id,parallel:c.id});
 ok(v.waiting.group==='you'&&v.waiting.card?.id===ac.id,'a Task at its captain card waits for you on that actual card',JSON.stringify(v.waiting.card));
 ok(v.failed.group==='stuck'&&/Known fixture failure/.test(v.failed.now),'an explicit failure is stuck, with its error',JSON.stringify([v.failed.group,v.failed.now]));
 ok(v.parallel.group==='you'&&!!v.parallel.card,'a Task waiting at two parallel cards is one Task waiting for you');
 ok(v.stale===null,'a previous visit card is never used as current');
 ok(v.noCard==='you','a Task whose card is not loaded yet still waits for you (its node waits on a card)');
 ok(JSON.stringify(v.ms)===JSON.stringify(['q','q2']),'the milestones of a workflow without stages are its main path\'s cards',JSON.stringify(v.ms));
 await ctx.close();
}
for(const width of [1440,390])for(const theme of ['light','dark'])for(const language of ['en','zh-TW']){
 const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:theme}),p=await ctx.newPage(),tag=`${width}-${theme}-${language}`;
 const capture=async(name,full=true)=>{const path=join(shots,`${tag}-${name}.png`);if(full)await fullCapture(p,path);else await p.screenshot({path});};
 await p.goto(`${base}/#/board`);await p.waitForSelector('[data-board]');await p.evaluate(({theme,language})=>{document.documentElement.dataset.theme=theme;document.body.classList.add('chat-closed');setLang(language);},{theme,language});await p.waitForTimeout(500);
 const ids=await p.$$eval('[data-task]',rs=>rs.map(r=>r.dataset.task));
 ok([a,b,c,d].every(r=>ids.includes(r.id))&&new Set(ids).size===ids.length,`every unresolved native Task has one row ${tag}`,JSON.stringify(ids));
 ok(await p.locator('#view [data-wo-workflow], #view .wo-frame, #view svg.graph').count()===0,`no workflow graph on the Board ${tag}`);
 ok(!ids.includes(archived.id),'an archived Task is not on the Board');
 ok(await row(p,ended.id).getAttribute('data-group')==='done'&&await row(p,cancelled.id).getAttribute('data-group')==='done'&&await p.locator(`[data-task="${cancelled.id}"] [data-run-state="cancelled"]`).count()===1,'a Task that succeeded or was cancelled today is under Done today, in its own word');
 ok(Number(await p.textContent('[data-tb-tab="done"] .tb-count'))>=2,'the Done today filter counts the ended Tasks');
 ok(await row(p,a.id).getAttribute('data-group')==='you'&&await row(p,b.id).getAttribute('data-group')==='you'&&await row(p,d.id).getAttribute('data-group')==='stuck','the waiting Tasks wait for you, the failed one is stuck');
 const gs=await p.$$eval('[data-task]',rs=>rs.map(r=>({you:0,stuck:1,run:2,done:3})[r.dataset.group]));ok(gs.every((g,i)=>!i||gs[i-1]<=g),'rows ordered: waiting for you, stuck, running, done');
 ok(await link(p,a.id)===`#/inbox/${ac.id}`&&await link(p,b.id)!==await link(p,a.id),'two Tasks at the same node each link to their own actual card');
 ok(await link(p,d.id)===`#/inbox/${dFailureCard}`,'a failed Task links to its failure card in the Inbox',String(dFailureCard));
 await row(p,d.id).locator('.tb-title').click();ok(await p.getAttribute(`[data-open-task="${d.id}"]`,'href')===`#/run/${d.id}`,'a failed Task opens on its Task page');
 await row(p,c.id).locator('.tb-title').click();ok(await p.locator(`[data-task-path="${c.id}"] li.cur`).count()===2,'a Task waiting at two parallel cards rings both on its path');
 ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#main').scrollWidth<=document.querySelector('#main').clientWidth+1),'page and main have no sideways scroll');
 await capture('board');
 await row(p,a.id).locator('[data-inbox-link]').click();await p.waitForSelector(`[data-scard="${ac.id}"]`);ok(p.url().endsWith(`#/inbox/${ac.id}`),'one tap opens real captain card');await capture('card');
 await p.goto(`${base}/#/tasks/${d.id}`);await p.waitForSelector('[data-rounds]');await capture('failed-rounds');
 await p.goto(`${base}/#/board`);await p.waitForSelector('[data-task]');
 if(width===390){await p.evaluate(()=>{document.querySelector('#main').scrollTop=document.querySelector('#main').scrollHeight;});await capture('phone-end',false);ok(await p.evaluate(()=>{const f=document.querySelector('#chatFab').getBoundingClientRect(),last=document.querySelector('.tb-list').getBoundingClientRect();return last.bottom<f.top||last.right<f.left;}),'page end clears firstmate FAB');}
 await ctx.close();
}
// Every changed live state captured in the same open documents, all view variants.
const live=[];
for(const width of [1440,390,320])for(const theme of ['light','dark'])for(const language of ['en','zh-TW']){
 const ctx=await browser.newContext({viewport:{width,height:900}}),p=await ctx.newPage();await p.goto(`${base}/#/board`);await p.waitForSelector(`[data-task="${a.id}"]`);await p.evaluate(({theme,language})=>{document.documentElement.dataset.theme=theme;document.body.classList.add('chat-closed');setLang(language);window.overviewPageNonce='same-document';},{theme,language});
 await p.waitForTimeout(200);await row(p,a.id).locator('.tb-title').click();live.push({ctx,p,width,theme,language,tag:`${width}-${theme}-${language}`});
}
const p=live[0].p,mutate=async(path,body)=>p.evaluate(async({path,body})=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{path,body});
const cueClearance=async(page,tag)=>{const result=await page.evaluate(()=>{const cue=document.querySelector('.rt-cue'),fab=document.querySelector('#chatFab');if(!cue||!fab)return {clear:false};const a=cue.getBoundingClientRect(),b=fab.getBoundingClientRect();return {clear:a.bottom<=b.top-8||a.right<=b.left-8||a.left>=b.right+8,fits:a.left>=0&&a.right<=innerWidth&&a.top>=0&&a.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight,rects:{cue:a.toJSON(),fab:b.toJSON()}};});ok(result.clear&&result.fits,`live cue and whole Firstmate FAB clear viewport ${tag}`,JSON.stringify(result));};
// The fixture's 'code-firstmate' id is staffing-guarded (src/domain/staffing.ts): a new Task there needs a signed captain staffing approval.
// The notice only needs a real native Task with a captain card, so it is created on the unguarded single-card 'cue-notice' fixture workflow.
const pollUI=async(test,label)=>{const end=Date.now()+10000;while(Date.now()<end){if(await test())return;await new Promise(r=>setTimeout(r,40));}throw new Error(label);};
const noticeBound=(page,id)=>page.locator(`[data-new-card-show][href="#/inbox/${id}"]`).count().then(n=>n===1);
const nativeNotice=async(v,label)=>{
 if(await v.p.locator('[data-new-card-dismiss]').count())await v.p.locator('[data-new-card-dismiss]').click();
 const r=await mutate('/api/tasks',{workflow:'cue-notice',version:1,text:label,title:label});if(r.status!==200)throw new Error('Native notice fixture creation failed');
 let cardId;await pollUI(async()=>{const task=await v.p.evaluate(async id=>(await(await fetch('/api/tasks/'+id)).json()),r.data.id);cardId=task.cards?.find(c=>c.run===r.data.id)?.id;return !!cardId;},'new Task did not raise its card');
 await pollUI(()=>noticeBound(v.p,cardId),'new Task card did not enter the visible cue');return cardId;
};
// CI invokes both bounded groups; default local invocation still covers every capture state.
const captureGroup=process.env.OVERVIEW_CAPTURE_GROUP||'all';
if(!['all','1','2'].includes(captureGroup))throw new Error('OVERVIEW_CAPTURE_GROUP must be all, 1 or 2');
const captureStates=new Set(captureGroup==='1'?['moved','archived']:captureGroup==='2'?['unarchived','removed']:['moved','archived','unarchived','removed']);
const captures=async(state)=>{if(!captureStates.has(state))return;for(const source of live){
 // Keep the original 12 documents for SSE assertions; each notice UX capture starts with no old fresh-card queue.
 const ctx=await browser.newContext({viewport:{width:source.width,height:900}}),page=await ctx.newPage();await page.clock.install();await page.goto(base+'/#/board');
 await page.waitForFunction(()=>window.studioCards?.ready());await page.waitForSelector(`[data-task="${a.id}"]`);
 await page.evaluate(({theme,language})=>{document.documentElement.dataset.theme=theme;document.body.classList.add('chat-closed');setLang(language);},{theme:source.theme,language:source.language});
 await row(page,a.id).locator('.tb-title').click();const v={...source,p:page};try{
 await nativeNotice(v,`Notice ${state} ${v.tag}`);
 // Freeze only screenshot/layout inspection: CI capture time must not consume the real 30-second cue lifetime.
 await v.p.clock.pauseAt(await v.p.evaluate(()=>Date.now()+100));
 try {
 await fullCapture(v.p,join(shots,`${v.tag}-live-${state}.png`));await v.p.evaluate(()=>document.querySelector('#tasks')?.scrollIntoView({block:'start'}));await cueClearance(v.p,`${state}-middle-${v.tag}`);await v.p.screenshot({path:join(shots,`${v.tag}-live-${state}-middle.png`)});
 if(v.width<=390){await v.p.evaluate(()=>{const m=document.querySelector('#main');m.scrollTop=m.scrollHeight;});await cueClearance(v.p,`${state}-end-${v.tag}`);await v.p.screenshot({path:join(shots,`${v.tag}-live-${state}-end.png`)});}
 let opened=false;try{await v.p.locator('#chatFab').click({timeout:800});opened=await v.p.locator('#chatIn').isVisible();}catch{}ok(opened,`actual Firstmate button opens with live cue ${state}-${v.tag}`);if(opened){const reachable=await v.p.evaluate(()=>['#chatClose','[data-new-card-show]','[data-new-card-dismiss]'].every(sel=>{const e=document.querySelector(sel),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));ok(reachable,`open Firstmate drawer and cue controls remain reachable ${state}-${v.tag}`);await v.p.screenshot({path:join(shots,`${v.tag}-live-${state}-drawer-cue.png`)});await v.p.locator('#chatClose').click();}
 } finally { await v.p.clock.resume(); }
 await v.p.locator('[data-new-card-show]').click();await v.p.waitForURL(/#\/inbox/);ok(true,`actual cue Show opens Inbox ${state}-${v.tag}`);await v.p.goto(`${base}/#/board`);await v.p.waitForSelector('[data-task]');
 await nativeNotice(v,`Dismiss ${state} ${v.tag}`);await v.p.locator('[data-new-card-dismiss]').click();ok(await v.p.locator('.rt-cue').count()===0,`actual cue Dismiss closes notice ${state}-${v.tag}`);
 }finally{await ctx.close();}}};
const answered=await mutate(`/api/scards/${ac.id}/answer`,{choice:'go',by:'captain'});ok(answered.status===200,'answer actual card through real server');
const q2card=async()=>{for(let i=0;i<60;i++){const c=(await p.evaluate(async id=>(await(await fetch('/api/scards?open=1')).json()).cards.find(x=>x.run===id&&x.node==='q2'),a.id));if(c)return c;await p.waitForTimeout(250);}return null;};
const next=await q2card();ok(!!next,'the Task moves on to its next card');
for(const v of live){await v.p.waitForSelector(`[data-task="${a.id}"] [data-inbox-link="${next?.id}"]`);ok(await v.p.locator(`[data-inbox-link="${ac.id}"]`).count()===0,`SSE moves the row to its next card after the Round completes ${v.tag}`);
 ok(await v.p.locator(`[data-task-detail="${a.id}"]`).count()===1,`live updates keep the selected Task and its panel ${v.tag}`);}
const rounds=await p.evaluate(async id=>(await(await fetch(`/api/tasks/${id}`)).json()).rounds,a.id);ok(rounds.some(r=>r.node==='q'&&r.endedAt),'captain Round really ended');await captures('moved');
let result=await mutate(`/api/tasks/${d.id}/archive`,{});ok(result.status===200,'archive real failed Task');for(const v of live)await v.p.waitForSelector(`[data-task="${d.id}"]`,{state:'detached'});await captures('archived');
result=await mutate(`/api/tasks/${d.id}/archive`,{archived:false});ok(result.status===200,'unarchive real failed Task',JSON.stringify(result));for(const v of live)await v.p.waitForSelector(`[data-task="${d.id}"]`);await captures('unarchived');
result=await mutate(`/api/tasks/${d.id}/delete`,{confirm:d.id});ok(result.status===200,'remove real failed Task',JSON.stringify(result));if(result.status===200)for(const v of live)await v.p.waitForSelector(`[data-task="${d.id}"]`,{state:'detached'});await captures('removed');
for(const v of live){ok(await v.p.evaluate(()=>window.overviewPageNonce==='same-document'),`all live transitions retain document ${v.tag}`);await v.ctx.close();}
// Multiple actual new cards legitimately link to the whole Inbox, rather than an individual card.
{const ctx=await browser.newContext(),q=await ctx.newPage();await q.goto(base+'/#/board');await q.waitForFunction(()=>window.studioCards?.ready());
const ids=await q.evaluate(async()=>{const ids=[];for(const title of ['Earlier broadcast','Current target']){const r=await fetch('/api/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workflow:'cue-notice',version:1,text:title,title})});ids.push((await r.json()).id);}return ids;});
await q.waitForFunction(ids=>ids.every(id=>window.studioCards.open().some(c=>c.run===id)),ids);
const observed=await q.evaluate(ids=>({newTasks:ids,newCards:window.studioCards.open().filter(c=>ids.includes(c.run)).map(c=>({run:c.run,id:c.id})),cueText:document.querySelector('.rt-cue')?.textContent,showHref:document.querySelector('[data-new-card-show]')?.getAttribute('href')}),ids);console.log(JSON.stringify(observed));
ok(observed.newCards.length===2&&observed.showHref==='#/inbox','multiple real fresh Task cards legitimately use the general Inbox link');await ctx.close();
}
// Separate real-runtime expiry control; other live pages are closed so broadcasts cannot reset this timer.
{const ctx=await browser.newContext({viewport:{width:1440,height:900}}),q=await ctx.newPage();await q.clock.install();
 const initial=q.waitForResponse(r=>r.url().includes('/api/scards?open=1'));await q.goto(base+'/#/board');await(await initial).finished();await q.evaluate(()=>document.readyState);
 await q.clock.pauseAt(await q.evaluate(()=>Date.now()+100));
 const r=await q.evaluate(async()=>{const response=await fetch('/api/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workflow:'cue-notice',version:1,text:'Cue expiry control',title:'Cue expiry control'})});return {status:response.status,data:await response.json()};});if(r.status!==200)throw new Error('Expiry fixture creation failed');
 let cardId;await pollUI(async()=>{const task=await q.evaluate(async id=>(await(await fetch('/api/tasks/'+id)).json()),r.data.id);cardId=task.cards?.find(c=>c.run===r.data.id)?.id;return !!cardId;},'expiry Task did not raise its card');
 // Advance the actual 150 ms scard debounce while network promises settle on the paused clock.
 for(let n=0;n<20&&!await noticeBound(q,cardId);n++){await q.clock.runFor(150);await new Promise(r=>setTimeout(r,40));}
 if(!await noticeBound(q,cardId))throw new Error('expiry cue was not bound to its actual new Task card');
 await q.clock.runFor(29999);ok(await noticeBound(q,cardId),'actual new-card cue remains before its 30-second expiry');
 await q.clock.runFor(1);ok(await q.locator('.rt-cue').count()===0,'actual new-card cue expires at 30 seconds');await ctx.close();}
}finally{await browser?.close();app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));}
console.log(`workflow-overview-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
