// Takeover UI: the Take over page (fork, rehearsal warning, release), a wake from
// a synthetic event in a temp state copy reaching the chat queue, a question
// from the session answered in the chat, the live crew rows with a final report,
// and an intent-alignment card with every section and the one-way door
// confirmation, at 1440 and 390 px in light and dark. No live state is read or
// written: a temp copy of tests/fixture/state, a stub claude, a mock board.
//   node tests/takeover-ui.mjs
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
// Browser-free owning copy control; evaluates the actual production renderer.
if(process.env.TAKEOVER_COPY_ONLY){
 const {runInNewContext}=await import("node:vm");
 const source=readFileSync(join(process.env.TAKEOVER_COPY_ROOT||root,"public/takeover.js"),"utf8");
 const fn=source.slice(source.indexOf("function cutoverSteps("),source.indexOf("function takeoverFlow("));
 const render=runInNewContext(`(${fn.trim()})`,{h:(tag,attrs,...children)=>({tag,attrs,children}),T:en=>en,cmdBox:text=>text,resumeCmd:(host,_project,id)=>`${host} resume ${id}`});
 let failed=0;const check=(yes,name)=>{console.log(`${yes?"ok":"FAIL"} ${name}`);if(!yes)failed++;};
 check(render({project:"/fixture",firstmate:null},{origin:null,drive:{path:"fresh",host:"codex"}})===null,"fresh independent Codex has no terminal cutover instructions");
 check(render({project:"/fixture",firstmate:{id:"other",host:"claude"}},{origin:null,state:"detached"})===null,"unattached inventory cannot manufacture terminal cutover instructions");
 const actual=render({project:"/fixture",firstmate:{id:"unrelated",host:"claude"}},{origin:{id:"owned-original",host:"codex"},drive:{path:"fork"}});
 check(actual?.attrs?.["data-section"]==="cutover"&&JSON.stringify(actual).includes("codex resume owned-original"),"actual takeover preserves cutover with its real original identity");
 console.log(`takeover-copy: ${3-failed} passed, ${failed} failed`);process.exit(failed?1:0);
}
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("takeover-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const tmp = mkdtempSync(join(tmpdir(), "crew-takeover-ui-"));
const state = join(tmp, "state");
cpSync(join(here, "fixture/state"), state, { recursive: true });
mkdirSync(join(state, "session/acknowledged"), { recursive: true });
writeFileSync(join(state, "session/wake.jsonl"), "");
const now = Date.now() / 1000;
for (const r of readdirSync(join(state, "runs"))) utimesSync(join(state, "runs", r), now, now);
const home = join(tmp, "home"), proj = join(tmp, "proj"); mkdirSync(join(home, ".codex"), {recursive:true}); mkdirSync(join(proj,"state"), {recursive:true});
writeFileSync(join(home,".codex/config.toml"), 'model = "captain-model"\nmodel_reasoning_effort = "high"\n');
writeFileSync(join(state,"HANDOFF-test.md"), "# Firstmate handoff\nUI-HANDOFF-MARKER\n");
const live = "019a1111-2222-7333-8444-555566667777", log = join(tmp,"codex.log");
const port=await freePort(), base=`http://127.0.0.1:${port}`;
const env={...process.env}; for(const k of ["GITHUB_TOKEN","GH_TOKEN","CREW_GITHUB_TOKEN","ANTHROPIC_API_KEY","OPENAI_API_KEY"]) delete env[k];
const app=spawn("bun",["src/server.ts"],{cwd:root,env:{...env,HOME:home,CODEX_HOME:join(home,".codex"),CREW_GH_NO_CLI:"1",CREW_GH:"0",CREW_FM_STATE:state,CREW_PORT:String(port),CREW_READONLY:"0",CREW_DATA:join(tmp,"data"),CREW_CHAT_PROVIDER:"stub",CREW_MAIN_PROJECT:proj,CREW_HOST_CODEX_BIN:join(here,"stub-host-codex.mjs"),CREW_HOST_CLAUDE_BIN:join(here,"stub-host-claude.mjs"),STUB_CODEX_NO_FORK:process.env.UI_NO_FORK || "0",STUB_CODEX_INIT_DELAY:"400",STUB_CODEX_EXIT_DELAY:"400",STUB_CODEX_MODEL:"captain-model",STUB_CODEX_EFFORT:"high",STUB_CODEX_LOG:log,STUB_CODEX_THREADS:JSON.stringify([{id:live,cwd:proj,preview:"firstmate codex UI session",updatedAt:now-3600}]),CREW_WAKE_GRACE_MS:"600000",CREW_INSTALL_RUNNER:"mock",CREW_NO_REAL_INSTALL:"1"},stdio:["ignore","pipe","pipe"]});
let appLog=""; app.stdout.on("data",d=>appLog+=d); app.stderr.on("data",d=>appLog+=d);
await waitUp(base,app);
const browser=withSession(await chromium.launch(),base), errors=[];
let pass=0,fail=0;
const ok=(c,name)=>{console.log(`  ${c?"ok":"FAIL"} ${name}`); c?pass++:fail++;};
const seen=(p,s)=>p.waitForSelector(s,{timeout:8000}).then(()=>true).catch(()=>false);
const shots=join(root,process.env.UI_NO_FORK ? "tests/out/takeover-codex/handoff" : "tests/out/takeover-codex"); mkdirSync(shots,{recursive:true});
try {
for(const width of [1440,390]) for(const scheme of ["light","dark"]) {
const p=await browser.newPage({viewport:{width,height:900},colorScheme:scheme}); p.on("pageerror",e=>errors.push(String(e)));
await p.goto(`${base}/#/firstmate`);
ok(await seen(p,'[data-section="start-codex"]'),`fresh start card ${width} ${scheme}`);
await p.click("[data-optional-sessions]");
ok(await seen(p,`[data-session="${live}"][data-host="codex"]`),`Codex host-labelled discovery ${width} ${scheme}`);
ok(/captain-model.*high/.test(await p.locator('[data-codex-config]').innerText()),`captain config shown ${width} ${scheme}`);
ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no horizontal overflow ${width} ${scheme}`);
await p.screenshot({path:join(shots,`firstmate-${width}-${scheme}.png`),fullPage:true});
if(width===390) ok(await p.evaluate(() => {
  const a=document.querySelector('.main').getBoundingClientRect(), b=document.querySelector('#chatFab').getBoundingClientRect();
  return a.bottom <= b.top;
}),`launcher has reserved space ${width} ${scheme}`);
{
await p.click('#takeoverBtn'); await p.screenshot({path:join(shots,`confirmation-${width}-${scheme}.png`),fullPage:true}); await p.check('#tkAck'); await p.click('.modal .btn.primary');
ok(await seen(p,`[data-drive-path="${process.env.UI_NO_FORK ? 'handoff' : 'fork'}"]`),"takeover displays fork path");
ok(/captain-model.*high/.test(await p.locator('[data-model-effort]').innerText()),"driving model and effort shown");
await p.evaluate(()=>openChat(false));
await p.screenshot({path:join(shots,`driving-${width}-${scheme}.png`),fullPage:true});
ok(!/Stop hook/.test(await p.locator('[data-idle-warning]').innerText()),`Codex wake warning is host-specific ${width} ${scheme}`);
await p.evaluate(()=>{chatMode="main";openChat(true);renderChat();});
await p.screenshot({path:join(shots,`chat-${width}-${scheme}.png`),fullPage:true});
await fetch(base+"/api/main/send",{method:"POST",headers:{"content-type":"application/json","x-crew-session":process.env.CREW_SESSION_TOKEN},body:JSON.stringify({text:"STUB_TOOL"})});
ok(await seen(p,'[data-approval]'),`actual Codex approval ${width} ${scheme}`);
await p.locator('[data-approval] button').last().scrollIntoViewIfNeeded();
ok(await p.locator('[data-approval] button').evaluateAll(bs=>bs.length===2 && bs.every(b=>{const r=b.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;})),`Allow and Deny reachable ${width} ${scheme}`);
await p.evaluate(()=>toast("Studio is driving"));
ok(await p.evaluate(()=>{const f=document.querySelector('.chat-form').getBoundingClientRect();return [...document.querySelectorAll('.toast')].every(t=>{const r=t.getBoundingClientRect();return r.bottom<=f.top || r.top>=f.bottom || r.right<=f.left || r.left>=f.right;});}),`status toast leaves composer clear ${width} ${scheme}`);
await p.screenshot({path:join(shots,`permission-${width}-${scheme}.png`),fullPage:true});
await p.locator('[data-approval] button').last().click();
await p.evaluate(()=>openChat(false));
await p.click('#releaseBtn'); await p.click('.modal .btn.primary');
ok(await seen(p,'#resumeCmd'),"release command appears"); ok(/codex resume/.test(await p.locator('#resumeCmd').innerText()),"release uses Codex resume");
await p.click('.modal .btn.primary');
await p.click('[data-codex-verify]');await p.waitForSelector('[data-codex-account="ready"]');
await p.click('#startCodexBtn'); await p.click('.modal .btn.primary'); ok(await p.locator('.modal').count()===1,"fresh start waits for project-availability confirmation");
await p.check('#tkStartAck'); await p.click('.modal .btn.primary');
ok(await seen(p,'[data-drive-path="fresh"]'),"fresh firstmate starts on Codex");
for(let n=0;n<160 && !readFileSync(log,"utf8").includes("UI-HANDOFF-MARKER");n++) await p.waitForTimeout(50);
await p.evaluate(()=>openChat(false));
await p.click('#releaseBtn'); await p.click('.modal .btn.primary'); await p.click('.modal .btn.primary');
}
await p.close();
}
{
  const p=await browser.newPage({viewport:{width:390,height:900},colorScheme:"light"});await p.goto(`${base}/#/firstmate`);await seen(p,'#startCodexBtn');
  await p.evaluate(()=>{chatMode="main";openChat(true);renderChat();fetch("/api/main/start",{method:"POST",headers:{"content-type":"application/json","x-crew-session":"test-session"},body:JSON.stringify({host:"codex",confirm:true})});});
  ok(await seen(p,'[data-banner="attaching"]'),"connecting phase shown before the thread and lock exist");
  ok(await p.locator('#chatSend').isDisabled() && await p.locator('[data-approval]').count()===0,"connecting disables sending and has no fabricated permission request");
  await p.screenshot({path:join(shots,'connecting-390-light.png'),fullPage:true});await seen(p,'[data-banner="attached"]');
  await p.evaluate(()=>{void fetch("/api/main/detach",{method:"POST",headers:{"content-type":"application/json","x-crew-session":"test-session"},body:"{}"});});
  ok(await seen(p,'[data-banner="detaching"]'),"releasing phase shown while host shutdown finishes");
  ok(await p.locator("#chatSend").isDisabled(),"release barrier disables sending");
  await p.screenshot({path:join(shots,"releasing-390-light.png"),fullPage:true});await seen(p,'[data-banner="detached"]');
  // detach uses a deliberately delayed stub shutdown; inspect while the request is pending below.
  await p.close();
}
for(const width of [759,760,761,1099,1100,1101]) {
  const p=await browser.newPage({viewport:{width,height:900},colorScheme:"light"});
  await p.goto(`${base}/#/firstmate`); await seen(p,'[data-section="start-codex"]');
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`breakpoint has no horizontal overflow ${width}`);
  await p.screenshot({path:join(shots,`breakpoint-${width}-light.png`),fullPage:true});await p.close();
}
const messages=readFileSync(log,"utf8").trim().split("\n").map(l=>JSON.parse(l));
ok(!messages.some(x=>x.dir==="in" && ["thread/resume","turn/start"].includes(x.msg.method) && x.msg.params?.threadId===live),"UI never resumes or drives original live thread");
ok(messages.some(x=>x.dir==="in" && x.msg.method==="turn/start" && /UI-HANDOFF-MARKER/.test(x.msg.params.input[0].text)),"fresh first message contains handoff");
ok(!errors.length,"no browser errors");
} finally {await browser.close();app.kill();}
console.log(`takeover-codex-ui: ${pass} passed, ${fail} failed`); if(fail) console.log(appLog.slice(-1500)); process.exit(fail?1:0);
