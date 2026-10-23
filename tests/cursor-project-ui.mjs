import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Firstmate on Cursor in an explicit project, in a real Studio on the offline cursor-agent fixture and the Codex stub: the
// Firstmate page keeps the Codex start card and Claude's account panel (no Claude start) and adds one Cursor start card that
// says it follows the project and its handoff (English and zh-TW); only its own button, after the project-availability
// confirmation, starts a fresh Cursor chat in the project with cursor-agent's sandbox on; Stop Firstmate stops it with no
// terminal command. No real vendor, keychain or network.
import{spawn}from'node:child_process';import{cpSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';import{freePort,waitUp,withSession}from'./boot.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'..'),FIXTURE=join(here,'fixture/cursor-agent.mjs'),tmp=mkdtempSync(join(tmpdir(),'crew-cursor-project-')),home=join(tmp,'home'),data=join(tmp,'data'),calls=join(tmp,'cursor.jsonl'),codexLog=join(tmp,'codex.log');
const proj=join(tmp,'proj'),state=join(tmp,'state');mkdirSync(join(home,'.codex'),{recursive:true});mkdirSync(data);mkdirSync(proj);
cpSync(join(here,'fixture/state'),state,{recursive:true});writeFileSync(join(state,'HANDOFF-2026-10-23.md'),'# Firstmate handoff\nCURSOR-PROJECT-UI-HANDOFF\n');writeFileSync(codexLog,'');
const cli=join(tmp,'cursor-agent');writeFileSync(cli,`#!/bin/sh\nexec bun "${FIXTURE}" "$@"\n`,{mode:0o755});
const KEY='crsr_acceptance'+'0'.repeat(49); // the fixture's key shape; not a credential
const keyDir=join(home,'.config','crew-studio');mkdirSync(keyDir,{recursive:true});writeFileSync(join(keyDir,'cursor-api-key'),KEY+'\n',{mode:0o600});
const port=await freePort(),base=`http://127.0.0.1:${port}`,token='cursor-project-fixture-token';
const env={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_RUNTIME_DIR:join(tmp,'runtime'),CREW_SESSION_TOKEN:token,CREW_PORT:String(port),CREW_GH:'0',CREW_GH_NO_CLI:'1',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_NO_REAL_INSTALL:'1',CREW_LOCAL_UNRESTRICTED:'0',
 CREW_KEYCHAIN_TOOL:'none',CREW_CURSOR_BIN:cli,CREW_HOST_CURSOR_BIN:FIXTURE,CURSOR_FIXTURE_LOG:calls,CREW_MAIN_PROJECT:proj,CREW_FM_STATE:state,
 CREW_HOST_CODEX_BIN:join(here,'stub-host-codex.mjs'),CREW_HOST_CLAUDE_BIN:join(here,'stub-host-claude.mjs'),STUB_CODEX_LOG:codexLog,STUB_CODEX_THREADS:'[]'};
