import "./lib/isolated-env.mjs";
// Production UI, deterministic API/media fixtures, real isolated Studio process. No paid providers or live data.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { freePort, waitUp } from "./boot.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), ".."), tmp = mkdtempSync(join(tmpdir(), "crew-density-ui-"));
const shots = process.env.UI_DENSITY_SHOTS || join(tmp, "captures");
for (const d of ["home", "data", "project", "captures"]) mkdirSync(join(tmp, d), { recursive: true }); mkdirSync(shots,{recursive:true});
cpSync(join(root, "tests/fixture/state"), join(tmp,"state"), { recursive: true });
const token = "isolated-ui-fixture-only", port = await freePort(), backend = `http://127.0.0.1:${port}`;
const env = { PATH: process.env.PATH, HOME:join(tmp,"home"), TMPDIR:tmp, CREW_TEST_ENV_ISOLATED:process.env.CREW_TEST_ENV_ISOLATED, CREW_SESSION_TOKEN:token, CREW_PORT:String(port), CREW_DATA:join(tmp,"data"), CREW_FM_STATE:join(tmp,"state"), CREW_MAIN_PROJECT:join(tmp,"project"), CREW_GH:"0", CREW_GH_NO_CLI:"1", CREW_CHAT_PROVIDER:"stub", CREW_READONLY:"1", CREW_NO_REAL_INSTALL:"1", CREW_CLAUDE_BIN:"/nonexistent/claude", CREW_CODEX_BIN:"/nonexistent/codex" };
const app = spawn("bun",["src/server.ts"],{cwd:root,env,stdio:["ignore","pipe","pipe"]}); let serverLog=""; app.stdout.on("data",b=>serverLog+=b); app.stderr.on("data",b=>serverLog+=b); await waitUp(backend,app);
const version = { n:1,primary:"latest.html",status:"draft",fileCount:1,createdBy:{kind:"captain"} };
const art=(id,type="web",over={})=>({id,type,title:id,entry:"old.html",source:"html",latest:1,versions:[{...version,...over}]});
const artifacts=[art("Static latest primary"),art("Script only"),art("Empty canvas"),art("Empty iframe"),art("Blank iframe src"),art("Blank iframe srcdoc"),art("CSS artwork"),art("Missing file"),art("Capability denied"),art("Loading delayed"),art("No version"),art("External link"),art("Image","image",{primary:"image.svg"}),art("Broken image","image",{primary:"missing.png"}),art("Video","video",{primary:"movie.mp4"}),art("Audio","audio",{primary:"tone.wav"})];
artifacts.find(a=>a.id==="No version").versions=[]; artifacts.find(a=>a.id==="External link").source="url";
for(const a of artifacts)a.id=a.id.toLowerCase().replaceAll(" ","-");
execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:s=160x90:d=1","-pix_fmt","yuv420p",join(tmp,"movie.mp4")]);
execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=440:duration=1",join(tmp,"tone.wav")]);
const session={host:"codex",id:"fixture-session",model:"fixture-model"};
const main=await fetch(backend+"/api/main",{headers:{"x-crew-session":token}}).then(r=>r.json());
const at=Date.now()-60000, log=[];
for(let i=0;i<8;i++){log.push({at:at+i*1000,kind:"captain",text:"請檢查這個版本的證據，保留尚未確認的風險。".repeat(4),session});for(let j=0;j<6;j++)log.push({at:at+i*1000+j+1,kind:"tool",text:`fixture_tool ${i}-${j}`,tool:"fixture_tool",activity:{en:`Inspect evidence ${i}-${j}`,"zh-TW":`檢查證據 ${i}-${j}`},session});}
log.push({at:at+8100,kind:"captain",text:"Keep this human request visible before a long tool burst.",session});
for(let j=0;j<96;j++)log.push({at:at+8200+j,kind:"tool",text:`fixture_long_tool ${j}`,tool:"fixture_long_tool",activity:{en:`Long burst ${j}`,"zh-TW":`長工具活動 ${j}`},session});
log.push({at:at+9000,kind:"status",text:"Turn failed",external:{source:"studio",class:"network",code:"fixture_network",message:"Fixture endpoint unavailable",reason:{en:"Request failed. Review the endpoint.","zh-TW":"請求失敗，請檢查端點。"}},session});
log.push({at:at+10000,kind:"firstmate",text:"檢查結果已整理。請確認待核准的操作；工具紀錄不代表已完成驗收。",session});
log.push({at:at+11000,kind:"tool",text:"fixture_single_tool",tool:"fixture_single_tool",activity:{en:"Single lookup","zh-TW":"單次查詢"},session});
Object.assign(main,{state:"attached",host:"codex",model:"fixture-model",sessionId:session.id,busy:true,log,queue:[],approvals:[{id:"fixture-approval",tool:"fixture_read",summary:"Read fixture evidence only",expires:Date.now()+3600000}]});
// The proxy never issues a Studio cookie: it cannot overwrite another local Studio's session.
// Mutations are refused; UI state is local and API/media responses are fixtures.
const delayedRequests=[];
const proxy=createServer(async(req,res)=>{try{
 const u=new URL(req.url,"http://fixture.local"), path=u.pathname;
 if(/^\/afc\/[^/]+\/loading-delayed\/1\/latest\.html$/.test(path))delayedRequests.push(req.headers["sec-fetch-dest"]);
 if(path==="/af-cap/loading-delayed/1")delayedRequests.push("cap");
 if(req.method!=="GET"){res.writeHead(403,{"content-type":"application/json"});res.end(JSON.stringify({error:"Read-only fixture; no real operations"}));return;}
 const json=o=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(o));};
 if(path==="/api/main")return json(main);
 if(path==="/api/artifacts")return json({artifacts,render:{},runs:[]});
 if(path.startsWith("/af-cap/capability-denied/")){res.writeHead(403);res.end("Fixture capability refused");return;}
 if(path.startsWith("/af-cap/"))return json({cap:"fixture"});
 if(/^\/(af|afc)\//.test(path)){
  const parts=path.split("/"), offset=parts[1]==="afc"?1:0,id=decodeURIComponent(parts[2+offset]),file=parts.slice(4+offset).join("/");
  if(id==="missing-file"||id==="broken-image"){res.writeHead(404);res.end("Missing fixture file");return;}
  if(id==="loading-delayed")await new Promise(r=>setTimeout(r,1600));
  if(file==="movie.mp4"||file==="tone.wav"){res.writeHead(200,{"content-type":file.endsWith("mp4")?"video/mp4":"audio/wav"});res.end(readFileSync(join(tmp,file)));return;}
  if(file==="image.svg"){res.writeHead(200,{"content-type":"image/svg+xml"});res.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#2f5bd3"/></svg>');return;}
  const content=id==="script-only"?'<html><head><title>Script app</title></head><body><div id="root"></div><script>document.body.textContent="SCRIPT EXECUTED"</script></body></html>':id==="empty-canvas"?'<canvas></canvas><script>document.body.textContent="SCRIPT EXECUTED"</script>':id==="empty-iframe"?'<iframe></iframe>':id==="blank-iframe-src"?'<iframe src=" "></iframe>':id==="blank-iframe-srcdoc"?'<iframe srcdoc=" "></iframe>':id==="css-artwork"?'<style>.art{width:100%;height:600px;background:#2447a8}</style><div class="art"></div>':file==="latest.html"?'<h1 style="color:#2447a8">Verified static latest version</h1><p>Scripts stay disabled.</p>':'<h1>WRONG OLD ENTRY</h1>';
  res.writeHead(200,{"content-type":"text/html","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-src 'self'; sandbox"});res.end(content);return;
 }
 const headers={...req.headers,host:`127.0.0.1:${port}`,"x-crew-session":token,cookie:`crew_session=${token}`};delete headers.connection;
 const abort=new AbortController();res.on("close",()=>abort.abort());
 const response=await fetch(backend+req.url,{headers,signal:abort.signal});const out=Object.fromEntries(response.headers);delete out["set-cookie"];delete out["content-encoding"];delete out["content-length"];
 res.writeHead(response.status,out);if(response.body)for await(const chunk of response.body)res.write(chunk);res.end();
}catch(e){if(res.destroyed)return;if(!res.headersSent)res.writeHead(502);res.end(String(e));}});
await new Promise(r=>proxy.listen(0,"127.0.0.1",r));const base=`http://127.0.0.1:${proxy.address().port}`;
let browser,passed=0;const errors=[];const ok=(v,s)=>{if(!v)throw new Error(s);passed++;console.log("PASS "+s);};
const near=(x,want)=>Math.abs(x-want)<1;
const seed=()=>{if(window!==top)return;localStorage.setItem("crew.side","open");localStorage.setItem("crew.lang","zh-TW");localStorage.setItem("crew.chatOpen","1");localStorage.setItem("crew.labs","1");localStorage.setItem("crew.onboarding.journey.dismissed.v1","1");};
try{
 const{chromium}=await import("playwright");browser=await chromium.launch({headless:true,...(process.env.UI_DENSITY_CHANNEL?{channel:process.env.UI_DENSITY_CHANNEL}:{})});
 const ctx=await browser.newContext({viewport:{width:1440,height:900}});await ctx.addInitScript(seed);
 const page=await ctx.newPage();page.on("pageerror",e=>errors.push(String(e)));await page.goto(base+"/#/board");await page.waitForSelector('[data-main="firstmate"]');await page.screenshot({path:join(shots,"desktop-chat.png")});
 ok(await page.locator('[data-tool-group]').count()===9,"144 tool records form nine conversation-scoped groups");
 const single=page.locator('#chatLog [data-main=tool]').filter({hasText:'單次查詢'});ok(await single.count()===1&&await single.evaluate(e=>!e.closest('[data-tool-group]'))&&await page.locator('[data-tool-group="1"]').count()===0,"a single tool call stays one ungrouped activity line");
 ok(await page.locator('[data-main=captain]').filter({hasText:'Keep this human request visible'}).count()===1&&await page.locator('[data-tool-group="96"]').count()===1,"human request survives more than80 consecutive tool records within server200-record window");
 ok(await page.locator('[data-tool-group][open]').count()===0,"tool groups initially collapsed");
 ok(await page.locator('[data-approval]').isVisible()&&await page.locator('[data-external-error]').count()===1&&await page.locator('[data-main=live]').isVisible(),"approval, error and running state remain outside collapsed groups");
 const group=page.locator('[data-tool-group]').last();await group.locator(':scope>summary').click();await page.evaluate(()=>renderChat(false));ok(await group.evaluate(e=>e.open),"activity expansion survives chat repaint");
 await page.locator('#chatLog').evaluate(e=>e.scrollTop=100);await page.evaluate(()=>renderChat(false));ok(Math.abs(await page.locator('#chatLog').evaluate(e=>e.scrollTop)-100)<2,"reading scroll survives chat repaint");
 ok(await page.locator('#chat').evaluate(e=>e.getBoundingClientRect().width)<=401,"default chat leaves room for workspace");
 const grip=page.locator('#chatGrip');await grip.focus();for(let i=0;i<30;i++)await page.keyboard.press('ArrowLeft');ok(await page.locator('#chat').evaluate(e=>e.offsetWidth)<=680,"keyboard resize clamps chat width");
 ok(await grip.evaluate(e=>e.getAttribute('aria-valuemin')==='360'&&Number(e.getAttribute('aria-valuemax'))>=Number(e.getAttribute('aria-valuenow'))&&Number(e.getAttribute('aria-valuenow'))>=360),"chat resize separator exposes its value range");
 await page.locator('#chatWide').click();await page.setViewportSize({width:390,height:844});ok(near(await page.locator('#chat').evaluate(e=>e.getBoundingClientRect().width),390),"wide desktop chat becomes full-width phone sheet");await page.locator('#chatClose').click();
 await page.setViewportSize({width:1100,height:560});await page.goto(base+'/#/board');ok(await page.locator('.nav-labs-h').getAttribute('aria-expanded')==='false',"Labs initially collapsed");
 ok(await page.getByRole('button',{name:'實驗中',exact:true}).count()===1,"Labs disclosure arrow is not part of its accessible name");
 await page.locator('.nav-labs-h').click();ok(await page.locator('.nav').evaluate(e=>e.scrollWidth<=e.clientWidth+1&&getComputedStyle(e).overflowX==='hidden'),"expanded desktop Labs has no horizontal scrollbar or clipped labels");await page.reload();ok(await page.locator('.nav-labs-h').getAttribute('aria-expanded')==='true',"Labs expansion persisted");await page.locator('.nav-labs-h').click();await page.goto(base+'/#/doc/fixture');await page.waitForTimeout(100);ok(await page.locator('.nav-labs-h').getAttribute('aria-expanded')==='true'&&await page.locator('.nav-item[data-view=docs]').getAttribute('aria-current')==='page',"deep-linked Labs subpage expands and marks parent");
 ok(await page.locator('#projH').isVisible()&&await page.locator('#navSettings').isVisible(),"Projects and Settings are visible rather than zero-size hidden links");ok(await page.locator('#navSettings').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight)&&await page.locator('#projH').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),"Projects and Settings remain in viewport with expanded Labs at1100x560");await page.locator('#navSettings').click();ok(page.url().endsWith('#/settings'),"Settings reachable at short height");await page.locator('#projH').click();ok(page.url().endsWith('#/projects'),"Projects reachable at short height");await page.screenshot({path:join(shots,"short-navigation.png")});
 {
  // The chat cap follows the window; opening Studio in a narrow window must not overwrite the captain's saved width.
  const narrow=await browser.newContext({viewport:{width:1000,height:800}});await narrow.addInitScript(seed);await narrow.addInitScript(()=>{if(window===top&&!localStorage.getItem("crew.chatW"))localStorage.setItem("crew.chatW","820");});
  const p=await narrow.newPage();p.on("pageerror",e=>errors.push(String(e)));const saved=()=>p.evaluate(()=>localStorage.getItem("crew.chatW"));
  const cap=()=>p.evaluate(()=>Math.max(360,Math.min(680,innerWidth-document.querySelector('.side').getBoundingClientRect().width-480)));
  await p.goto(base+"/#/board");await p.waitForSelector('#chatGrip',{state:'attached'});
  ok(await p.evaluate(()=>document.documentElement.style.getPropertyValue('--chat-w'))==='360px'&&await saved()==='820',"phone-width start clamps chat on screen without overwriting saved width");
  await p.setViewportSize({width:1200,height:800});await p.reload();await p.waitForSelector('#chat:visible');const c1200=await cap();
  ok(c1200<820&&near(await p.locator('#chat').evaluate(e=>e.getBoundingClientRect().width),c1200)&&await saved()==='820',`1200px start clamps chat to ${c1200}px without overwriting saved width`);
  await p.setViewportSize({width:1600,height:900});await p.waitForFunction(()=>Math.abs(document.querySelector('#chat').getBoundingClientRect().width-680)<1);
  ok(await saved()==='820',"widening the window restores the saved wide chat up to the cap");await narrow.close();
 }
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/#/library');await page.waitForSelector('[data-artifact=loading-delayed]');
 ok(await page.locator('[data-artifact=loading-delayed] [data-preview-state=loading]').count()===1,"delayed preview has named loading state");
 ok(await page.locator('.libgrid[aria-busy=true]').count()===1&&await page.locator('.libgrid [role=status]').count()===0,"loading previews mark the grid busy instead of making every card a live region");
 for(const id of['static-latest-primary','css-artwork','image','video'])await page.locator(`[data-artifact=${id}] [data-preview-state=ready]`).waitFor();
 await page.frameLocator('[data-artifact=loading-delayed] iframe').getByText('Verified static latest version').waitFor();
 ok(true,"static HTML, CSS artwork, image and video previews ready; delayed iframe actually painted source content");
 for(const id of['script-only','empty-canvas','empty-iframe','blank-iframe-src','blank-iframe-srcdoc','no-version','external-link']){await page.locator(`[data-artifact=${id}] [data-preview-state=missing]`).waitFor();ok(true,`explicit missing fallback: ${id}`);}
 for(const id of['missing-file','broken-image','capability-denied']){await page.locator(`[data-artifact=${id}] [data-preview-state=error]`).waitFor();ok(true,`explicit failure fallback: ${id}`);}
 await page.locator('.libgrid[aria-busy=false]').waitFor();ok(true,"grid is no longer busy once every preview settles");
 ok((await page.locator('[data-artifact=static-latest-primary] iframe').getAttribute('src')).endsWith('/latest.html'),"thumbnail uses latest version primary rather than old entry");
 ok(await page.locator('[data-artifact=script-only] iframe').count()===0,"script-only app never executes in thumbnail");
 const heights=await page.locator('.a3-card>.lprev').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));ok(heights.every(h=>near(h,170)),"all media and fallback preview slots share height");
 await page.screenshot({path:join(shots,'desktop-library.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(shots,'narrow-library.png'),fullPage:true});ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"narrow Library has no horizontal overflow");
 {
  // Opening the Library directly renders it several times while its lists load; every render shares one preview load.
  delayedRequests.length=0;const fresh=await ctx.newPage();fresh.on("pageerror",e=>errors.push(String(e)));await fresh.goto(base+'/?labs=1#/library');
  await fresh.frameLocator('[data-artifact=loading-delayed] iframe').getByText('Verified static latest version').waitFor({timeout:15000});
  const count=k=>delayedRequests.filter(d=>d===k).length;
  ok(count("cap")===1&&count("empty")===1,`direct Library load fetches the delayed preview once (requests: ${delayedRequests.join(",")})`);
  // Version files are immutable: a Library refresh reuses the analysed preview instead of fetching and parsing it again.
  await fresh.getByRole('button',{name:'重新整理'}).click();await fresh.locator('[data-artifact=loading-delayed] [data-preview-state=ready]').waitFor({timeout:15000});
  ok(count("cap")===1&&count("empty")===1,`Library refresh does not refetch a loaded preview (requests: ${delayedRequests.join(",")})`);await fresh.close();
 }
 ok(!errors.length,"no browser JavaScript errors");
 console.log(`ui-information-density: ${passed} passed; captures ${shots}`);
}finally{await browser?.close();proxy.closeAllConnections();await new Promise(r=>proxy.close(r));app.kill('SIGTERM');writeFileSync(join(tmp,'server.log'),serverLog);writeFileSync(join(tmp,'evidence.json'),JSON.stringify({passed,errors,shots},null,2));}
