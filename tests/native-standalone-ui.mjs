import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Native compiled binary web readiness with empty HOME/data and no dependency binaries.
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
const home=join(tmp,"home");mkdirSync(home);
const port=await freePort(), base=`http://127.0.0.1:${port}`;
const env={...process.env}; for(const k of ["GITHUB_TOKEN","GH_TOKEN","CREW_GITHUB_TOKEN","ANTHROPIC_API_KEY","OPENAI_API_KEY"]) delete env[k];
const emptyPath=join(tmp,"empty-path");mkdirSync(emptyPath);
const binary=process.argv[2]||join(root,"dist/crew-studio");
const app=spawn(binary,[],{cwd:tmp,env:{HOME:home,TMPDIR:tmp,PATH:emptyPath,CREW_PORT:String(port),CREW_DATA:join(tmp,"data"),CREW_SESSION_TOKEN:process.env.CREW_SESSION_TOKEN,CREW_INSTALL_RUNNER:"mock",CREW_NO_REAL_INSTALL:"1"},stdio:["ignore","pipe","pipe"]});
let appLog=""; app.stdout.on("data",d=>appLog+=d); app.stderr.on("data",d=>appLog+=d);
await waitUp(base,app);
const browser=withSession(await chromium.launch(),base), errors=[];
let pass=0,fail=0;
const ok=(c,name)=>{console.log(`  ${c?"ok":"FAIL"} ${name}`); c?pass++:fail++;};
const seen=(p,s)=>p.waitForSelector(s,{timeout:8000}).then(()=>true).catch(()=>false);
const shots=join(root,"tests/out/native-standalone"); mkdirSync(shots,{recursive:true});
try {
for(const width of [1440,390]) for(const scheme of ["light","dark"]) {
 const p=await browser.newPage({viewport:{width,height:900},colorScheme:scheme});p.on("pageerror",e=>errors.push(String(e)));
 await p.goto(`${base}/#/workflows`);ok(await seen(p,'[data-wf="code-firstmate"]'),`native workflow page healthy ${width} ${scheme}`);
 await p.goto(`${base}/#/library/skills`);ok(await seen(p,'[data-skills-page]'),`native Skills page healthy ${width} ${scheme}`);
 await p.goto(`${base}/#/doctor`);ok(await seen(p,'[data-item="native"]'),`native Doctor healthy ${width} ${scheme}`);
 for(const lang of ["en","zh"]) {
  await p.evaluate(l=>setLang(l),lang==="zh"?"zh-TW":"en");
  const native=p.locator('[data-item="native"]');await native.evaluate(el=>el.scrollIntoView({block:"center"}));
  ok(await native.getAttribute('data-status')==="ok" && /v1/.test(await native.innerText()),`basic web is ready without v1 ${width} ${scheme} ${lang}`);
  ok(await native.evaluate(el=>{const r=el.getBoundingClientRect(),m=document.querySelector('.main').getBoundingClientRect();return r.top>=m.top&&r.bottom<=m.bottom;}),`basic readiness row fully visible ${width} ${scheme} ${lang}`);
  await p.screenshot({path:join(shots,`basic-${lang}-${width}-${scheme}.png`)});
  const node=p.locator('[data-item="node"]');await node.evaluate(el=>el.scrollIntoView({block:"start"}));
  ok(await p.locator('[data-item="git"]').getAttribute('data-status')==="missing" && await node.getAttribute('data-status')==="missing" && await p.locator('[data-item="python"]').getAttribute('data-status')==="missing",`missing coding/interpreter dependencies surfaced ${width} ${scheme} ${lang}`);
  ok(await p.locator('[data-doc-group="optional"] [data-item="state"]').getAttribute('data-status')==="info",`legacy adapter stays optional ${width} ${scheme} ${lang}`);
  await p.screenshot({path:join(shots,`coding-${lang}-${width}-${scheme}.png`)});
 }
 ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no sideways scroll ${width} ${scheme}`);await p.close();
}
ok(!errors.length,"no native page errors");
}finally{await browser.close();app.kill();}
console.log(`native-standalone-ui: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
