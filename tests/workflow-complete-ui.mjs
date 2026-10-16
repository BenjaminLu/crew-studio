import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Actual native Studio, isolated fake-provider data. No live records or remote calls.
import{spawn}from'node:child_process';import{mkdtempSync,mkdirSync,readFileSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';
import{freePort,waitUp,withSession}from'./boot.mjs';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.env.FIRST_WORKFLOW_BASE||join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'crew-first-workflow-')),data=join(dir,'data'),state=join(dir,'state'),shots=join(root,'tests/out/first-workflow');mkdirSync(data);mkdirSync(join(state,'pending'),{recursive:true});mkdirSync(shots,{recursive:true});
const port=await freePort(),base=`http://127.0.0.1:${port}`,env={...process.env};for(const key of Object.keys(env))if(/TOKEN|API_KEY/.test(key))delete env[key];
const serverEnv=d=>({...env,CREW_PORT:String(port),CREW_DATA:d,CREW_FM_STATE:state,CREW_SESSION_TOKEN:'sidebar-fixture',CREW_GH:'0',CREW_GH_NO_CLI:'1',CREW_READONLY:'1',CREW_CHAT_PROVIDER:'stub',CREW_RETRO_AUTO:'0',CREW_INSTALL_RUNNER:'mock',CREW_NO_REAL_INSTALL:'1',CREW_CLAUDE_BIN:'/nonexistent/claude',CREW_CODEX_BIN:'/nonexistent/codex',HOME:join(dir,'home'),CREW_MAIN_PROJECT:join(dir,'project')});let app=spawn('bun',['src/server.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],env:serverEnv(data)});
let appLog='';app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);let browser,pass=0,fail=0;
const ok=(value,name,detail='')=>{if(value){pass++;console.log('  ok    '+name);}else{fail++;console.log('  FAIL  '+name+' '+detail);}};
try{
 await waitUp(base,app);browser=withSession(await chromium.launch(),base,'sidebar-fixture');const ctx=await browser.newContext({viewport:{width:1280,height:1000}}),p=await ctx.newPage();let starts=0;p.on('request',r=>{if(r.method()==='POST'&&/api\/(wruns|main\/send)/.test(r.url()))starts++;});
 await p.goto(base+'/#/first-workflow');await p.locator('[data-hello-interview]').waitFor();await p.evaluate(()=>{openChat(true);document.querySelector('#chatIn').value='Keep my unrelated note';openChat(false);});await p.locator('[data-hello-interview]').click();await p.waitForFunction(()=>document.querySelector('#chatIn').value.includes('Hello Crew Studio'));
 ok((await p.locator('#chatIn').inputValue()).includes('Hello Crew Studio'),'Hello begins with actual Firstmate discussion draft');
 ok((await p.locator('#chatIn').inputValue()).includes('Keep my unrelated note'),'Hello preserves existing unsent chat text');
 ok(starts===0,'opening discussion does not execute a workflow or send a model turn');await p.evaluate(()=>openChat(false));
 ok(await p.locator('[data-roadmap]').count()===0,'advanced journey has no unfinished roadmap steps');
 await p.evaluate(async()=>{await fetch('/api/wf',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'editable-guide',name:'My flow',origin:'starter'})});});
 await p.goto(base+'/#/workflows/editable-guide');await p.locator('[data-edit-step="start"]').waitFor();await p.locator('[data-edit-step="start"]').click();await p.locator('[data-field="label"]').fill('Discuss and approve');await p.locator('[data-field="label"]').dispatchEvent('change');
 await p.locator('[data-workflow-compare] > summary').click();await p.locator('[data-workflow-compare-refresh]').click();await p.waitForFunction(()=>document.querySelector('[data-workflow-changes]').textContent.includes('Discuss and approve'));
 ok((await p.locator('[data-workflow-changes]').innerText()).includes('Start'),'compare shows original and changed values');
 await p.locator('[data-edit-connection="0"]').click();await p.locator('[data-field="when"]').fill('continue|retry');await p.locator('[data-field="when"]').dispatchEvent('change');
 await p.locator('[data-save="1"]').click();await p.waitForFunction(async()=>{const j=await fetch('/api/wf/editable-guide').then(r=>r.json());return j.def.version===2;});await p.locator('[data-workflow-reuse] > summary').click();await p.locator('[data-save-workflow-template]').click();await p.locator('[data-template-name]').fill('Reusable approval');await p.locator('[data-template-confirm]').click();await p.waitForURL(/#\/workflows\/template-/);await p.locator('[data-workflow-reuse] > summary').click();await p.locator('[data-use-workflow-template]').click();await p.locator('[data-template-name]').fill('Second workflow');await p.locator('[data-template-confirm]').click();await p.waitForURL(/#\/workflows\/workflow-/);
 const copy=await p.evaluate(async()=>fetch('/api/wf/'+location.hash.split('/').at(-1)).then(r=>r.json()));
 ok(copy.def.nodes[0].label==='Discuss and approve'&&copy.def.edges[0].when==='continue|retry','template and new workflow preserve actual saved edits');
 ok(copy.def.isTemplate===false&&copy.runs.length===0&&starts===0,'full edit compare template reuse journey allocates no task or model work');
 // Server response fixture: the same edge check with different params must remain distinguishable.
 const flowId=copy.def.id;await p.route('**/api/wf/'+flowId+'*',async route=>{const res=await route.fetch(),j=await res.json();if(j.def?.edges?.length)j.def.edges[0].checks=[{use:'same-check@1',params:{threshold:new URL(route.request().url()).searchParams.has('v')?11:29}}];await route.fulfill({response:res,json:j});});
 await p.reload();await p.locator('[data-workflow-compare] > summary').click();await p.locator('[data-workflow-compare-refresh]').click();await p.waitForFunction(()=>document.querySelector('[data-workflow-changes]').textContent.includes('threshold'));
 const comparison=await p.locator('[data-workflow-changes]').innerText();ok(comparison.includes('11')&&comparison.includes('29'),'comparison exposes both edge-check parameter values');
 await p.setViewportSize({width:390,height:900});await p.screenshot({path:join(shots,'completed-workflow-mobile.png'),fullPage:true});ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'completed workflow editor fits mobile');await ctx.close();
}finally{await browser?.close();app.kill('SIGTERM');}
console.log(`workflow-complete-ui: ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
