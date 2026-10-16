// The board's Start form in a real Studio: the project picker for code-firstmate and each project's crew state,
// and the held GitHub review template in the catalog. No model account or vendor calls.
import{spawn,spawnSync}from'node:child_process';import{mkdtempSync,mkdirSync,rmSync,copyFileSync,readFileSync,existsSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';import{freePort,waitUp,withSession}from'./boot.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'..'),tmp=mkdtempSync(join(tmpdir(),'board-start-ui-')),data=join(tmp,'data'),home=join(tmp,'home'),repos=join(tmp,'repos'),shots=join(here,'out/board-start');
mkdirSync(home);mkdirSync(repos);mkdirSync(shots,{recursive:true});
// the signed-in Claude CLI stand-in (auth status only; the form never runs a paid verification)
const claudeBin=join(tmp,'cli','success.mjs');mkdirSync(dirname(claudeBin));copyFileSync(join(here,'fixture/claude-native.mjs'),claudeBin);
const fixture=spawnSync('bun',[join(here,'board-start.ts')],{cwd:root,env:{...process.env,BOARD_START_FIXTURE_DATA:data,BOARD_START_FIXTURE_REPOS:repos},encoding:'utf8'});if(fixture.status!==0)throw new Error(fixture.stdout+fixture.stderr);
const port=await freePort(),base=`http://127.0.0.1:${port}`,token='board-start-fixture-token';
const env={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_SESSION_TOKEN:token,CREW_PORT:String(port),CREW_GH:'0',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_HOST_CODEX_BIN:'/nonexistent/codex',CREW_HOST_CLAUDE_BIN:'/nonexistent/claude',CREW_CODEX_BIN:'/nonexistent/codex',CREW_CLAUDE_BIN:claudeBin};delete env.CREW_MAIN_PROJECT;delete env.CREW_FM_STATE;
const app=spawn('bun',['src/server.ts'],{cwd:process.env.BOARD_START_UI_BASELINE||root,env,stdio:['ignore','pipe','pipe']});let output='';app.stdout.on('data',b=>output+=b);app.stderr.on('data',b=>output+=b);
let browser,pass=0;const ok=(v,n)=>{if(!v)throw new Error(n);pass++;console.log('ok '+n);};
const api=async(path)=>{const r=await fetch(base+path,{headers:{'x-crew-session':token}});return{status:r.status,body:await r.json()};};
try{await waitUp(base,app);const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');browser=withSession(await chromium.launch({headless:true}),base,token);
 for(const width of[1440,390])for(const theme of['light','dark'])for(const lang of['en','zh-TW']){const tag=`${width} ${theme} ${lang}`,p=await browser.newPage({viewport:{width,height:1000},colorScheme:theme});
  await p.goto(base+'/#/runs');await p.evaluate(({theme,lang})=>{setTheme(theme);setLang(lang);},{theme,lang});await p.locator('[data-run-wf] option[value="code-firstmate"]').waitFor({state:'attached'});
  ok(await p.locator('[data-run-wf] option[value="github-review"]').count()===0,'the Start form does not offer the held github-review '+tag);
  await p.locator('[data-run-wf]').selectOption('code-firstmate');await p.locator('[data-run-project="code-firstmate"]').waitFor();
  const values=await p.locator('[data-run-project="code-firstmate"] option').evaluateAll(o=>o.map(x=>x.value));
  ok(['fixture','unstaffed','stale'].every(id=>values.includes(id)),'the picker lists every registered project '+tag);
  ok(await p.locator('[data-run-start]').isDisabled(),'Start waits for a project '+tag);
  await p.locator('[data-run-project="code-firstmate"]').selectOption('unstaffed');await p.locator('[data-run-crew="missing"]').waitFor();
  ok(await p.locator('[data-run-crew-link]').getAttribute('href')==='#/firstmate'&&(await p.locator('[data-run-crew-link]').textContent()).length>0&&await p.locator('[data-run-start]').isDisabled(),'a project without a crew links to choosing it and cannot start '+tag);
  await p.screenshot({path:join(shots,`missing-${width}-${theme}-${lang}.png`),fullPage:true});
  await p.locator('[data-run-project="code-firstmate"]').selectOption('stale');await p.locator('[data-run-crew="blocked"]').waitFor();
  ok(await p.locator('[data-run-crew="blocked"]').getAttribute('data-run-crew-code')==='staffing_changed'&&await p.locator('[data-run-start]').isDisabled(),'a crew approved for another definition says why it cannot start '+tag);
  await p.screenshot({path:join(shots,`blocked-${width}-${theme}-${lang}.png`),fullPage:true});
  await p.locator('[data-run-project="code-firstmate"]').selectOption('fixture');await p.locator('[data-run-crew="approved"]').waitFor();
  ok(!await p.locator('[data-run-start]').isDisabled(),'an approved crew lets the captain start '+tag);
  ok(await p.locator('[data-run-crew-check]').count()===1&&await p.locator('[data-run-crew="approved"]').getAttribute('data-run-crew-ready')==='check-on-start','a signed-in Claude crew says it is checked on Start '+tag);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal page scroll '+tag);
  await p.screenshot({path:join(shots,`approved-${width}-${theme}-${lang}.png`),fullPage:true});
  if(width===1440&&theme==='light'&&lang==='en'){
   // this Studio has no Codex CLI: the guard refuses at Start with its typed reason, and no Task is made
   const before=(await api('/api/wruns')).body.runs.length;await p.locator('[data-run-text]').fill('Add one README line');
   const [response]=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/api/wruns')&&r.request().method()==='POST'),p.locator('[data-run-start]').click()]);const body=await response.json();
   ok(body.code&&body.code!=='staffing_missing'&&!/Staffing approval missing or changed/.test(body.error??'')&&(response.status()===200||response.status()===409),'the board sends the chosen project and passes the staffing binding '+JSON.stringify(body).slice(0,300));
   if(response.status()===409){await p.locator('.rt-start [role=status]').filter({hasText:/\S/}).waitFor();ok((await api('/api/wruns')).body.runs.length===before,'a refused start shows its reason and makes no Task');}
  }
  await p.goto(base+'/#/workflows');await p.locator('[data-wf-held="github-review"]').waitFor();
  ok((await p.locator('[data-wf-held-reason="github-review"]').textContent()).length>0&&await p.locator('[data-wf="github-review"]').count()===0,'the catalog shows github-review as held with its reason '+tag);
  await p.goto(base+'/#/workflows/github-review');await p.locator('[data-workflow-held]').waitFor();ok(await p.locator('[data-ed-run]').count()===0,'the held editor offers no Run '+tag);
  await p.close();}
 const trace=join(dirname(claudeBin),'trace.jsonl');ok(existsSync(trace)&&readFileSync(trace,'utf8').trim().split('\n').every(l=>JSON.parse(l).phase==='auth'),'the Start form only ever ran the free Claude auth status, never a model request');
 console.log(`board-start-ui: ${pass} passed, 0 failed`);
}catch(e){console.log(output.slice(-4000));throw e;}finally{await browser?.close();if(app.exitCode===null&&app.signalCode===null){const end=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await end;}rmSync(tmp,{recursive:true,force:true});}
