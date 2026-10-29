import "./lib/isolated-env.mjs";
// The rename flow in a real isolated Studio and Chromium (no live state, accounts or model calls): a fresh Studio lists
// code-firstmate as "coding"; Rename from the Workflows list and from the editor header; Reset to default; the Start form and
// a Task page show the display name; a name is text, never markup; zh-TW at phone width.       node tests/workflow-rename-ui.mjs
import {spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {freePort,waitUp,withSession} from './boot.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),root=join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'crew-workflow-rename-ui-')),data=join(dir,'data'),home=join(dir,'home'),token='workflow-rename-fixture',port=await freePort(),base=`http://127.0.0.1:${port}`;mkdirSync(home);
const env={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_PORT:String(port),CREW_SESSION_TOKEN:token,CREW_GH:'0',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_HOST_CODEX_BIN:'/nonexistent/codex',CREW_HOST_CLAUDE_BIN:'/nonexistent/claude'};delete env.CREW_MAIN_PROJECT;delete env.CREW_FM_STATE;
const app=spawn('bun',['src/server.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let output='',browser;app.stdout.on('data',b=>output+=b);app.stderr.on('data',b=>output+=b);let pass=0;const ok=(v,n,extra='')=>{if(!v)throw new Error(n+(extra?' '+extra:''));pass++;console.log('ok '+n);};
const api=async(path,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-crew-session':token,origin:base},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
const versions=id=>readdirSync(join(data,'workflows',id)).filter(f=>/^v\d+\.json$/.test(f)).sort().map(f=>readFileSync(join(data,'workflows',id,f),'utf8')).join('\n');
const text=(p,sel)=>p.locator(sel).first().textContent();
try{
 await waitUp(base,app);browser=withSession(await chromium.launch(),base,token);
 const bytes=versions('code-firstmate');
 // ---- desktop, English: the list, the dialog, the editor header, reset ----
 {const p=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(base+'/#/workflows');await p.evaluate(()=>setLang('en'));await p.locator('[data-wf-name="code-firstmate"]').waitFor();
  ok(await text(p,'[data-wf-name="code-firstmate"]')==='coding','fresh Studio lists code-firstmate as coding');
  ok(await p.locator('[data-workflow-rename="code-firstmate"]').evaluate(e=>!e.closest('a')&&e.textContent==='Rename'),'Rename is a button beside the card link, not inside it');
  await p.locator('[data-workflow-rename="code-firstmate"]').click();await p.locator('[data-workflow-rename-input]').waitFor();
  ok(await p.locator('[data-workflow-rename-input]').inputValue()==='coding','the dialog starts from the name shown');
  ok(await p.locator('[data-workflow-rename-reset]').count()===0,'a workflow on its default name offers no reset');
  await p.locator('[data-workflow-rename-cancel]').click();ok(await p.locator('[data-workflow-rename-dialog]').count()===0,'Cancel closes the dialog and changes nothing');
  ok((await api('/api/workflow-names')).body.names['code-firstmate']==='coding','Cancel left the name');
  await p.locator('[data-workflow-rename="code-firstmate"]').click();
  await p.locator('[data-workflow-rename-input]').fill('My coding crew');await p.locator('[data-workflow-rename-save]').click();
  await p.waitForFunction(()=>document.querySelector('[data-wf-name="code-firstmate"]')?.textContent==='My coding crew');
  ok(await p.locator('[data-workflow-rename-dialog]').count()===0,'Save closes the dialog and the list shows the new name');
  ok(versions('code-firstmate')===bytes,'a rename from the UI writes no definition version');
  // the editor header shows the rename and renames again; Enter submits
  await p.locator('[data-wf="code-firstmate"]').click();await p.locator('[data-ed-name="code-firstmate"]').waitFor();
  ok(await text(p,'[data-ed-name="code-firstmate"]')==='My coding crew','the editor header shows the display name');
  await p.locator('.phead [data-workflow-rename="code-firstmate"]').click();await p.locator('[data-workflow-rename-input]').fill('Ship it');await p.keyboard.press('Enter');
  await p.waitForFunction(()=>document.querySelector('[data-ed-name="code-firstmate"]')?.textContent==='Ship it');ok(true,'Rename from the editor header updates it in place (Enter submits)');
  await p.locator('.phead [data-workflow-rename="code-firstmate"]').click();await p.locator('[data-workflow-rename-reset]').click();
  await p.waitForFunction(()=>document.querySelector('[data-ed-name="code-firstmate"]')?.textContent==='coding');ok(true,'Reset to default brings back coding');
  ok(!(await api('/api/wf/code-firstmate')).body.renamed,'after Reset no rename is kept');
  // a bad name is refused inline and the dialog stays open
  await p.locator('.phead [data-workflow-rename="code-firstmate"]').click();await p.locator('[data-workflow-rename-input]').evaluate(e=>{e.removeAttribute('maxlength');e.value='y'.repeat(81);});await p.locator('[data-workflow-rename-save]').click();
  await p.waitForFunction(()=>/1–80/.test(document.querySelector('[data-workflow-rename-status]')?.textContent||''));ok(await p.locator('[data-workflow-rename-dialog]').isVisible(),'an 81-character name is refused inline');await p.locator('[data-workflow-rename-cancel]').click();
  // a name is text, never markup
  await api('/api/workflow-names',{workflow:'hello-crew-studio',name:'<img src=x onerror="window.__renamed=1">Hello'});
  await p.goto(base+'/#/workflows');await p.locator('[data-wf-name="hello-crew-studio"]').waitFor();
  ok(await text(p,'[data-wf-name="hello-crew-studio"]')==='<img src=x onerror="window.__renamed=1">Hello'&&await p.locator('[data-wf-name="hello-crew-studio"] img').count()===0&&!(await p.evaluate(()=>window.__renamed)),'a name with markup renders as text');
  // the Start form and a Task page show the display name
  await api('/api/workflow-names',{workflow:'hello-crew-studio',name:'Hello renamed'});
  await p.goto(base+'/#/runs');await p.locator('[data-run-wf] option[value="hello-crew-studio"]').waitFor({state:'attached'});
  ok(await text(p,'[data-run-wf] option[value="hello-crew-studio"]')==='Hello renamed'&&await text(p,'[data-run-wf] option[value="code-firstmate"]')==='coding','the Start form offers workflows by display name');
  const started=await api('/api/wruns',{workflow:'hello-crew-studio',text:'Say hello'});ok(started.status<300&&started.body.id,'a Task starts',JSON.stringify(started.body).slice(0,300));
  await p.goto(base+'/#/run/'+started.body.id);await p.locator(`[data-task-title="${started.body.id}"]`).waitFor();
  await p.waitForFunction(()=>document.querySelector('.phead')?.textContent.includes('Hello renamed v'));ok(true,'the Task page names its workflow by display name');
  ok(errors.length===0,'no browser errors',errors.join('\n'));await p.close();}
 // ---- phone width, zh-TW ----
 {const p=await browser.newPage({viewport:{width:390,height:900}});const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(base+'/#/workflows');await p.evaluate(()=>setLang('zh-TW'));await p.locator('[data-workflow-rename="code-firstmate"]').waitFor();
  ok(await text(p,'[data-workflow-rename="code-firstmate"]')==='改名','zh-TW labels the action 改名');
  await p.locator('[data-workflow-rename="code-firstmate"]').click();await p.locator('[data-workflow-rename-input]').fill('寫程式');await p.locator('[data-workflow-rename-save]').click();
  await p.waitForFunction(()=>document.querySelector('[data-wf-name="code-firstmate"]')?.textContent==='寫程式');ok(true,'a zh-TW rename shows in the list');
  await p.locator('[data-workflow-rename="code-firstmate"]').click();ok(await text(p,'[data-workflow-rename-reset]')==='恢復預設名稱','zh-TW reset label');await p.locator('[data-workflow-rename-reset]').click();
  await p.waitForFunction(()=>document.querySelector('[data-wf-name="code-firstmate"]')?.textContent==='coding');ok(true,'zh-TW reset brings back coding');
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the list with Rename fits 390px');ok(errors.length===0,'no browser errors (zh-TW)',errors.join('\n'));await p.close();}
 const unauth=await fetch(base+'/api/workflow-names',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({workflow:'code-firstmate',name:'x'})});ok(unauth.status>=400,'the session guard refuses an unauthenticated rename');
 ok((await api('/api/workflow-names')).body.names['code-firstmate']==='coding','the unauthenticated rename changed nothing');
}catch(e){console.error(output.slice(-3000));throw e;}finally{await browser?.close();if(app.exitCode===null){const stopped=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await stopped;}rmSync(dir,{recursive:true,force:true});}
console.log(`workflow-rename-ui: ${pass} passed`);
