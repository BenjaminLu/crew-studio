import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Actual native Studio, isolated fake-provider data. No live records or remote calls.
import{spawn}from'node:child_process';import{mkdtempSync,mkdirSync,rmSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';
import{freePort,waitUp,withSession}from'./boot.mjs';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.env.BOARD_FOLDER_UI_BASE||join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'crew-board-folder-')),data=join(dir,'data'),state=join(dir,'state'),shots=join(root,'tests/out/board-folder');mkdirSync(data);mkdirSync(join(state,'pending'),{recursive:true});mkdirSync(shots,{recursive:true});
const port=await freePort(),base=`http://127.0.0.1:${port}`,env={...process.env};for(const key of Object.keys(env))if(/TOKEN|API_KEY/.test(key))delete env[key];
const serverEnv=d=>({...env,CREW_PORT:String(port),CREW_DATA:d,CREW_FM_STATE:state,CREW_SESSION_TOKEN:'sidebar-fixture',CREW_GH:'0',CREW_GH_NO_CLI:'1',CREW_READONLY:'1',CREW_CHAT_PROVIDER:'stub',CREW_RETRO_AUTO:'0',CREW_INSTALL_RUNNER:'mock',CREW_NO_REAL_INSTALL:'1',CREW_CLAUDE_BIN:'/nonexistent/claude',CREW_CODEX_BIN:'/nonexistent/codex',HOME:join(dir,'home'),CREW_MAIN_PROJECT:join(dir,'project')});let app=spawn('bun',['src/server.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],env:serverEnv(data)});
let appLog='';app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);let browser;

import assert from 'node:assert/strict';
const cleanup=[dir];
try{
 await waitUp(base,app);browser=withSession(await chromium.launch(),base,'sidebar-fixture');const ctx=await browser.newContext({viewport:{width:1280,height:900}});const p=await ctx.newPage();
 await p.goto(base+'/#/runs');await p.locator('[data-run-wf] option[value="file-organization"]').waitFor({state:'attached'});await p.selectOption('[data-run-wf]','file-organization');await p.locator('[data-run-param="folder"][required]').waitFor();
 const count=()=>p.evaluate(async()=>((await(await fetch('/api/wruns')).json()).runs).length);const before=await count();let posts=0;p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/wruns'))posts++;});
 await p.click('[data-run-start]');assert.match(await p.locator('.rt-start [role="status"]').innerText(),/folder/);assert.equal(posts,0);assert.equal(await count(),before);console.log('PASS declared required folder renders and empty Start creates no request or Task');
 for(const params of [{},{folder:'   '},{folder:'relative/path'},{folder:42}]){const result=await p.evaluate(async params=>{const r=await fetch('/api/wruns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workflow:'file-organization',params})});return{status:r.status,body:await r.json()};},params);assert.equal(result.status,400,JSON.stringify(result));assert.match(result.body.error,/folder/);assert(result.body.failure);}
 assert.equal(await count(),before);console.log('PASS direct API refuses missing whitespace relative and nonstring folder before Task allocation');
 const folder=mkdtempSync(join(tmpdir(),'crew-tidy-input-'));cleanup.push(folder);for(const f of ['report.pdf','photo.jpg','notes.txt','song.mp3'])writeFileSync(join(folder,f),'fixture '+f+'\n');
 await p.fill('[data-run-param="folder"]',folder);await p.selectOption('[data-run-wf]','hello-crew-studio');await p.locator('[data-run-param="heading"]').waitFor();await p.selectOption('[data-run-wf]','file-organization');assert.equal(await p.inputValue('[data-run-param="folder"]'),folder);
 await p.fill('[data-run-text]','Sort my sample downloads');await p.click('[data-run-start]');await p.waitForURL(/#\/run\/R-\d+/);const id=p.url().split('/').at(-1);let run;
 for(let i=0;i<100;i++){run=await p.evaluate(async id=>(await(await fetch('/api/wruns/'+id)).json()),id);if(run.status==='waiting'&&run.cards.some(c=>c.status==='open'))break;await p.waitForTimeout(100);}
 assert.equal(run.params.folder,folder);assert.equal(run.status,'waiting',JSON.stringify({error:run.error,nodes:run.nodes,log:appLog}));const card=run.cards.find(c=>c.status==='open');assert.equal(card.node,'card');assert(run.nodes.plan.state==='passed');
 const approved=await p.evaluate(async id=>{const r=await fetch('/api/scards/'+id+'/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({choice:'apply',note:'Fixture captain reviewed the sample moves and confirms the folder is tidied.'})});return {status:r.status,body:await r.json()};},card.id);assert.equal(approved.status,200,JSON.stringify(approved));
 await p.waitForFunction(async id=>(await(await fetch('/api/wruns/'+id)).json()).status==='succeeded',id);assert.equal(await count(),before+1);console.log('PASS changing workflow preserves its folder input; real Board Task plans, gates, awaits approval and applies successfully');
 await p.screenshot({path:join(shots,'board-folder-done.png')});await ctx.close();
}finally{await browser?.close();await new Promise(resolve=>{app.once('exit',resolve);app.kill('SIGTERM');});for(const path of cleanup)rmSync(path,{recursive:true,force:true});}
console.log('board-folder-ui: 3 passed, 0 failed');
