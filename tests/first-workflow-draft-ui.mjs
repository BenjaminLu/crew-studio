import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Free first workflow, in a real browser against the actual server. The owned offline Codex
// app-server fixture plays the model: the captain sends the prefilled interview message and the
// fixture answers by calling studio_draft_workflow with tests/fixture/first-workflow-draft.json.
// Asserts: live model-labeled preview, inline node model config that persists, save without a Task,
// and a staffing confirmation that appears only when the captain clicks Run.
import{spawn}from'node:child_process';import{mkdtempSync,mkdirSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';
import{freePort,waitUp,withSession}from'./boot.mjs';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const here=dirname(fileURLToPath(import.meta.url)),root=process.env.FIRST_WORKFLOW_BASE||join(here,'..'),dir=mkdtempSync(join(tmpdir(),'crew-first-draft-ui-')),data=join(dir,'data'),home=join(dir,'home'),shots=join(root,'tests/out/first-workflow');
mkdirSync(data);mkdirSync(join(home,'.codex'),{recursive:true});mkdirSync(shots,{recursive:true});
writeFileSync(join(home,'.codex','config.toml'),'model="fixture-model"\nmodel_reasoning_effort="low"\n');writeFileSync(join(home,'.codex','.fixture-account.json'),'{"authenticated":true}');
const port=await freePort(),base=`http://127.0.0.1:${port}`,token='first-draft-ui-session',env={...process.env};for(const key of Object.keys(env))if(/TOKEN|API_KEY/.test(key))delete env[key];delete env.CREW_MAIN_PROJECT;delete env.CREW_FM_STATE;
const fixture=join(here,'fixture/codex-account.mjs');
const app=spawn('bun',['src/server.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_RUNTIME_DIR:join(dir,'runtime'),CREW_PORT:String(port),CREW_SESSION_TOKEN:token,CREW_GH:'0',CREW_GH_NO_CLI:'1',CREW_CHAT_PROVIDER:'stub',CREW_RETRO_AUTO:'0',CREW_INSTALL_RUNNER:'mock',CREW_NO_REAL_INSTALL:'1',CREW_CLAUDE_BIN:'/nonexistent/claude',CREW_CODEX_BIN:'/nonexistent/codex',CREW_HOST_CODEX_BIN:fixture,CREW_HOST_CLAUDE_BIN:'/nonexistent/claude',ACCOUNT_FIXTURE_DRAFT:join(here,'fixture/first-workflow-draft.json')}});
let appLog='';app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);let browser,pass=0,fail=0;
const ok=(value,name,detail='')=>{if(value){pass++;console.log('  ok    '+name);}else{fail++;console.log('  FAIL  '+name+' '+detail);}};
try{
 await waitUp(base,app);browser=withSession(await chromium.launch(),base,token);
 // the captain starts the Firstmate primary (an explicit captain action; the fixture is offline)
 const started=await (await fetch(base+'/api/main/start',{method:'POST',headers:{'content-type':'application/json','x-crew-session':token},body:JSON.stringify({host:'codex',confirm:true})})).status;ok(started===200,'offline Firstmate primary starts');
 // B3 bundled workflows take per-node provider, model, effort and skills too (agent and loop nodes); a new version applies to new Tasks
 {const ctx=await browser.newContext({viewport:{width:1280,height:900}});const p=await ctx.newPage();await p.goto(base+'/#/workflows/documents/advanced');await p.waitForSelector('[data-editor]',{timeout:8000});const n=p.locator('svg [data-node="draft"]').first();await n.focus();await p.keyboard.press('Enter');await p.locator('[data-node-skills]').first().waitFor({timeout:5000});const cfg=p.locator('[data-node-model-config="draft"]');ok(await cfg.count()===1&&await cfg.locator('[data-node-config-note="saved"]').count()===1&&await cfg.locator('[data-node-config-effort]').count()===1,'B3 bundled workflow editor shows the node\'s provider, model and effort (applies to new Tasks, no Run-staffing note)');
  await p.click('[data-view-toggle="detail"]');await p.waitForSelector('svg.rt-graph[data-view="detail"] [data-node="refine"]',{timeout:8000});await p.locator('svg [data-node="refine"]').first().focus();await p.keyboard.press('Enter');await p.locator('[data-node-model-config="refine"]').waitFor({timeout:5000});ok(await p.locator('[data-node-model-config="refine"] [data-node-config-model]').count()===1&&await p.locator('[data-node-skills]').count()>=1,'B3 a loop node takes its own model, effort and skills too');await ctx.close();}
 const flow=async(width,theme,lang,tag)=>{
  const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:theme});await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());const p=await ctx.newPage();
  const posts=[];p.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});const runPosts=()=>posts.filter(x=>x==='/api/wruns').length;
  await p.goto(base+'/#/');await p.evaluate(({theme,lang})=>{setTheme(theme);setLang(lang);},{theme,lang});
  // B2 the first-use journey's "Build my first workflow" closes the journey (without skipping onboarding)
  const entry=p.locator('[data-ob-own-workflow]');let viaJourney=false;try{await entry.waitFor({timeout:8000});viaJourney=true;}catch{}
  if(viaJourney)await entry.click();else await p.goto(base+'/#/first-workflow');
  await p.waitForSelector('[data-first-workflow]',{timeout:8000});await p.locator('[data-custom-workflow]').evaluate(e=>e.open=true);await p.waitForTimeout(400);
  if(tag==='desktop'){ok(viaJourney,'B2 the first-use journey offers Build my first workflow');
   const covered=await p.evaluate(()=>{const ids=['[data-first-workflow-goal]','[data-first-workflow-preview-button]'];return ids.filter(sel=>{const e=document.querySelector(sel);e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !(top===e||e.contains(top));});});
   ok(!covered.length,'B2 nothing covers the goal input or the starter button after the journey link',JSON.stringify(covered));
   const ob=await p.evaluate(async()=>(await (await fetch('/api/onboarding')).json()));ok(!ob.paused,'B2 the link closes the journey without skipping onboarding',JSON.stringify(ob).slice(0,200));}
  ok(await p.locator('[data-roadmap]').count()===0,`${tag} all six journey steps are available`);
  await p.locator('[data-first-workflow-goal]').fill('A weekly newsletter about local coffee events');
  ok(!(await p.locator('[data-staffing-confirm]').count()),`${tag} no staffing confirmation while drafting`);
  await p.locator('[data-first-workflow-chat]').click();
  const prefill=await p.locator('#chatIn').inputValue();ok(prefill.includes('A weekly newsletter about local coffee events'),`${tag} chat is prefilled with the goal`);
  ok(!/studio_/.test(prefill),`${tag} W5 the visible prefill names no internal tool`,prefill);
  ok(!posts.includes('/api/main/send'),`${tag} prefill never sends by itself`);
  await p.waitForFunction(()=>!document.querySelector('#chatSend')?.disabled,null,{timeout:10000}).catch(()=>{});
  await p.screenshot({path:join(shots,`${tag}-1-interview.png`)});
  await p.locator('#chatSend').click();
  await p.waitForSelector('[data-first-workflow-source="model"]',{timeout:15000});
  ok(await p.locator('[data-first-workflow-badge="model"]').count()===1,`${tag} preview is labeled as model output`);
  ok(await p.locator('details[data-graph-json]').evaluate(d=>!d.open),`${tag} W7 graph JSON is collapsed by default`);
  ok((await p.locator('[data-first-workflow-json]').textContent()).includes('"review"'),`${tag} preview carries the generated graph JSON`);
  ok(await p.locator('[data-draft-node]').count()===5,`${tag} live preview draws every generated node`);
  await p.evaluate(()=>window.openChat?.(false));await p.waitForTimeout(300);
  await p.screenshot({path:join(shots,`${tag}-2-preview.png`),fullPage:true});
  await p.locator('[data-draft-node="review"]').click();
  const cfg=p.locator('[data-node-config="review"]');await cfg.waitFor({timeout:5000});
  await cfg.locator('[data-node-config-provider]').selectOption('claude');
  await cfg.locator('[data-node-config-model]').selectOption('__custom__');await cfg.locator('[data-node-config-custom-model]').fill('claude-fixture');
  await cfg.locator('[data-node-config-effort]').selectOption('high');
  await cfg.locator('[data-node-config-skill]').selectOption('bundled:workflows/skills/v2/designer.md');
  await cfg.locator('[data-node-config-save]').click();
  await p.waitForFunction(()=>document.querySelector('[data-first-workflow-badge]')?.dataset.edited==='1',null,{timeout:5000}).catch(()=>{});
  await cfg.scrollIntoViewIfNeeded().catch(()=>{});await p.screenshot({path:join(shots,`${tag}-3-node-config.png`)});
  // typing in Model then one click on Save must save (no swallowed first click)
  {const revOf=async()=>p.evaluate(async()=>{const j=await (await fetch('/api/wf/drafts')).json();return j.drafts[0].revision;});const before=await revOf();
   const c=p.locator('[data-node-config="review"]');await c.locator('[data-node-config-model]').selectOption('__custom__');await c.locator('[data-node-config-custom-model]').fill('');await c.locator('[data-node-config-custom-model]').pressSequentially('claude-fixture-2',{delay:120});await c.locator('[data-node-config-save]').click();
   await p.waitForTimeout(1500);const after=await revOf();ok(after===before+1,`${tag} one click on Save after typing in Model saves`,`${before}->${after}`);
   await p.locator('[data-node-config="review"] [data-node-config-model]').selectOption('__custom__');await p.locator('[data-node-config="review"] [data-node-config-custom-model]').fill('claude-fixture');await p.locator('[data-node-config="review"] [data-node-config-save]').click();await p.waitForTimeout(1200);}
  await p.reload();await p.waitForSelector('[data-first-workflow-source="model"]',{timeout:8000});
  ok(await p.locator('[data-draft-node="review"] [data-node-skill]').count()===1,`${tag} W7 the node chip shows the skill override`);
  await p.locator('[data-draft-node="review"]').click();const cfg2=p.locator('[data-node-config="review"]');await cfg2.waitFor();
  ok(await cfg2.locator('[data-node-config-provider]').inputValue()==='claude'&&await cfg2.locator('[data-node-config-model]').inputValue()==='claude-fixture'&&await cfg2.locator('[data-node-config-effort]').inputValue()==='high'&&await cfg2.locator('[data-node-config-skill]').inputValue()==='bundled:workflows/skills/v2/designer.md',`${tag} inline node config persists across reload`);
  ok(await p.locator('[data-first-workflow-badge][data-edited="1"]').count()===1,`${tag} label says the captain edited the model draft`);
  ok(runPosts()===0,`${tag} drafting and inline edits start no Task`);
  await p.locator('[data-first-workflow-save-draft]').click();await p.waitForURL(/#\/workflows\/weekly-coffee-newsletter-/,{timeout:8000});
  await p.waitForSelector('[data-editor]',{timeout:8000});
  ok(runPosts()===0,`${tag} saving starts no Task`);
  const note=await p.locator('[data-editor] .rt-toolbar select').first().innerText();ok(lang==='zh-TW'?note.includes('由 Firstmate 草稿儲存'):note.includes('Saved from a Firstmate draft'),`${tag} W7 the v1 note is localized`,note);
  const editorNode=p.locator('svg [data-node="review"]').first();await editorNode.focus();await p.keyboard.press('Enter');
  const panel=p.locator('[data-node-model-config="review"]');await panel.waitFor({timeout:5000});
  ok(await panel.locator('[data-node-config-provider]').inputValue()==='claude'&&await panel.locator('[data-node-config-effort]').inputValue()==='high',`${tag} editor panel shows the inline node config`);
  ok(!(await p.locator('[data-staffing-confirm]').count()),`${tag} editor shows no staffing confirmation before Run`);
  await panel.locator('[data-node-config-model] option[value="claude-opus-5-5"]').waitFor({state:'attached'});
  await panel.locator('[data-node-config-model]').selectOption('claude-opus-5-5');await panel.locator('[data-node-config-effort]').selectOption('medium');
  await p.locator('[data-save]').click();await p.waitForTimeout(500);
  const stored=await p.evaluate(async()=>{const id=location.hash.split('/')[2];return(await(await fetch('/api/wf/'+id)).json()).def;});
  ok(stored.version===2&&stored.nodes.find(n=>n.id==='review').model==='claude-opus-5-5'&&stored.nodes.find(n=>n.id==='review').effort==='medium',`${tag} editor dropdown saves selected Claude model and effort in v2`);

  await panel.scrollIntoViewIfNeeded().catch(()=>{});await p.screenshot({path:join(shots,`${tag}-4-editor.png`)});
  await p.evaluate(()=>scrollTo(0,0));await p.locator('[data-ed-run]').click();await p.locator('[data-start-brief]').fill('Create a welcoming coffee newsletter for weekend visitors.');await p.locator('[data-start-inputs-ok]').click();
  const confirm=p.locator('[data-staffing-confirm]');await confirm.waitFor({timeout:8000});
  ok(await confirm.locator('[data-staffing-row]').count()===2,`${tag} Run shows one staffing row per agent node`);
  ok((await confirm.innerText()).includes('claude-opus-5-5'),`${tag} confirmation lists the chosen model`);
  const broken=await confirm.evaluate(d=>{const out=[];for(const td of d.querySelectorAll('td')){const t=td.firstChild;if(!t||t.nodeType!==3)continue;let i=0;for(const tok of t.data.split(/(\s+)/)){if(tok.trim()){const r=document.createRange();r.setStart(t,i);r.setEnd(t,i+tok.length);const tops=new Set([...r.getClientRects()].map(x=>Math.round(x.top)));if(tops.size>1)out.push(tok);}i+=tok.length;}}return out;});
  ok(!broken.length,`${tag} W6 no staffing cell breaks a word or model id mid-token`,JSON.stringify(broken));
  ok(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`${tag} no horizontal page scroll with the confirmation open`);
  await p.screenshot({path:join(shots,`${tag}-5-run-confirm.png`)});
  const runsBefore=await p.evaluate(async()=>(await (await fetch('/api/wruns')).json()).runs.filter(r=>/^weekly-coffee/.test(r.workflow)&&!['cancelled'].includes(r.status)).length);ok(runsBefore===0,`${tag} no Task exists while the confirmation is open`);
  await confirm.locator('[data-staffing-cancel]').click();ok(!(await p.locator('[data-staffing-confirm]').count()),`${tag} cancel closes the confirmation without a Task`);
  await p.locator('[data-ed-run]').click();await p.locator('[data-start-brief]').fill('Create a welcoming coffee newsletter for weekend visitors.');await p.locator('[data-start-inputs-ok]').click();await p.locator('[data-staffing-confirm]').waitFor();await p.locator('[data-staffing-approve]').click();
  await p.waitForURL(/#\/run\/R-/,{timeout:8000});const id=p.url().match(/R-\d+/)[0];const run=await p.evaluate(async id=>(await (await fetch('/api/wruns/'+id)).json()),id);ok(run.text?.includes('A weekly newsletter about local coffee events'),`${tag} W1 the started Task carries the captain brief`);
  await p.screenshot({path:join(shots,`${tag}-6-task.png`)});
  await p.evaluate(async id=>fetch(`/api/wruns/${id}/cancel`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),id);
  const draftId=await p.evaluate(async()=>(await (await fetch('/api/wf/drafts')).json()).drafts[0].id);
  ok(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`${tag} no horizontal page scroll`);
  await ctx.close();return draftId;
 };
 const draftId=await flow(1280,'light','en','desktop');
 await flow(390,'dark','zh-TW','phone-zh');
 // the node choices list arrives late (the first load fails, the retry is slow): typing, a pause, then ONE click on Save must save what was typed
 {const ctx=await browser.newContext({viewport:{width:1280,height:900}});let mode='abort';await ctx.route(/\/api\/wf\/drafts$/,async r=>{if(mode==='abort')return r.abort();if(mode==='slow')await new Promise(x=>setTimeout(x,1200));return r.continue();});const p=await ctx.newPage();
  await p.goto(base+'/#/first-workflow');await p.waitForSelector('[data-first-workflow]');await p.locator('[data-custom-workflow]').evaluate(e=>e.open=true);await p.waitForTimeout(1000);mode='normal';
  await p.locator('[data-first-workflow-goal]').fill('Late options check');await p.locator('[data-first-workflow-chat]').click();await p.locator('#chatSend').click();await p.evaluate(()=>window.openChat?.(false));
  await p.waitForFunction(()=>document.querySelector('[data-first-workflow-source="model"]')&&!document.querySelector('[data-first-workflow-open-saved]'),null,{timeout:15000});
  const before=await p.evaluate(async()=>{const j=await (await fetch('/api/wf/drafts')).json();return j.drafts.find(d=>!d.saved).revision;});
  mode='slow';await p.locator('[data-draft-node="review"]').click();const c=p.locator('[data-node-config="review"]');await c.waitFor();
  await c.locator('[data-node-config-model]').selectOption('__custom__');await c.locator('[data-node-config-custom-model]').pressSequentially('typed-model-x',{delay:20});await p.waitForTimeout(2500);mode='normal';
  await p.locator('[data-node-config="review"] [data-node-config-save]').click();await p.waitForTimeout(1500);
  const after=await p.evaluate(async()=>{const j=await (await fetch('/api/wf/drafts')).json();const d=j.drafts.find(d=>!d.saved);const full=await (await fetch('/api/wf/drafts/'+d.id)).json();return{rev:d.revision,model:full.draft.def.nodes.find(n=>n.id==='review').model};});
  ok(after.rev===before+1&&after.model==='typed-model-x','one click on Save saves the typed model even when the choices list arrives late',JSON.stringify({before,after}));await ctx.close();}
 const phone=await browser.newContext({viewport:{width:390,height:900}});const q=await phone.newPage();await q.goto(base+'/#/first-workflow/'+draftId);await q.waitForSelector('[data-first-workflow-source="model"]',{timeout:8000});
 ok(await q.locator('[data-first-workflow-open-saved]').count()===1,'a saved draft links to its workflow instead of saving twice');await phone.close();
}catch(e){fail++;console.log('  FAIL  exception',e?.stack||e);console.log(appLog.slice(-1500));}
finally{await browser?.close();app.kill('SIGTERM');try{rmSync(dir,{recursive:true,force:true});}catch{}}
console.log(`first-workflow-draft-ui: ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
