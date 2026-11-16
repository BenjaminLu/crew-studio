import "./lib/isolated-env.mjs";
// The Workflows page with the internal pr-follow workflow (the Pull requests page's follow-through) in a real isolated
// Studio and Chromium (temporary data, a free port, no accounts): its card under "started by Studio" with no Rename or
// Trash, whether follow-through is on, its read-only page (the graph without editing, every branch and the card it makes,
// the link to the Pull requests settings), no other internal workflow shown, zh-TW at phone width. Screenshots in
// tests/out/internal-workflow/.                                           node tests/internal-workflow-visible-ui.mjs
import {spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {freePort,waitUp,withSession} from './boot.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),root=join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'crew-internal-workflow-ui-')),data=join(dir,'data'),home=join(dir,'home'),token='internal-workflow-fixture',port=await freePort(),base=`http://127.0.0.1:${port}`;mkdirSync(home);
const shots=join(root,'tests/out/internal-workflow');mkdirSync(shots,{recursive:true});
const env={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_PORT:String(port),CREW_SESSION_TOKEN:token,CREW_GH:'0',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_HOST_CODEX_BIN:'/nonexistent/codex',CREW_HOST_CLAUDE_BIN:'/nonexistent/claude',CREW_PR_WATCH_INTERVAL_MS:'600000',CREW_TEAM_SEED:'0'};delete env.CREW_MAIN_PROJECT;delete env.CREW_FM_STATE;
const app=spawn('bun',['src/server.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let output='',browser;app.stdout.on('data',b=>output+=b);app.stderr.on('data',b=>output+=b);let pass=0;const ok=(v,n,extra='')=>{if(!v)throw new Error(n+(extra?' '+extra:''));pass++;console.log('ok '+n);};
const api=async(path,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-crew-session':token,origin:base},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
const HIDDEN=['issue-triage','issue-categories','crew-change','firstmate-proposal','review-room-host','pr-watch-apply-depends'];
try{
 await waitUp(base,app);browser=withSession(await chromium.launch(),base,token);
 // ---- desktop, English: the list ----
 {const p=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(base+'/#/workflows');await p.evaluate(()=>setLang('en'));await p.locator('[data-wf-internal="pr-follow"]').waitFor();
  const card=p.locator('[data-wf-internal="pr-follow"]');
  ok(await p.locator('[data-wf-internal-list] [data-wf-internal]').count()===1,'one internal workflow is listed');
  ok(await card.locator('[data-workflow-rename],[data-workflow-trash]').count()===0,'its card has no Rename and no Trash');
  ok(/read-only/.test(await card.locator('[data-wf-internal-badge]').textContent()),'its card says built in, started by Studio, read-only');
  ok(await card.locator('[data-wf-internal-on]').getAttribute('data-wf-internal-on')==='false'&&/is off/.test(await card.locator('[data-wf-internal-on]').textContent()),'follow-through shows off by default');
  ok(await p.locator('[data-wf="pr-follow"],[data-wf-held="pr-follow"]').count()===0,'pr-follow is not among the startable workflows');
  for(const id of HIDDEN)ok(await p.locator(`[data-wf-name="${id}"]`).count()===0,`${id} is not shown`);
  await card.scrollIntoViewIfNeeded();await p.screenshot({path:join(shots,'workflows-list.png'),fullPage:true});
  // ---- its read-only page ----
  await card.locator('a.rt-wf-link').click();await p.locator('[data-wf-readonly="pr-follow"]').waitFor();
  ok(await p.locator('[data-save],[data-ed-run],[data-start-run],[data-workflow-rename],[data-tidy],.rt-palette').count()===0,'its page has no Save, Run, Start, Rename, Tidy or palette');
  ok(await p.locator('[data-wf-readonly] svg.rt-graph').count()===1,'its graph is drawn');
  for(const b of ['wait','needs-evidence','evidence-covers-head','missing-approvals','mergeable','ask'])ok(await p.locator(`[data-wf-branch="${b}"]`).count()===1,`branch ${b} is listed`);
  ok(/Ask QA to test/.test(await p.locator('[data-wf-branch="needs-evidence"]').textContent())&&/Ask reviewers to look again/.test(await p.locator('[data-wf-branch="evidence-covers-head"]').textContent())&&/Ask for approval/.test(await p.locator('[data-wf-branch="missing-approvals"]').textContent())&&/Ready to merge/.test(await p.locator('[data-wf-branch="mergeable"]').textContent()),'each branch names its card');
  ok(await p.locator('[data-wf-internal-settings="pr-follow"]').getAttribute('href')==='#/prs','it links to the Pull requests page for the switch');
  await p.screenshot({path:join(shots,'pr-follow-readonly.png'),fullPage:true});
  await p.locator('[data-wf-internal-branches]').scrollIntoViewIfNeeded();await p.screenshot({path:join(shots,'pr-follow-branches.png')});
  ok(errors.length===0,'no browser errors (en)',errors.join('\n'));await p.close();}
 // ---- follow-through on: the card says so ----
 {const view=(await api('/api/prs')).body,s={...view.settings,follow:{enabled:true}};const r=await api('/api/prs/settings',{settings:s,base:view.settings});ok(r.status===200,'follow-through turned on in the Pull requests settings',JSON.stringify(r.body).slice(0,300));
  const p=await browser.newPage({viewport:{width:1280,height:900}});await p.goto(base+'/#/workflows');await p.evaluate(()=>setLang('en'));await p.locator('[data-wf-internal="pr-follow"]').waitFor();
  ok(await p.locator('[data-wf-internal="pr-follow"] [data-wf-internal-on]').getAttribute('data-wf-internal-on')==='true','the card shows follow-through on');
  await p.locator('[data-wf-internal="pr-follow"]').scrollIntoViewIfNeeded();await p.screenshot({path:join(shots,'workflows-list-on.png'),fullPage:true});await p.close();}
 // ---- zh-TW at phone width ----
 {const p=await browser.newPage({viewport:{width:390,height:844}});const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(base+'/#/workflows/pr-follow');await p.evaluate(()=>setLang('zh-TW'));await p.locator('[data-wf-readonly="pr-follow"]').waitFor();
  ok(/唯讀/.test(await p.locator('[data-wf-internal-about]').textContent())&&/請 QA 測試/.test(await p.locator('[data-wf-branch="needs-evidence"]').textContent()),'zh-TW labels');
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the read-only page fits 390px');
  await p.screenshot({path:join(shots,'pr-follow-readonly-phone.png'),fullPage:true});ok(errors.length===0,'no browser errors (zh-TW)',errors.join('\n'));await p.close();}
}catch(e){console.error(output.slice(-3000));throw e;}finally{await browser?.close();if(app.exitCode===null){const stopped=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await stopped;}rmSync(dir,{recursive:true,force:true});}
console.log(`internal-workflow-visible-ui: ${pass} passed`);
