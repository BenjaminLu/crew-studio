import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The readiness gate in a real browser against the actual server (throwaway data, offline Codex
// fixture as Firstmate, no model, no network): the draft preview shows the intent-line mapping, every
// stage with step / reason / fix, collapsed briefs and the repair round; the workflow page shows the
// gate for its exact version, "Not verified yet" next to Run and "Verify with a real run".
// Screenshots: 1280 light (en) and 390 dark (zh-TW) of both pages, in tests/out/workflow-gate.
import{spawn}from'node:child_process';import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';
import{freePort,waitUp,withSession}from'./boot.mjs';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'..'),dir=mkdtempSync(join(tmpdir(),'crew-gate-ui-')),data=join(dir,'data'),home=join(dir,'home'),shots=join(root,'tests/out/workflow-gate');
mkdirSync(data);mkdirSync(join(home,'.codex'),{recursive:true});mkdirSync(shots,{recursive:true});
writeFileSync(join(home,'.codex','config.toml'),'model="fixture-model"\nmodel_reasoning_effort="low"\n');writeFileSync(join(home,'.codex','.fixture-account.json'),'{"authenticated":true}');
// codex shows as logged in (a login file on disk, read only); Claude has no login in this home
writeFileSync(join(home,'.codex','auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'aaaaaaaaaa.bbbbbbbbbb.cccccccccc'}}));
const port=await freePort(),base=`http://127.0.0.1:${port}`,token='gate-ui-session',env={...process.env};for(const key of Object.keys(env))if(/TOKEN|API_KEY/.test(key))delete env[key];delete env.CREW_MAIN_PROJECT;delete env.CREW_FM_STATE;delete env.CREW_DATA;delete env.CREW_PORT;
const fixture=join(here,'fixture/codex-account.mjs');
const app=spawn('bun',['src/server.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_RUNTIME_DIR:join(dir,'runtime'),CREW_PORT:String(port),CREW_SESSION_TOKEN:token,CREW_GH:'0',CREW_GH_NO_CLI:'1',CREW_LOCAL_UNRESTRICTED:'0',CREW_GATE_REPAIR_WAIT_MS:'400',CREW_CHAT_PROVIDER:'stub',CREW_RETRO_AUTO:'0',CREW_INSTALL_RUNNER:'mock',CREW_NO_REAL_INSTALL:'1',CREW_CLAUDE_BIN:'/nonexistent/claude',CREW_CODEX_BIN:'/nonexistent/codex',CREW_HOST_CODEX_BIN:fixture,CREW_HOST_CLAUDE_BIN:'/nonexistent/claude',ACCOUNT_FIXTURE_DRAFT:join(here,'fixture/first-workflow-draft.json')}});
let appLog='';app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);let browser,pass=0,fail=0;
const ok=(value,name,detail='')=>{if(value){pass++;console.log('  ok    '+name);}else{fail++;console.log('  FAIL  '+name+' '+detail);}};
const api=async(path,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-crew-session':token},body:body===undefined?undefined:JSON.stringify(body)});let j={};try{j=await r.json();}catch{}return{status:r.status,body:j};};
const until=async(f,ms=20000)=>{const t=Date.now();while(Date.now()-t<ms){if(await f())return true;await new Promise(r=>setTimeout(r,60));}return false;};
const FX=JSON.parse(readFileSync(join(here,'fixture/first-workflow-draft.json'),'utf8'));
try{
 await waitUp(base,app);browser=withSession(await chromium.launch(),base,token);
 ok((await api('/api/main/start',{host:'codex',confirm:true})).status===200,'offline Firstmate primary starts');
 await until(async()=>!(await api('/api/main')).body.busy);
 const send=async(args)=>{const before=(await api('/api/wf/drafts')).body.drafts?.length??0;await api('/api/main/send',{text:'NATIVE-TOOL '+JSON.stringify({name:'studio_draft_workflow',args})});await until(async()=>((await api('/api/wf/drafts')).body.drafts?.length??0)>before&&!(await api('/api/main')).body.busy);return (await api('/api/wf/drafts')).body.drafts[0].id;};
 // A structurally valid draft reaches readiness with a required Start input missing.
 const broken=JSON.parse(JSON.stringify(FX));broken.workflow.params={city:{label:'City'}};broken.workflow.nodes.find(n=>n.id==='approve').card.body='Choose events in {{params.city}}';
 const bad=await send(broken);
 ok(await until(async()=>{const v=(await api(`/api/wf/drafts/${bad}/gate`)).body;return v.gate&&v.gate.stages.every(s=>s.status!=='running')&&v.repair?.rounds?.length>0;}),'the gate fails the draft and starts a repair round');
 const bv=(await api(`/api/wf/drafts/${bad}/gate`)).body;
 // the offline fixture never revises: each repair turn ends without a revision, and the loop still reaches its cap and the final notice
 ok(await until(async()=>(await api(`/api/wf/drafts/${bad}/gate`)).body.repair?.status==='not-verified',60000),'the loop reaches its cap when Firstmate brings no revision',JSON.stringify((await api(`/api/wf/drafts/${bad}/gate`)).body.repair).slice(0,300));
 ok(!JSON.stringify((await api(`/api/wf/drafts/${bad}/gate`)).body).includes('"nonce"'),'the gate view never carries the repair one-time code');
 ok(await until(async()=>JSON.stringify((await api('/api/main')).body.log??[]).includes(`GATE-REPAIR ${bad}`)),'the repair round is visible in the Firstmate chat',JSON.stringify((await api('/api/main')).body.log?.slice(-3)).slice(0,400));
 ok(bv.gate.stages.find(s=>s.id==='contract').problems.some(p=>p.code==='param-no-input'&&p.node==='approve'),'stage 2 names the missing Start input and its node');
 ok(!bv.gate.stages.find(s=>s.id==='contract').problems.some(p=>p.code==='provider-not-logged-in'),'codex reads as logged in from its login file on disk (read only, no sign-in)');
 // a passing draft, saved as the captain's workflow
 const good=JSON.parse(JSON.stringify(FX));Object.assign(good.workflow.nodes.find(n=>n.id==='review'),{provider:'codex',model:'fixture-model',effort:'low'});
 const gd=await send(good);
 ok(await until(async()=>(await api(`/api/wf/drafts/${gd}/gate`)).body.passed),'the fixture draft passes stages 1-4 on the real server',JSON.stringify((await api(`/api/wf/drafts/${gd}/gate`)).body.gate?.stages?.map(s=>[s.id,s.status,s.problems.map(p=>p.code)])));
 const rev=(await api(`/api/wf/drafts/${gd}`)).body.draft.revision;const saved=await api(`/api/wf/drafts/${gd}/save`,{revision:rev});ok(saved.status===200,'the passing draft saves');
 const wid=saved.body.workflow;
 // a failing workflow: the captain adds a "skip" option no edge takes, as v2 of another saved draft
 const fd=await send(good);await until(async()=>(await api(`/api/wf/drafts/${fd}/gate`)).body.passed);
 const fsaved=await api(`/api/wf/drafts/${fd}/save`,{revision:(await api(`/api/wf/drafts/${fd}`)).body.draft.revision});const fwid=fsaved.body.workflow;
 const fdef=(await api(`/api/wf/${fwid}`)).body.def;
 ok((await api(`/api/wf/${fwid}`,{base:1,nodes:fdef.nodes.map(n=>n.id==='approve'?{...n,card:{ body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, ...n.card,options:[...n.card.options,{id:'skip',label:'Skip', labelZh: 'Skip'}]}}:n),edges:fdef.edges,roles:fdef.roles})).status===200,'the captain saves a v2 with an option no edge takes');
 ok(await until(async()=>{const v=(await api(`/api/wf/${fwid}/gate`)).body;return v.gate&&v.gate.stages.every(s=>s.status!=='running');}),'the gate runs on the new version');
 // a fresh, unsaved passing draft: its Save button sits clear of the floating Firstmate button
 const sd=await send(good);await until(async()=>(await api(`/api/wf/drafts/${sd}/gate`)).body.passed);
 for(const [width,theme,lang] of [[1280,'light','en'],[390,'dark','zh-TW']]){
  const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:theme});await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const tag=`${width}-${theme}-${lang}`;const posts=[];p.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
  await p.goto(base+'/#/');await p.evaluate(({theme,lang})=>{setTheme(theme);setLang(lang);},{theme,lang});
  // draft preview
  await p.goto(base+`/#/first-workflow/${bad}`);await p.waitForSelector('[data-draft-gate] [data-gate]',{timeout:15000});await p.evaluate(()=>window.openChat?.(false));await p.waitForTimeout(300);
  ok(await p.locator('[data-gate-stage]').count()===5,`${tag} draft preview shows all five stages`);
  ok(await p.locator('[data-gate-stage="contract"][data-gate-state="fail"] [data-gate-problem="param-no-input"]').count()===1,`${tag} the failing stage lists the problem`);
  const prob=await p.locator('[data-gate-problem="param-no-input"]').innerText();
  ok(lang==='en'?/Step: ?approve/.test(prob)&&/Reason:/.test(prob)&&/How to fix:/.test(prob):/步驟：\s*approve/.test(prob)&&/原因：/.test(prob)&&/修正方式：/.test(prob),`${tag} each problem shows step, reason and how to fix`,prob);
  const nProb=await p.locator('[data-gate-stage="contract"] [data-gate-problem]').count(),line=await p.locator('[data-gate-status]').first().innerText();
  ok(new RegExp(`\\(${nProb} (problem|個問題)`).test(line)||new RegExp(`（${nProb} 個問題`).test(line),`${tag} the failing stage count matches its list`,`${nProb} vs ${line}`);
  ok(await p.locator('[data-gate-notice="not-verified"]').count()===1&&(lang==='en'?/Not verified after 6 repair rounds/:/修正 6 輪後仍未通過驗證/).test(await p.locator('[data-gate-notice]').innerText())&&await p.locator('[data-gate-notice] button').count()===0,`${tag} the final notice is plain text with no options`);
  ok(await p.locator('[data-gate-problem="staffing-missing"]').count()===0,`${tag} captain notices are not listed as problems`);
  ok(await p.locator('[data-gate-intents="2"] [data-intent-line]').count()===2&&await p.locator('[data-intent-line="1"] [data-serves-node="draft"]').count()===1,`${tag} the preview maps each intent line to the nodes that serve it`);
  ok(await p.locator('details[data-gate-rounds]').count()===1,`${tag} the repair round is visible in the preview`);
  ok(await p.locator('details[data-gate-briefs]').evaluate(d=>!d.open),`${tag} rendered briefs are collapsed`);
  await p.locator('details[data-gate-briefs] > summary').click();await p.locator('details[data-gate-brief="draft"] > summary').click();
  const briefText=await p.locator('[data-gate-brief="draft"] pre').innerText();
  ok(briefText.startsWith('# Studio safety rules')&&briefText.includes('# Operating rules (set by the captain)')&&/=== BEGIN OPERATING RULES [a-f0-9]{16} ===/.test(briefText),`${tag} the rendered brief carries the safety rules and the captain's operating rules block`);
  await p.locator('details[data-gate-briefs] > summary').click();
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tag} draft preview has no horizontal scroll`);
  await p.locator('[data-draft-gate]').scrollIntoViewIfNeeded();await p.screenshot({path:join(shots,`draft-preview-${tag}.png`),fullPage:true});
  // the save button of a passing unsaved draft is clear of the floating Firstmate button when scrolled to the end
  await p.goto(base+`/#/first-workflow/${sd}`);await p.waitForSelector('[data-first-workflow-save-draft]',{timeout:15000});await p.evaluate(()=>window.openChat?.(false));await p.waitForTimeout(300);
  await p.evaluate(()=>{const b=document.querySelector('[data-first-workflow-save-draft]');let e=b.parentElement;while(e&&e!==document.body){if(e.scrollHeight>e.clientHeight+4&&/(auto|scroll)/.test(getComputedStyle(e).overflowY))e.scrollTop=e.scrollHeight;e=e.parentElement;}window.scrollTo(0,document.body.scrollHeight);});await p.waitForTimeout(200);
  const clear=await p.evaluate(()=>{const a=document.querySelector('[data-first-workflow-save-draft]').getBoundingClientRect(),f=document.getElementById('chatFab');if(!f||getComputedStyle(f).display==='none')return true;const b=f.getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;});
  ok(clear,`${tag} Save as my workflow is clear of the floating Firstmate button`);
  if(width===1280)await p.screenshot({path:join(shots,`draft-save-${tag}.png`)});
  // failing workflow page
  await p.goto(base+`/#/workflows/${fwid}`);await p.waitForSelector('[data-gate-host] [data-gate]',{timeout:15000,state:'attached'});await p.evaluate(()=>window.openChat?.(false));await p.waitForTimeout(400);
  ok(await p.locator('[data-gate-host]').evaluate(d=>d.open)&&await p.locator('[data-gate-host] [data-gate-stage="contract"][data-gate-state="fail"] [data-gate-problem="outcome-unhandled"]').count()===1,`${tag} a failing workflow page opens its gate with the problem`);
  const ftag=await p.locator('[data-run-verified]').innerText();ok(lang==='en'?/Not verified yet · stage 2 failing/.test(ftag):/尚未驗證・第 2 關未通過/.test(ftag),`${tag} Run shows the failing stage`,ftag);
  ok(await p.locator('[data-gate-verify]').count()===0,`${tag} no real-run verification while stages 1-4 fail`);
  ok(await p.locator('[data-gate-host] > summary').innerText().then(t=>!/stage/i.test(t)),`${tag} the status line is not repeated in the summary`);
  await p.locator('[data-gate-host]').scrollIntoViewIfNeeded();await p.screenshot({path:join(shots,`workflow-page-failing-${tag}.png`),fullPage:true});
  // workflow page
  await p.goto(base+`/#/workflows/${wid}`);await p.waitForSelector('[data-gate-host] [data-gate]',{timeout:15000,state:'attached'});await p.evaluate(()=>window.openChat?.(false));await p.waitForTimeout(300);
  ok(await p.locator('[data-gate-host]').evaluate(d=>!d.open),`${tag} a passing gate starts collapsed above the graph`);
  await p.locator('[data-gate-host] > summary').click();
  ok(await p.locator('[data-gate-host] [data-gate-stage][data-gate-state="pass"]').count()===4,`${tag} the workflow page shows stages 1-4 passing for this version`);
  const runTag=await p.locator('[data-run-verified]').innerText();ok(lang==='en'?/Not verified yet/.test(runTag):/尚未驗證/.test(runTag),`${tag} Run shows Not verified yet`,runTag);
  ok(await p.locator('[data-gate-verify]').count()===1,`${tag} the workflow page offers Verify with a real run`);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tag} workflow page has no horizontal scroll`);
  await p.locator('[data-gate-host]').scrollIntoViewIfNeeded();await p.screenshot({path:join(shots,`workflow-page-${tag}.png`),fullPage:true});
  ok(!posts.includes('/api/wruns')&&!posts.some(x=>/gate\/smoke/.test(x)),`${tag} viewing the gate starts no Task`);
  ok(!errors.length,`${tag} no page errors`,errors.join('; '));
  await ctx.close();
 }
}catch(e){fail++;console.log('  FAIL  exception',e?.stack??e,appLog.slice(-2000));}
finally{await browser?.close();if(app.exitCode===null){const done=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await done;}try{rmSync(dir,{recursive:true,force:true});}catch{}}
console.log(`workflow-gate-ui: ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
