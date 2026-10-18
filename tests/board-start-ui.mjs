import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The board's Start form in a real Studio: the project picker for code-firstmate and each project's crew state,
// and the held GitHub review template in the catalog. No model account or vendor calls.
import{spawn,spawnSync}from'node:child_process';import{mkdtempSync,mkdirSync,rmSync,copyFileSync,readFileSync,existsSync,writeFileSync,lstatSync,chmodSync,readdirSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';import{freePort,waitUp,withSession}from'./boot.mjs';import{checkedTempDir}from'./lib/git-hygiene.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'..'),tmp=checkedTempDir('board-start-ui-'),data=join(tmp,'data'),home=join(tmp,'home'),repos=join(tmp,'repos'),shots=join(here,'out/board-start');
mkdirSync(home);mkdirSync(repos);mkdirSync(shots,{recursive:true});
// a Codex login the stub CLI (tests/fixture/codex-account.mjs) hands to the scripted agent, and
// the signed-in Claude CLI stand-in (auth status only; the form never runs a paid verification)
mkdirSync(join(home,'.codex'));writeFileSync(join(home,'.codex','auth.json'),JSON.stringify({auth_mode:'chatgpt',last_refresh:'2020-02-29T12:34:56.123+08:00',tokens:{access_token:'abcdefgh.abcdefgh.abcdefgh',id_token:'fixture-id-token',account_id:'fixture-acceptance',refresh_token:'acceptance-refresh-must-not-copy'}}),{mode:0o600});
const claudeBin=join(tmp,'cli','success.mjs');mkdirSync(dirname(claudeBin));copyFileSync(join(here,'fixture/claude-native.mjs'),claudeBin);
const fixture=spawnSync('bun',[join(here,'board-start.ts')],{cwd:root,env:{...process.env,BOARD_START_FIXTURE_DATA:data,BOARD_START_FIXTURE_REPOS:repos},encoding:'utf8'});if(fixture.status!==0)throw new Error(fixture.stdout+fixture.stderr);
const port=await freePort(),base=`http://127.0.0.1:${port}`,token='board-start-fixture-token';
// the per-project crew states (missing, changed, unverified) need per-project staffing: no team seeded from the fixture's approvals
const env={...process.env,CREW_TEAM_SEED:'0',HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_SESSION_TOKEN:token,CREW_PORT:String(port),CREW_GH:'0',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_HOST_CODEX_BIN:'/nonexistent/codex',CREW_HOST_CLAUDE_BIN:'/nonexistent/claude',CREW_CODEX_BIN:join(root,'tests/fixture/codex-account.mjs'),CREW_CLAUDE_BIN:claudeBin};delete env.CREW_MAIN_PROJECT;delete env.CREW_FM_STATE;
const app=spawn('bun',['src/server.ts'],{cwd:process.env.BOARD_START_UI_BASELINE||root,env,stdio:['ignore','pipe','pipe']});let output='';app.stdout.on('data',b=>output+=b);app.stderr.on('data',b=>output+=b);
// a started Task's worktree is frozen read-only between rounds: make it writable again before removing the temp folder
const thaw=p=>{try{const st=lstatSync(p);if(st.isSymbolicLink())return;if(st.isDirectory()){chmodSync(p,st.mode|0o700);for(const e of readdirSync(p))thaw(join(p,e));}else chmodSync(p,st.mode|0o600);}catch{}};
let browser,pass=0;const ok=(v,n)=>{if(!v)throw new Error(n);pass++;console.log('ok '+n);};
const api=async(path)=>{const r=await fetch(base+path,{headers:{'x-crew-session':token}});return{status:r.status,body:await r.json()};};
try{await waitUp(base,app);const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');browser=withSession(await chromium.launch({headless:true}),base,token);
 for(const width of[1440,390])for(const theme of['light','dark'])for(const lang of['en','zh-TW']){const tag=`${width} ${theme} ${lang}`,p=await browser.newPage({viewport:{width,height:1000},colorScheme:theme});
  await p.goto(base+'/#/runs');await p.evaluate(({theme,lang})=>{setTheme(theme);setLang(lang);},{theme,lang});await p.locator('[data-run-wf] option[value="code-firstmate"]').waitFor({state:'attached'});
  ok(await p.locator('[data-run-wf] option[value="github-review"]').count()===0,'the Start form does not offer the held github-review '+tag);
  if(width===1440&&theme==='light'&&lang==='en'){
   let starts=0;const listener=r=>{if(r.method()==='POST'&&r.url().endsWith('/api/wruns'))starts++;};p.on('request',listener);
   // the page redraws (a live event) while intake is still answering: the picker it then focuses is the one on the page
   let answerIntake;const intakeHeld=new Promise(r=>answerIntake=r),intakeAsked=p.waitForRequest(r=>new URL(r.url()).pathname==='/api/intake');intakeAsked.catch(()=>{});
   await p.route('**/api/intake',async route=>{await intakeHeld;await route.continue();});
   // a redraw while the captain types (a live event) keeps the request field focused with its caret: the next keys land in it
   await p.locator('[data-run-text]').fill('zzzxqv ambiguous');await p.evaluate(()=>render());
   ok(await p.evaluate(()=>document.activeElement?.matches('[data-run-text]')&&document.activeElement.selectionStart===document.activeElement.value.length),'a redraw keeps the request field focused, caret at the end');
   await p.keyboard.type(' request');ok(await p.locator('[data-run-text]').inputValue()==='zzzxqv ambiguous request','keys typed after a redraw land in the request field');
   await p.locator('[data-run-start]').click();
   await intakeAsked;await p.evaluate(()=>render());answerIntake();
   await p.waitForFunction(()=>document.activeElement?.matches('[data-run-wf]'),null,{timeout:10000});await p.unroute('**/api/intake');
   ok(/Choose a workflow/.test(await p.locator('.rt-start [role=status]').textContent()),'unknown intent says to choose a workflow on the page as it is now');
   ok(starts===0&&await p.locator('[data-run-text]').inputValue()==='zzzxqv ambiguous request','unknown intent focuses workflow picker, retains prompt and allocates no Task');
   await p.locator('[data-run-text]').fill('coffee-kit');await p.locator('[data-run-start]').click();await p.waitForFunction(()=>document.querySelector('[data-run-wf]')?.value==='coffee-kit');
   ok(starts===0&&await p.locator('[data-run-text]').inputValue()==='coffee-kit','recognized workflow shows declared inputs before allocating a Task');p.off('request',listener);
  }
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
  await p.locator('[data-run-project="code-firstmate"]').selectOption('fixture');await p.locator('[data-run-crew="blocked"][data-run-crew-code="staffing_not_ready"]').waitFor();
  ok(/Claude/.test(await p.locator('[data-run-crew="blocked"]').textContent())&&await p.locator('[data-run-start]').isDisabled(),'a signed-in but unverified Claude crew shows why it cannot start and Start stays disabled '+tag);
  await p.screenshot({path:join(shots,`unverified-${width}-${theme}-${lang}.png`),fullPage:true});
  await p.locator('[data-run-project="code-firstmate"]').selectOption('codex');await p.locator('[data-run-crew="approved"]').waitFor();
  ok(!await p.locator('[data-run-start]').isDisabled(),'a ready approved crew lets the captain start '+tag);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal page scroll '+tag);
  await p.screenshot({path:join(shots,`approved-${width}-${theme}-${lang}.png`),fullPage:true});
  if(width===1440&&theme==='light'&&lang==='en'){
   const crew=(await api('/api/wruns/start-options?workflow=code-firstmate')).body.projects.find(x=>x.id==='codex').staffing;await p.locator('[data-run-text]').fill('Add one README line');
   const [response]=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/api/wruns')&&r.request().method()==='POST'),p.locator('[data-run-start]').click()]);const sent=JSON.parse(response.request().postData()),body=await response.json();
   ok(response.status()===200&&!!body.id&&sent.params.project==='codex'&&sent.staffingExpected===crew.hash,'Start sends the chosen project and the crew it showed, and the Task starts '+JSON.stringify(body).slice(0,200));
   await p.waitForURL(/#\/run\/R-/);
  }
  await p.goto(base+'/#/workflows');await p.locator('[data-wf-held="github-review"]').waitFor();
  ok((await p.locator('[data-wf-held-reason="github-review"]').textContent()).length>0&&await p.locator('[data-wf="github-review"]').count()===0,'the catalog shows github-review as held with its reason '+tag);
  await p.goto(base+'/#/workflows/github-review');await p.locator('[data-workflow-held]').waitFor();ok(await p.locator('[data-ed-run]').count()===0,'the held editor offers no Run '+tag);
  await p.close();}
 const trace=join(dirname(claudeBin),'trace.jsonl');ok(existsSync(trace)&&readFileSync(trace,'utf8').trim().split('\n').every(l=>['auth','models'].includes(JSON.parse(l).phase)),'the Start form only ever ran the free Claude auth status and model list, never a model request');
 console.log(`board-start-ui: ${pass} passed, 0 failed`);
}catch(e){console.log(output.slice(-4000));throw e;}finally{await browser?.close();if(app.exitCode===null&&app.signalCode===null){const end=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await end;}thaw(tmp);rmSync(tmp,{recursive:true,force:true});}
