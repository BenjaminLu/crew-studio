import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { revealEditorControl } from "./lib/reveal-editor-control.mjs";
// Actual native Studio, isolated fake-provider data. No live records or remote calls.
import{spawn}from'node:child_process';import{mkdtempSync,mkdirSync,readFileSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';
import{freePort,waitUp,withSession}from'./boot.mjs';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'crew-sidebar-workflow-')),data=join(dir,'data'),state=join(dir,'state'),shots=join(root,'tests/out/sidebar-workflow-create');mkdirSync(data);mkdirSync(join(state,'pending'),{recursive:true});mkdirSync(shots,{recursive:true});
const port=await freePort(),base=`http://127.0.0.1:${port}`,env={...process.env};for(const key of Object.keys(env))if(/TOKEN|API_KEY/.test(key))delete env[key];
const app=spawn('bun',['src/server.ts'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...env,CREW_PORT:String(port),CREW_DATA:data,CREW_FM_STATE:state,CREW_SESSION_TOKEN:'sidebar-fixture',CREW_GH:'0',CREW_GH_NO_CLI:'1',CREW_READONLY:'1',CREW_CHAT_PROVIDER:'stub',CREW_RETRO_AUTO:'0',CREW_INSTALL_RUNNER:'mock',CREW_NO_REAL_INSTALL:'1',CREW_CLAUDE_BIN:'/nonexistent/claude',CREW_CODEX_BIN:'/nonexistent/codex',HOME:join(dir,'home'),CREW_MAIN_PROJECT:join(dir,'project')}});
let appLog='';app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);let browser,pass=0,fail=0;
const ok=(value,name,detail='')=>{if(value){pass++;console.log('  ok    '+name);}else{fail++;console.log('  FAIL  '+name+' '+detail);}};
try{await waitUp(base,app);browser=withSession(await chromium.launch(),base,'sidebar-fixture');const errors=[],rectangles=[];
for(const width of[320,390,1440])for(const lang of['en','zh-TW'])for(const theme of['light','dark'])for(const side of['open','collapsed']){
 const tag=`${width}-${lang}-${theme}-${side}`,ctx=await browser.newContext({viewport:{width,height:900},colorScheme:theme});
 await ctx.addInitScript(({lang,theme,side})=>{localStorage.setItem('crew.lang',lang);localStorage.setItem('crew.theme',theme);localStorage.setItem('crew.side',side);},{lang,theme,side});await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(tag+': '+e));await p.goto(base+'/#/workflows');await p.waitForSelector('[data-wf]');await p.evaluate(()=>Promise.all(document.querySelector('.shell').getAnimations().map(a=>a.finished.catch(()=>{}))));
 const geometry=await p.evaluate(()=>{const parent=document.querySelector('.side').getBoundingClientRect();return{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,sideWidth:parent.width,buttons:[...document.querySelectorAll('.side-foot button')].map(b=>{const r=b.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width,height:r.height,name:b.getAttribute('aria-label')||b.innerText,hasContent:[...b.children].some(c=>{const r=c.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(c).display!=='none';}),inside:r.x>=parent.x-.5&&r.right<=parent.right+.5&&r.y>=parent.y-.5&&r.bottom<=parent.bottom+.5};})};});rectangles.push({tag,...geometry});
 ok(geometry.scrollWidth<=width&&geometry.buttons.length===4&&geometry.buttons.every(b=>b.inside&&b.width>=28&&b.height>=28&&b.name&&b.hasContent),`footer buttons stay visible, named and inside sidebar ${tag}`,JSON.stringify(geometry));
 if(width===1440&&side==='collapsed')ok(geometry.sideWidth<=64.5,`collapsed sidebar retains its 64px column ${tag}`,String(geometry.sideWidth));
 ok(await p.locator('#themeSeg button span').evaluateAll(spans=>spans.every(span=>span.getBoundingClientRect().height<=22)),`theme labels remain on one readable line ${tag}`);
 ok(await p.locator('[data-wf-new]').isVisible(),`New workflow is discoverable ${tag}`);
 await p.locator('#themeSeg [data-theme-set="dark"]').click();ok(await p.locator('html').getAttribute('data-theme')==='dark',`theme action works ${tag}`);await p.locator(`#themeSeg [data-theme-set="${theme}"]`).click();
 await p.locator('#navSettings').click();await p.waitForURL('**/#/settings');ok(await p.locator('h1').isVisible(),`settings action remains reachable ${tag}`);await p.goto(base+'/#/workflows');await p.waitForSelector('[data-wf-new]');
 await p.screenshot({path:join(shots,tag+'-list.png'),fullPage:true});
 await p.locator('[data-wf-new]').click();await p.locator('[data-wf-create-name]').fill('Captain workflow');
 await p.screenshot({path:join(shots,tag+'-create.png'),fullPage:true});
 const dialog=await p.locator('[role=dialog]').evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,right:r.right,scrollWidth:el.scrollWidth,width:el.clientWidth};});ok(dialog.x>=-.5&&dialog.right<=width+.5&&dialog.scrollWidth<=dialog.width,`creation dialog fits viewport ${tag}`,JSON.stringify(dialog));
 if(side==='open'&&theme==='light'){
  const id=`captain-${width}-${lang.toLowerCase()}`;await p.locator('[data-wf-create-id]').fill(id);const before=(await ctx.request.get(base+'/api/wruns').then(r=>r.json())).runs.length;
  await p.locator('[data-wf-create-submit]').click();await p.waitForURL('**/#/workflows/'+id);await p.waitForSelector('[data-node="start"]');
  const created=await ctx.request.get(base+'/api/wf/'+id).then(r=>r.json());ok(created.def.version===1&&created.def.nodes.length===2,`actual create opens saved starter graph ${tag}`);
  ok((await ctx.request.get(base+'/api/wruns').then(r=>r.json())).runs.length===before,`create never auto-starts Task ${tag}`);
  await revealEditorControl(p, '[data-view-toggle="detail"]'); await p.locator('[data-view-toggle="detail"]').click();await p.locator('[data-node="start"]').focus();await p.keyboard.press('Enter');await p.locator('[data-field="label"]').fill('Captain review');await p.locator('[data-field="label"]').press('Tab');await p.locator('[data-save]').click();
  await p.waitForFunction(async id=>(await fetch('/api/wf/'+id).then(r=>r.json())).def.version===2,id);
  const old=await ctx.request.get(base+'/api/wf/'+id+'?v=1').then(r=>r.json());ok(old.def.nodes[0].label===(lang==='en'?'Start':'開始'),`actual editor save creates v2 and preserves v1 ${tag}`);
  await p.screenshot({path:join(shots,tag+'-editor.png'),fullPage:true});
 }else{
  const before=(await ctx.request.get(base+'/api/wf').then(r=>r.json())).workflows.length;
  await p.getByRole('button',{name:lang==='en'?'Cancel':'取消',exact:true}).click();ok((await ctx.request.get(base+'/api/wf').then(r=>r.json())).workflows.length===before,`cancel creates no workflow ${tag}`);
 }
 await ctx.close();
}
 const pendingContext=await browser.newContext({viewport:{width:390,height:900}}),pendingPage=await pendingContext.newPage();
 await pendingPage.goto(base+'/#/workflows');await pendingPage.waitForSelector('[data-wf-new]');await pendingPage.locator('[data-wf-new]').click();await pendingPage.locator('[data-wf-create-name]').fill('One pending creation');await pendingPage.locator('[data-wf-create-id]').fill('pending-once');
 let posts=0,release;const gate=new Promise(resolve=>{release=resolve;});let arrived;const arrival=new Promise(resolve=>{arrived=resolve;});
 await pendingPage.route('**/api/wf',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;arrived();await gate;await route.continue();});
 await pendingPage.locator('[data-wf-create-submit]').click();await arrival;await pendingPage.locator('[data-wf-create-submit]').evaluate(b=>{b.click();b.click();});await pendingPage.keyboard.press('Escape');
 ok(posts===1&&await pendingPage.locator('[role=dialog]').isVisible()&&await pendingPage.locator('[data-wf-create-submit]').isDisabled(),'pending create has one owned request and retains its visible confirmation state');
 release();await pendingPage.waitForURL('**/#/workflows/pending-once');const once=await pendingContext.request.get(base+'/api/wf/pending-once').then(r=>r.json());ok(once.versions.length===1,'pending duplicate clicks produce exactly one saved v1');await pendingContext.close();
 const unauth=await fetch(base+'/api/wf',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'unauthorized',name:'Unauthorized'})});ok(unauth.status>=400,'unauthenticated actual HTTP workflow creation is refused');
 ok(errors.length===0,'all matrix interactions have no browser errors',errors.join('\n'));
 writeFileSync(join(shots,'geometry.json'),JSON.stringify(rectangles,null,2));
}catch(error){fail++;console.log('  FAIL  fixture '+error.stack+'\n'+appLog.slice(-3000));}
finally{await browser?.close();app.kill('SIGTERM');await new Promise(resolve=>app.exitCode!==null?resolve():app.once('exit',resolve));}
console.log(`\nsidebar-workflow-create-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
