import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Cursor's page login in a real Studio on the offline cursor-agent fixture, beside the Codex and Claude cards (still there,
// one each): without the crew's key the start card and the Doctor say so (English and zh-TW) and Start stays off; the Doctor's
// login action shows how to add the key and never a key; once the key file is there, Check again turns the card ready and
// Start on Cursor opens Studio's own Firstmate on Cursor. No real vendor, keychain or network.
import{spawn}from'node:child_process';import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';import{fileURLToPath}from'node:url';import{freePort,waitUp,withSession}from'./boot.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'..'),FIXTURE=join(here,'fixture/cursor-agent.mjs'),tmp=mkdtempSync(join(tmpdir(),'crew-cursor-login-')),home=join(tmp,'home'),data=join(tmp,'data'),calls=join(tmp,'cursor.jsonl');
mkdirSync(join(home,'.codex'),{recursive:true});mkdirSync(data);
// the Doctor runs `<bin> --version` directly: a thin wrapper gives it the fixture as an executable
const cli=join(tmp,'cursor-agent');writeFileSync(cli,`#!/bin/sh\nexec bun "${FIXTURE}" "$@"\n`,{mode:0o755});
const KEY='crsr_acceptance'+'0'.repeat(49); // the fixture's key shape; not a credential
const port=await freePort(),base=`http://127.0.0.1:${port}`,token='cursor-login-fixture-token';
const env={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_RUNTIME_DIR:join(tmp,'runtime'),CREW_SESSION_TOKEN:token,CREW_PORT:String(port),CREW_GH:'0',CREW_GH_NO_CLI:'1',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_NO_REAL_INSTALL:'1',CREW_LOCAL_UNRESTRICTED:'0',
 CREW_KEYCHAIN_TOOL:'none',CREW_CURSOR_BIN:cli,CREW_HOST_CURSOR_BIN:FIXTURE,CURSOR_FIXTURE_LOG:calls};
for(const k of['CURSOR_API_KEY','CREW_CURSOR_MODEL','CREW_MAIN_PROJECT','CREW_FM_STATE','CLAUDE_CODE_OAUTH_TOKEN'])delete env[k];
const app=spawn('bun',['src/server.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let output='';app.stdout.on('data',b=>output+=b);app.stderr.on('data',b=>output+=b);
let browser,pass=0;const errors=[];const ok=(v,n)=>{if(!v)throw new Error(n);console.log('ok '+n);pass++;};
const runs=()=>existsSync(calls)?readFileSync(calls,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
const api=async(path,body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-crew-session':token},body:body===undefined?undefined:JSON.stringify(body)});return r.json();};
try{await waitUp(base,app);const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');browser=withSession(await chromium.launch({headless:true}),base,token);
 const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(base+'/#/board');await p.evaluate(()=>setLang('en'));
 const card='[data-firstmate-welcome] [data-section="start-cursor"]';
 await p.locator(`${card}[data-cursor-account="key-missing"] [data-cursor-start-why="cursorKeyMissing"]`).waitFor({timeout:15000});
 ok(await p.locator('[data-firstmate-welcome] [data-section="start-codex"]').count()===1&&await p.locator('[data-firstmate-welcome] [data-section="start-claude"]').count()===1&&await p.locator(card).count()===1,'the welcome offers Codex, Claude and Cursor, one card each');
 ok(await p.locator(`${card} [data-cursor-start]`).isDisabled(),'without the crew\'s key Start on Cursor stays off');
 ok(/crew-studio-cursor-api-key/.test(await p.locator(`${card} [data-cursor-key-step]`).textContent()),'the card shows how to keep a Cursor API key in the keychain');
 ok(/Cursor API key/.test(await p.locator(`${card} [data-cursor-start-why]`).textContent()),'the card says why it cannot start (English)');
 await p.evaluate(()=>setLang('zh-TW'));await p.waitForFunction(()=>/尚未設定/.test(document.querySelector('[data-cursor-start-why]')?.textContent||''));
 ok(/Cursor API key/.test(await p.locator(`${card} [data-cursor-start-why]`).textContent()),'the card says why it cannot start (zh-TW)');
 await p.evaluate(()=>setLang('en'));
 await p.goto(base+'/#/doctor');await p.locator('[data-item="round-login-cursor"][data-status="missing"] [data-login="cursor"]').waitFor({timeout:15000});
 ok(/Not signed in/.test(await p.locator('[data-item="cursor"]').textContent()),'Doctor: the Cursor CLI is found and not signed in');
 ok(await p.locator('.tk-account[data-cursor-account="key-missing"]').count()===1&&await p.locator('[data-item="codex"]').count()===1&&await p.locator('[data-item="claude"]').count()===1,'Doctor: a Cursor account panel beside the unchanged Codex and Claude rows');
 await p.locator('[data-item="round-login-cursor"] [data-login="cursor"]').click();await p.locator('#modalRoot .modal [data-cursor-key-step]').waitFor();
 ok(/Add a Cursor API key/.test(await p.locator('#modalRoot .modal').textContent()),'Doctor\'s login action explains how to add the key, in the page');
 // the captain keeps the key for the crew (here the private file; the keychain is off in tests), then checks again
 const dir=join(home,'.config','crew-studio');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'cursor-api-key'),KEY+'\n',{mode:0o600});chmodSync(join(dir,'cursor-api-key'),0o600);
 await p.locator('#modalRoot .modal .btn.primary').click();
 await p.locator('.tk-account[data-cursor-account="key-present"]').waitFor({timeout:15000});ok(true,'Check again sees the new key at once');
 ok(!(await p.content()).includes(KEY),'the Doctor never shows the key');
 await p.goto(base+'/#/board');await p.locator(`${card}[data-cursor-account="key-present"][data-cursor-ready="true"]`).waitFor({timeout:15000});
 ok(!await p.locator(`${card} [data-cursor-start]`).isDisabled()&&await p.locator(`${card} [data-cursor-start-why]`).count()===0,'with the key the card is ready and Start on Cursor is on');
 ok(runs().length===0,'no page read ran a Cursor chat or turn');
 for(const lang of['en','zh-TW']){await p.setViewportSize({width:390,height:900});await p.evaluate(l=>setLang(l),lang);await p.locator(card).waitFor();ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`no horizontal page scroll at 390 px (${lang})`);}
 await p.setViewportSize({width:1440,height:1000});await p.evaluate(()=>setLang('en'));
 await p.locator(`${card} [data-cursor-start]`).click();
 await p.waitForFunction(()=>MS.view?.state==='attached'&&MS.view?.host==='cursor',null,{timeout:15000});
 await p.locator('#chatLog').getByText('Hello! I am your Studio Firstmate. What would you like to make?').waitFor({timeout:15000});
 ok(true,'Start on Cursor opens Studio\'s own Firstmate on Cursor and its greeting shows in the chat');
 ok(runs().filter(r=>r.argv[0]==='create-chat').length===1&&runs().filter(r=>r.argv[0]==='-p').length===1,'one Cursor chat and one greeting turn');
 ok(!(await p.content()).includes(KEY),'the page never shows the key');
 ok(errors.length===0,'no browser errors '+errors.join('\n'));
 await api('/api/main/detach',{});await p.close();console.log(`cursor-login-ui: ${pass} passed, 0 failed`);
}catch(error){console.log('fixture server:',output.slice(-4000));throw error;}finally{await browser?.close();if(app.exitCode===null&&app.signalCode===null){const end=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await end;}rmSync(tmp,{recursive:true,force:true});}
