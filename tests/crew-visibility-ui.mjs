import "./lib/isolated-env.mjs";
// Real isolated Studio and Chromium; no live state, accounts or model calls.
import {spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {freePort,waitUp,withSession} from './boot.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),root=join(dirname(fileURLToPath(import.meta.url)),'..'),dir=mkdtempSync(join(tmpdir(),'crew-workflow-trash-ui-')),data=join(dir,'data'),home=join(dir,'home'),token='workflow-trash-fixture',port=await freePort(),base=`http://127.0.0.1:${port}`;mkdirSync(home);
const env={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_PORT:String(port),CREW_SESSION_TOKEN:token,CREW_GH:'0',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_HOST_CODEX_BIN:'/nonexistent/codex',CREW_HOST_CLAUDE_BIN:'/nonexistent/claude'};delete env.CREW_MAIN_PROJECT;delete env.CREW_FM_STATE;
const app=spawn('bun',['src/server.ts'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let output='',browser;app.stdout.on('data',b=>output+=b);app.stderr.on('data',b=>output+=b);let pass=0;const ok=(v,n)=>{if(!v)throw new Error(n);pass++;console.log('ok '+n);};
try{
 await waitUp(base,app);browser=withSession(await chromium.launch(),base,token);
 for(const lang of ['en','zh-TW']){
  const p=await browser.newPage();let mode='loading',release,firstmate=[];const held=new Promise(r=>release=r),errors=[];p.on('pageerror',e=>errors.push(String(e)));
  const agent={job:'J-fixture',run:'R-fixture',workflow:'hello',node:'build',label:'Building fixture page',provider:'stub',model:'offline',round:1,startedAt:new Date().toISOString()};
  await p.route('**/api/crew/live',r=>r.fulfill({json:firstmate}));
  await p.route('**/api/wruns/agents',async r=>{if(mode==='loading')await held;if(mode==='error')return r.fulfill({status:503,json:{error:'fixture unavailable'}});return r.fulfill({json:{agents:mode==='running'?[agent]:mode==='nested'?[{...agent,node:null,round:null}]:[],localJobs:mode==='local'?[{id:'local-1',label:'Rendering',task:'R-fixture',provider:'local',phase:'render',outcome:'running',cleanup:'pending'}]:[]}});});
  await p.goto(base+'/#/crew');await p.evaluate(l=>setLang(l),lang);await p.locator('[data-studio-agents]').waitFor();
  ok(!/0 working now|目前 0 位工作中|No crew round is running|目前沒有船員在跑|Nobody is working|目前沒有人在工作/.test(await p.locator('#view').innerText()),'initial loading never claims zero '+lang);
  mode='running';release();await p.locator('[data-agent-node="R-fixture/build/1"]').waitFor();
  ok(!/No crew round is running|目前沒有船員在跑|Nobody is working|目前沒有人在工作/.test(await p.locator('#view').innerText()),'Studio worker with no Firstmate has no global empty state '+lang);
  ok(await p.locator('#navCrew').innerText()==='1','nav includes Studio worker '+lang);
  await p.goto(base+'/#/board');await p.waitForFunction(()=>/(^|, )1 crew on duty|、1 位船員值班/.test(document.querySelector('#boardSub')?.textContent||''));
  ok(!/No crew round is running|目前沒有船員在跑|Nobody is working|目前沒有人在工作/.test(await p.locator('#view').innerText()),'board includes Studio worker '+lang);
  mode='empty';await p.waitForFunction(()=>!document.querySelector('#navCrew')?.textContent,{},{timeout:10000});
  ok(await p.waitForFunction(()=>/(^|, )0 crew on duty|、0 位船員值班/.test(document.querySelector('#boardSub')?.textContent||''),{},{timeout:10000}).then(()=>true,()=>false),'missed end event converges through polling '+lang);
  mode='running';await p.waitForFunction(()=>document.querySelector('#navCrew')?.textContent==='1',{},{timeout:10000});
  ok(!/No crew round is running|目前沒有船員在跑|Nobody is working|目前沒有人在工作/.test(await p.locator('#view').innerText()),'missed start event refreshes board '+lang);
  mode='error';await p.waitForFunction(()=>/unavailable|無法取得/.test(document.querySelector('#view')?.textContent),{},{timeout:10000});
  ok(!/0 working|0 位工作中|No crew round is running|目前沒有船員在跑|Nobody is working|目前沒有人在工作/.test(await p.locator('#view').innerText()),'refresh failure never asserts zero '+lang);
  mode='local';await p.goto(base+'/#/crew');await p.locator('[data-local-render-job="local-1"]').waitFor();
  ok(await p.locator('[data-studio-agents]').getAttribute('data-studio-agents')==='1','local running job contributes to section count '+lang);
  mode='nested';await p.evaluate(()=>dispatchEvent(new Event('crew:live')));await p.locator('[data-agent-node="J-fixture"]').waitFor();
  ok(await p.locator('[data-agent-node="J-fixture"] a').first().getAttribute('href')==='#/run/R-fixture'&&await p.locator('[data-agent-node="J-fixture"] [data-agent-link]').count()===0,'nested coordinator has exact Task link without fabricated node receipt '+lang);
  firstmate=[{actor:'historic-fixture',name:'Prior round',alive:false,phase:'finished',role:'reviewer',elapsedMs:1000}];
  await p.waitForSelector('[data-actor="historic-fixture"]',{timeout:10000});
  await p.getByRole('button',{name:lang==='en'?'Working':'工作中',exact:true}).click();
  ok(await p.locator('[data-actor="historic-fixture"]').count()===0&&await p.locator('[data-agent-node="J-fixture"]').count()===1,'Firstmate history filter preserves working Studio agents '+lang);
  ok(errors.length===0,'no browser errors '+lang);await p.close();
 }
}finally{await browser?.close();if(app.exitCode===null){const stopped=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await stopped;}rmSync(dir,{recursive:true,force:true});}
console.log(`crew-visibility-ui: ${pass} passed`);
