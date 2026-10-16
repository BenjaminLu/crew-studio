import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Claude account card in a real browser: Welcome + Doctor, offline CLI stub only.
import{spawn}from'node:child_process';import{mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';import{freePort,waitUp,withSession}from'./boot.mjs';
const here=dirname(fileURLToPath(import.meta.url)),tmp=mkdtempSync(join(tmpdir(),'crew-claude-login-ui-')),home=join(tmp,'home'),data=join(tmp,'data'),repo=join(tmp,'repo');for(const d of[home,data,repo])mkdirSync(d,{recursive:true});writeFileSync(join(home,'.claude-login-mode'),'hang');
const port=await freePort(),base=`http://127.0.0.1:${port}`,token='claude-login-ui-token',shots=process.env.CLAUDE_LOGIN_SHOTS;
const env={...process.env,USER:process.env.USER||'fixture-user',LOGNAME:process.env.LOGNAME||'fixture-user',HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_MAIN_PROJECT:repo,CREW_SESSION_TOKEN:token,CREW_PORT:String(port),CREW_GH:'0',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_CLAUDE_BIN:join(here,'fixture/claude-login.mjs'),CREW_HOST_CLAUDE_BIN:'/nonexistent/claude',CREW_HOST_CODEX_BIN:'/nonexistent/codex'};
for(const k of['CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_API_KEY','CLAUDE_CONFIG_DIR','CREW_FM_STATE'])delete env[k];
const app=spawn('bun',['src/server.ts'],{cwd:join(here,'..'),env,stdio:['ignore','pipe','pipe']});app.stdout.resume();app.stderr.resume();
let browser,pass=0,fail=0;const errors=[];const ok=(v,n)=>{if(v){console.log('ok '+n);pass++;}else{console.log('FAIL '+n);fail++;}};
const api=async(path,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-crew-session':token},body:body===undefined?undefined:JSON.stringify(body)});return r.json();};
try{
 await waitUp(base,app);const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');browser=withSession(await chromium.launch({headless:true,...process.env.CLAUDE_LOGIN_CHANNEL?{channel:process.env.CLAUDE_LOGIN_CHANNEL}:{}}),base,token);
 const p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',e=>errors.push(String(e)));
 // live events are cut for this page: only a reconnect (crew:live) can bring later sign-in state
 await p.route('**/api/stream',r=>r.abort());await p.goto(base+'/#/board');const card=p.locator('[data-firstmate-welcome] [data-claude-account]');await card.waitFor();await p.locator('[data-firstmate-welcome] [data-claude-account="signed-out"]').waitFor();
 const text=await card.innerText();ok(!/paid|Doctor/i.test(text),'Welcome Claude card names no verification place that does not exist');
 // live refresh: with the event stream cut, a reconnect (crew:live) re-reads the sign-in state
 await api('/api/claude/account/login',{});await p.evaluate(()=>window.dispatchEvent(new Event('crew:live')));let pend=true;try{await p.locator('[data-firstmate-welcome] [data-claude-login="pending"]').waitFor({timeout:5000});}catch{pend=false;}ok(pend,'a reconnect shows a sign-in started elsewhere as pending');
 await api('/api/claude/account/cancel',{});await p.evaluate(()=>window.dispatchEvent(new Event('crew:live')));
 let refreshed=true;try{await p.locator('[data-firstmate-welcome] [data-claude-login="cancelled"]').waitFor({timeout:5000});}catch{refreshed=false;}ok(refreshed,'a reconnect re-reads Claude sign-in state so pending does not stick');
 await p.unroute('**/api/stream');
 await p.goto(base+'/#/doctor');await p.locator('[data-page="doctor"] [data-claude-account]').waitFor();
 ok(await p.locator('[data-page="doctor"] [data-claude-account]').count()===1&&await p.locator('[data-page="doctor"] [data-claude-native-status]').count()===0,'Doctor shows one Claude account card');
 if(shots){ // fresh pages, live events on, guide hidden; the card shows a sign-in waiting for the browser
  await api('/api/claude/account/login',{});
  const shot=async(o,name)=>{const ctx=await browser.newContext({viewport:{width:o.width,height:o.width<500?844:900},colorScheme:o.dark?'dark':'light',deviceScaleFactor:2});await ctx.addInitScript(([lang,theme])=>{try{localStorage.setItem('crew.lang',lang);localStorage.setItem('crew.theme',theme);}catch{}},[o.lang,o.dark?'dark':'light']);const m=await ctx.newPage();
   for(const route of['board','doctor']){await m.goto(base+'/#/'+route);const sel=route==='board'?'[data-firstmate-welcome] [data-claude-account]':'[data-page="doctor"] [data-claude-account]';await m.locator(sel+'[data-claude-login="pending"]').waitFor();
    const hide=m.getByText(o.lang==='en'?'Hide guide':'收起導覽',{exact:true});if(await hide.isVisible().catch(()=>false))await hide.click();
    await m.locator(sel).evaluate(el=>el.scrollIntoView({block:'center'}));await m.waitForTimeout(300);await m.screenshot({path:join(shots,`${route==='board'?'welcome':'doctor'}-${name}.png`)});}
   await ctx.close();};
  await shot({width:1280,dark:false,lang:'en'},'1280-light-en');await shot({width:390,dark:true,lang:'zh-TW'},'390-dark-zh');
  await api('/api/claude/account/cancel',{});}
 ok(!errors.length,'no page errors: '+errors.join(' | '));
}finally{await browser?.close();if(app.exitCode===null&&app.signalCode===null){const done=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await done;}rmSync(tmp,{recursive:true,force:true});}
console.log(`claude-login-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
