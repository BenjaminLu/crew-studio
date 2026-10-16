import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Doctor does not infer login or tool readiness from CLI installation.
// Isolated stub server; captures both languages, viewport sizes and themes.
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
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
const app=spawn("bun",["src/server.ts"],{cwd:root,env:{...env,HOME:home,CODEX_HOME:join(home,".codex"),CREW_CODEX_BIN:process.execPath,CREW_GH_NO_CLI:"1",CREW_GH:"0",CREW_FM_STATE:state,CREW_PORT:String(port),CREW_READONLY:"0",CREW_DATA:join(tmp,"data"),CREW_CHAT_PROVIDER:"stub",CREW_MAIN_PROJECT:proj,CREW_HOST_CODEX_BIN:join(here,"stub-host-codex.mjs"),CREW_HOST_CLAUDE_BIN:join(here,"stub-host-claude.mjs"),STUB_CODEX_NO_FORK:process.env.UI_NO_FORK || "0",STUB_CODEX_INIT_DELAY:"400",STUB_CODEX_EXIT_DELAY:"400",STUB_CODEX_MODEL:"captain-model",STUB_CODEX_EFFORT:"high",STUB_CODEX_LOG:log,STUB_CODEX_THREADS:JSON.stringify([{id:live,cwd:proj,preview:"firstmate codex UI session",updatedAt:now-3600}]),CREW_WAKE_GRACE_MS:"600000",CREW_INSTALL_RUNNER:"mock",CREW_NO_REAL_INSTALL:"1"},stdio:["ignore","pipe","pipe"]});
let appLog=""; app.stdout.on("data",d=>appLog+=d); app.stderr.on("data",d=>appLog+=d);
await waitUp(base,app);
const browser=withSession(await chromium.launch(),base), errors=[];
let pass=0,fail=0;
const ok=(c,name)=>{console.log(`  ${c?"ok":"FAIL"} ${name}`); c?pass++:fail++;};
const seen=(p,s)=>p.waitForSelector(s,{timeout:8000}).then(()=>true).catch(()=>false);
const shots=join(root,"tests/out/codex-toolchain"); mkdirSync(shots,{recursive:true});
async function captureCodex(p, width, scheme, lang) {
  const row=p.locator('[data-item="codex"]');
  await row.evaluate(el=>el.scrollIntoView({block:"center",inline:"nearest"}));
  const badge=row.locator('.doc-t .badge');
  ok(await badge.innerText()===(lang==="zh"?"可用":"Available") && (await badge.getAttribute('class')).split(/\s+/).includes('ok'),`Codex badge describes installation only ${width} ${scheme} ${lang}`);
  ok(await row.evaluate(el=>{
    const r=el.getBoundingClientRect(), main=document.querySelector('.main').getBoundingClientRect();
    const login=el.querySelector('[data-login="codex"]'), a=login.getBoundingClientRect();
    return r.top>=main.top && r.bottom<=main.bottom && a.top>=0 && a.bottom<=innerHeight && document.elementFromPoint(a.left+a.width/2,a.top+a.height/2)?.closest('[data-login="codex"]')===login;
  }),`entire Codex row and login action visible and reachable ${width} ${scheme} ${lang}`);
  await p.screenshot({path:join(shots,`doctor-${lang==="zh"?"zh-":""}${width}-${scheme}.png`)});
}
try {
for(const width of [1440,390]) for(const scheme of ["light","dark"]) {
  const p=await browser.newPage({viewport:{width,height:900},colorScheme:scheme});p.on("pageerror",e=>errors.push(String(e)));
  await p.goto(`${base}/#/doctor`);ok(await seen(p,'[data-item="codex"]'),`Doctor renders ${width} ${scheme}`);
  const detail=await p.locator('[data-item="codex"] .doc-d').innerText();
  ok(/not verified/.test(detail),`Doctor does not infer login or tool readiness from installed CLI ${width} ${scheme}`);
  ok(await p.locator('[data-item="main"]').getAttribute('data-status')==="info",`main session readiness is informational ${width} ${scheme}`);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Doctor no horizontal overflow ${width} ${scheme}`);
  await captureCodex(p,width,scheme,"en");
  await p.evaluate(()=>setLang("zh-TW"));
  ok(/尚未驗證/.test(await p.locator('[data-item="codex"] .doc-d').innerText()),`Doctor readiness explanation translated ${width} ${scheme}`);
  await captureCodex(p,width,scheme,"zh");await p.close();
}
ok(!errors.length,"no Doctor page errors");
}finally{await browser.close();app.kill();}
console.log(`codex-toolchain-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
