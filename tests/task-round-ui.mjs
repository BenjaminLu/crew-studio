import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Task/Round phase B: a real workflow, real /api/tasks-derived Rounds and legacy URLs.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { harness, until, Y } from './rt-harness.ts';
import { freePort, waitUp, withSession } from './boot.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let pass=0,fail=0; const ok=(v,n,e='')=>{console.log(`${v?'ok':'FAIL'} ${n} ${e}`);v?pass++:fail++;};
// Sweep only translated labels: execution verbs and legacy identifiers are intentional.
const taskNouns = /Start a run|Open run|Studio runs(?=$|:)|No run in flight|workflow runs|Cancel this run|Cancel the run|Cancel run…|No runs yet|Show a run on|No run overlay/;
const oldTerms = readdirSync(join(import.meta.dir,'../public')).filter(n=>n.endsWith('.js')).flatMap(n=>[...readFileSync(join(import.meta.dir,'../public',n),'utf8').matchAll(/T\((["'`])([\s\S]*?)\1/g)].filter(m=>taskNouns.test(m[2])).map(m=>`${n}: ${m[2]}`));
ok(!oldTerms.length,'translated public Task labels contain no old run noun',oldTerms.join(' | '));
const H=await harness([Y({id:'round-ui',name:'Rounds example',roles:[{id:'builder',label:'Builder',skill:'x'}],nodes:[
{id:'start',kind:'hook',label:'Start',do:'set',args:{key:'started',value:true},x:0,y:0},
{id:'build',kind:'agent',label:'Build',role:'builder',mode:'test',x:0,y:0},
{id:'test',kind:'check',label:'Tests',checks:[{use:'t/ok'}],x:1,y:0},
{id:'ship',kind:'card',label:'Ship?',card:{ body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, title:{en:'Ship it?', 'zh-TW':'要出貨嗎？'},options:[{id:'go',label:'Ship', labelZh: 'Ship'},{id:'redo',label:'Refine', labelZh: 'Refine'}]},x:2,y:0},
{id:'end',kind:'hook',label:'Done',x:3,y:0}],edges:[['start','build'],['build','test'],['test','ship','pass'],['ship','end','go'],['ship','build','redo']] }), Y({id:'empty-rounds',name:'Empty rounds',roles:[],nodes:[{id:'end',kind:'hook',label:'Done',x:0,y:0}],edges:[]})]);
const run=H.engine.start({workflow:'round-ui',text:'Build the example',title:'Round history'});
await until(()=>H.engine.get(run.id)?.status==='waiting',15000);
const card=H.engine.cards.list({run:run.id,open:true})[0];await H.engine.answer(card.id,{choice:'redo',by:'captain'});
await until(()=>H.engine.cards.list({run:run.id,open:true}).length>0&&H.engine.get(run.id)?.status==='waiting',15000);
await H.engine.answer(H.engine.cards.list({run:run.id,open:true})[0].id,{choice:'go',by:'captain'});
await until(()=>H.engine.get(run.id)?.status==='succeeded'&&!H.engine.busy(run.id),15000);
const waiting=H.engine.start({workflow:"round-ui",text:"Waiting for the captain",title:"Waiting task"});
const empty=H.engine.start({workflow:"empty-rounds",text:"No launches",title:"Empty history"});
await until(()=>H.engine.get(waiting.id)?.status==="waiting"&&H.engine.get(empty.id)?.status==="succeeded",15000);H.stop();
const port=await freePort(), base=`http://127.0.0.1:${port}`,root=join(import.meta.dir,'..');
mkdirSync(join(H.data,'fm','state'),{recursive:true});
process.env.CREW_SESSION_TOKEN='test-session';
const app=spawn('bun',['src/server.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,CREW_DATA:H.data,CREW_PORT:String(port),CREW_CHAT_PROVIDER:'stub',CREW_GH:'0',CREW_READONLY:'1',CREW_RETRO_AUTO:'0',CREW_SESSION_TOKEN:'test-session',CREW_FM_STATE:join(H.data,'fm','state'),CREW_CLAUDE_BIN:'/nonexistent',CREW_CODEX_BIN:'/nonexistent'}});
let browser;const shots=join(root,'tests/out/task-round');mkdirSync(shots,{recursive:true});
try{await waitUp(base,app);browser=withSession(await chromium.launch({headless:true}),base);
for(const width of [1440,390])for(const theme of ['light','dark']){
const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme});const p=await context.newPage();const capture=async(opts)=>{const f=p.locator('#chatFab');if(opts.fullPage)await f.evaluate(e=>e.style.visibility='hidden');await p.screenshot(opts);if(opts.fullPage)await f.evaluate(e=>e.style.visibility='');};
await p.goto(`${base}/#/run/${run.id}`);await p.waitForSelector('[data-runview]');
await p.evaluate((theme)=>{document.documentElement.dataset.theme=theme;document.body.classList.add('chat-closed');},theme);
const data=await p.evaluate(async(id)=>(await fetch(`/api/tasks/${id}`)).json(),run.id);
const rows=await p.locator('[data-round-id]').count();ok(rows===data.rounds.length&&rows===6,`real derived Rounds at ${width} ${theme}`,String(rows));
if(rows===6){const shown=await p.locator('[data-round-id]').evaluateAll(es=>es.map(e=>({id:e.dataset.roundId,node:e.dataset.roundNode,text:e.textContent})));
ok(shown.map(x=>x.id).join('|')===data.rounds.map(x=>x.id).join('|'),'Rounds retain engine order and identity');
for(const r of data.rounds){const row=p.locator(`[data-round-id="${r.id}"]`);const t=await row.textContent();ok(t.includes(r.actor.label)&&t.includes(`Round ${r.number}`)&&t.includes(`Attempt ${r.attempt}`),`node, actor, round and attempt ${r.node}`);
ok(await row.locator(`time[datetime="${r.startedAt}"]`).count()===1&&await row.locator(`time[datetime="${r.endedAt}"]`).count()===1,`actual start and end times ${r.node}`);
ok(t.includes(({chosen:'Chosen',passed:'Passed',superseded:'Replaced',failed:'Failed',error:'Error',running:'Running',waiting:'Waiting'})[r.outcome]),`actual outcome ${r.node}`);
const actorText=await row.locator('.rt-round-actor').textContent();
if(r.actor.kind==='agent'){ok((r.actor.provider==null||actorText.includes(r.actor.provider))&&(r.actor.model==null||actorText.includes(r.actor.model))&&!actorText.includes('null'),'actual agent provider/model');ok(await row.locator(`a[href="${r.transcript}"]`).count()===1&&t.includes(`$${r.cost.usd.toFixed(2)}`)&&t.includes(`${r.cost.inTokens} in / ${r.cost.outTokens} out tokens`),'actual agent cost and original transcript link');}else {ok(actorText.includes(r.actor.kind==='check'?r.actor.name:'Captain'),'actual check or captain actor');ok(await row.locator('a').count()===0,'non-agent has no invented transcript');}}
}
ok(!/\bRuns\b/.test(await p.locator('body').innerText()),'Task noun replaces Runs in visible page');
const agentStrip=await p.locator('.card:has(.rt-steps)').innerText();
ok(agentStrip.includes('Agent rounds')&&agentStrip.includes('Round 2')&&!/Agent steps|\bvisit\s+\d/i.test(agentStrip),'agent execution strip uses Agent rounds and actual Round 2',agentStrip);
const timeline=await p.locator('[data-timeline]').innerText();
ok(['Build','Tests','Ship?'].every(n=>timeline.includes(`${n}: Started (Round 2)`))&&!/\bvisit\s+\d/i.test(timeline),'Simple timeline calls actual repeated agent/check/card launches Round 2',timeline);

await p.goto(`${base}/#/tasks/${run.id}`);await p.waitForSelector('[data-runview]');ok(await p.locator('[data-round-id]').count()===6,'canonical Task URL keeps the same derived history');
await capture({path:join(shots,`task-${width}-${theme}.png`),fullPage:true});
await p.evaluate(()=>{const m=document.querySelector('#main');m.scrollTop=m.scrollHeight;document.scrollingElement.scrollTop=document.scrollingElement.scrollHeight;});
ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no sideways scroll');
ok(await p.evaluate(()=>{const f=document.querySelector('#chatFab'),list=document.querySelector('[data-rounds]');if(!f||!list)return true;const a=f.getBoundingClientRect(),b=list.getBoundingClientRect();return b.bottom<=a.top-40||b.right<=a.left||b.left>=a.right;}),'Rounds clear firstmate button at page end');
if(width===390)await capture({path:join(shots,`task-${width}-${theme}-end.png`)});
await p.click('[data-run-archive]');await p.waitForSelector('[data-runview] [data-archived]');ok(await p.locator('[data-round-id]').count()===6,'archive preserves derived Round history');
await p.click('[data-run-archive]');await p.waitForSelector('[data-runview] [data-archived]',{state:'detached'});ok(await p.locator('[data-round-id]').count()===6,'unarchive preserves derived Round history');
await p.evaluate(()=>setLang('zh-TW'));await p.waitForTimeout(200);ok(/回合/.test(await p.locator('body').innerText())&&/任務/.test(await p.locator('body').innerText()),'zh-TW Task and Round terms');

const zhStrip=await p.locator('.card:has(.rt-steps)').innerText();
ok(zhStrip.includes('Agent 回合')&&zhStrip.includes('第 2 回合')&&!/Agent 步驟|第 2 次/.test(zhStrip),'zh-TW agent execution strip uses actual 回合',zhStrip);
const zhTimeline=await p.locator('[data-timeline]').innerText();
ok(['Build','Tests','Ship?'].every(n=>zhTimeline.includes(`${n}: 開始（第 2 回合）`))&&!/visit 2|第 2 次/.test(zhTimeline),'zh-TW Simple timeline calls each repeated launch 第 2 回合',zhTimeline);
await capture({path:join(shots,`task-zh-${width}-${theme}.png`),fullPage:true});
await p.goto(`${base}/#/run/${waiting.id}`);await p.waitForSelector('[data-rounds]');ok(/尚未/.test(await p.locator('[data-rounds]').innerText()),'waiting Round never invents its end time');await capture({path:join(shots,`waiting-${width}-${theme}.png`),fullPage:true});
await p.goto(`${base}/#/run/${empty.id}`);await p.waitForSelector('[data-rounds]');ok(/還沒有回合/.test(await p.locator('[data-rounds]').innerText()),'empty history has a clear message');await capture({path:join(shots,`empty-${width}-${theme}.png`),fullPage:true});
await p.goto(`${base}/#/tasks`);await p.waitForSelector('[data-run-start]');ok((await p.locator('h1').textContent())==='任務','Tasks URL renders Tasks');
await p.goto(`${base}/#/runs`);await p.waitForSelector('[data-run-start]');ok((await p.locator('h1').textContent())==='任務','legacy Runs URL renders Tasks');await capture({path:join(shots,`tasks-${width}-${theme}.png`),fullPage:true});
await p.goto(`${base}/#/board`);await p.waitForSelector(`[data-task="${run.id}"]`);const ended=p.locator(`[data-task="${run.id}"]`);ok(await ended.evaluate(e=>getComputedStyle(e).textDecorationLine==='none'),'recently ended Task row (Done today) has no browser underline');await p.keyboard.press("Tab");await ended.focus();ok(await ended.evaluate(e=>e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none'),'recently ended Task row has keyboard focus');await capture({path:join(shots,`board-${width}-${theme}.png`),fullPage:true});
await context.close();}
}finally{await browser?.close();app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));}
console.log(`task-round-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