for(const k of['CURSOR_API_KEY','CREW_CURSOR_MODEL','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_API_KEY','OPENAI_API_KEY'])delete env[k];
const app=spawn('bun',['src/server.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let output='';app.stdout.on('data',b=>output+=b);app.stderr.on('data',b=>output+=b);
let browser,pass=0;const errors=[];const ok=(v,n)=>{if(!v)throw new Error(n);console.log('ok '+n);pass++;};
const runs=()=>existsSync(calls)?readFileSync(calls,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
try{await waitUp(base,app);const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');browser=withSession(await chromium.launch({headless:true}),base,token);
 const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(base+'/#/firstmate');await p.evaluate(()=>setLang('en'));
 const card='[data-section="start-cursor"][data-cursor-context="explicit-project"]';
 await p.locator(`${card}[data-cursor-ready="true"]`).waitFor({timeout:15000});
 ok(await p.locator('[data-section="start-codex"]').count()===1&&await p.locator('[data-section="start-claude"]').count()===0&&await p.locator('.tk-account[data-claude-account]').count()===1&&await p.locator('[data-section="start-cursor"]').count()===1,
  'an explicit project keeps the Codex start card and Claude\'s account panel (no Claude start) and adds one Cursor start card');
 ok(/follows the shown project’s authority and handoff/.test(await p.locator(card).textContent())&&/write only inside this folder/.test(await p.locator(card).textContent()),'the Cursor card says it follows the project and writes only inside it (English)');
 ok(await p.locator(`${card} [data-handoff-file]`).textContent()===await p.locator('[data-section="start-codex"] [data-handoff-file]').textContent()&&/HANDOFF-2026-10-23\.md/.test(await p.locator(`${card} [data-handoff-file]`).textContent()),'its first message is the same project handoff as Codex\'s');
 ok(/Start Firstmate on Cursor/.test(await p.locator(`${card} #startCursorBtn`).textContent()),'its button says Start Firstmate on Cursor');
 await p.evaluate(()=>setLang('zh-TW'));await p.waitForFunction(s=>/Cursor 的沙盒只允許它寫入這個資料夾/.test(document.querySelector(s)?.textContent||''),card);ok(true,'the Cursor card says so in zh-TW');
 await p.evaluate(()=>setLang('en'));
 ok(runs().filter(r=>r.argv[0]==='-p'||r.argv[0]==='create-chat').length===0,'no page read ran a Cursor chat or turn');
 await p.locator(`${card} #startCursorBtn`).click();await p.locator('#modalRoot .modal #tkStartCursorAck').waitFor();
 await p.locator('#modalRoot .modal [data-cursor-start-confirm]').click();await p.waitForTimeout(400);
 ok(await p.locator('#modalRoot .modal #tkStartCursorAck').count()===1&&runs().length===0,'without the project-availability confirmation nothing starts');
 await p.check('#tkStartCursorAck');await p.locator('#modalRoot .modal [data-cursor-start-confirm]').click();
 await p.waitForFunction(()=>MS.view?.state==='attached'&&MS.view?.host==='cursor'&&MS.view?.drive?.path==='fresh'&&!MS.view?.origin,null,{timeout:15000});
 const ws=realpathSync(proj);
 await p.waitForFunction(w=>(document.querySelector('#chatLog')?.textContent||'').includes(`Ready as firstmate in ${w}; first message: state/HANDOFF-2026-10-23.md`),ws,{timeout:15000});
 ok(true,'Start Firstmate on Cursor opens a fresh Cursor chat in the project, seeded with its handoff');
 const turns=runs().filter(r=>r.argv[0]==='-p');
 ok(runs().filter(r=>r.argv[0]==='create-chat').length===1&&turns.length===1&&turns[0].argv[turns[0].argv.indexOf('--workspace')+1]===ws&&turns[0].argv[turns[0].argv.indexOf('--sandbox')+1]==='enabled'&&!turns[0].argv.includes('--force'),'one chat and one greeting turn, in the project with cursor-agent\'s sandbox on');
 ok(!/thread\/start/.test(readFileSync(codexLog,'utf8')),'the Cursor button never starts Codex');
 await p.evaluate(()=>openChat(false));await p.goto(base+'/#/firstmate');await p.locator('#releaseBtn').waitFor({timeout:15000});
 ok(/Stop Firstmate/.test(await p.locator('#releaseBtn').textContent()),'the page offers Stop Firstmate, not a hand-back to a terminal');
 await p.locator('#releaseBtn').click();await p.locator('#modalRoot .modal .btn.primary').click();
 await p.waitForFunction(()=>MS.view?.state==='detached',null,{timeout:15000});await p.waitForTimeout(300);
 ok(await p.locator('#resumeCmd').count()===0&&!existsSync(join(proj,'.cursor')),'stopping gives no terminal command and leaves nothing in the project\'s .cursor/');
 ok(!(await p.content()).includes(KEY),'the page never shows the key');
 ok(errors.length===0,'no browser errors '+errors.join('\n'));
 await p.close();console.log(`cursor-project-ui: ${pass} passed, 0 failed`);
}catch(error){console.log('fixture server:',output.slice(-4000));throw error;}finally{await browser?.close();if(app.exitCode===null&&app.signalCode===null){const end=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await end;}rmSync(tmp,{recursive:true,force:true});}
