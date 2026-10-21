import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { revealEditorControl } from "./lib/reveal-editor-control.mjs";
// Capture the added readiness node and graph routes, all viewport/themes/languages.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
const root = join(import.meta.dirname, ".."), temp = mkdtempSync(join(tmpdir(), "remote-gates-ui-"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env }; for (const key of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_FM_STATE"]) delete env[key];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN = "test-session";
const fixture = spawnSync("bun", ["tests/remote-gates-card-fixture.ts", join(temp, "data")], { cwd: root, env, encoding: "utf8" });
if (fixture.status !== 0) throw new Error(fixture.stderr || fixture.stdout);
const pendingFixture=spawnSync("bun",["tests/remote-gates-pending-naming.ts",join(temp,"data")],{cwd:root,env,encoding:"utf8"});if(pendingFixture.status!==0)throw new Error(pendingFixture.stderr||pendingFixture.stdout);
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: join(temp, "home"), CREW_DATA: join(temp, "data"), CREW_MAIN_PROJECT: join(temp, "project"), CREW_PORT: String(port), CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_KEYCHAIN_TOOL: "none", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1" } });
let logs = ""; app.stdout.on("data", d => logs += d); app.stderr.on("data", d => logs += d);
let browser, passed = 0, failed = 0;
const ok = (v, label) => { console.log(`${v ? "PASS" : "FAIL"} ${label}`); v ? passed++ : failed++; };
// Capture actual viewport pixels after native scrolling; locator screenshots can
// silently crop a tall card and do not establish what a phone user can see.
async function frame(p,target,name){
  await target.evaluate(el=>el.scrollIntoView({block:"center",inline:"nearest"}));await p.waitForTimeout(50);
  const geometry=await target.evaluate(el=>{const r=el.getBoundingClientRect(),f=document.querySelector('.fab'),b=f?.getBoundingClientRect();const visible=(r.width>0||r.height>0)&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;const overlap=b&&getComputedStyle(f).display!=="none"&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top;return{visible,clear:!overlap,x:r.x,y:r.y,width:r.width,height:r.height};});
  ok(geometry.visible&&geometry.clear,`${name} material target fully inside viewport and clear of launcher ${JSON.stringify(geometry)}`);
  await p.screenshot({path:join(shots,`${name}.png`)});
}
const shots = join(root, "tests/out/remote-gates"); mkdirSync(shots, { recursive: true });
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base);
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) for (const language of ["en", "zh-TW"]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
    const p = await context.newPage(); let errors = [];
    p.on("pageerror", e => errors.push(e.message));
    await p.addInitScript(({ language }) => { localStorage.setItem("crew.lang", language); localStorage.setItem("crew.chatOpen", "0"); localStorage.setItem("crew.graphView", "detail"); }, { language });
    await p.goto(base + "/#/workflows/code-firstmate");
    await p.waitForSelector('svg.rt-graph');
    await p.evaluate(() => document.body.classList.add("chat-closed"));
    await revealEditorControl(p, "[data-fit]"); await p.click("[data-fit]");
    const buildStage = p.locator('[data-stage-node="build"]');
    if (await buildStage.count()) { await buildStage.focus(); await buildStage.press("Enter"); }
    await p.waitForSelector('svg.rt-graph [data-node="remote-ready"]');
    await p.evaluate(() => document.body.classList.add("chat-closed"));
    await revealEditorControl(p, "[data-fit]"); await p.click("[data-fit]"); await p.waitForTimeout(150);
    const geometry = await p.locator('[data-node="remote-ready"]').evaluate(el => { const r = el.getBoundingClientRect(), svg = el.closest("svg").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, visible: r.width > 0 && r.height > 0 && r.x >= svg.x - 1 && r.y >= svg.y - 1 && r.right <= svg.right + 1 && r.bottom <= svg.bottom + 1 }; });
    ok(geometry.visible, `${width}/${theme}/${language} readiness node fits graph viewport`);
    const labels = await p.locator('[data-node="remote-ready"]').textContent();
    ok(/Remote readiness/.test(labels), `${width}/${theme}/${language} readiness node has visible label`);
    ok(errors.length === 0, `${width}/${theme}/${language} no browser errors`);
    await p.screenshot({ path: join(shots, `code-firstmate-${width}-${theme}-${language}.png`), fullPage: true });
    const node = p.locator('[data-node="remote-ready"]'); await node.focus(); await node.press("Enter");
    await p.locator('.rt-panel h3').waitFor(); await p.locator('.rt-panel').scrollIntoViewIfNeeded();
    ok(await p.locator('.rt-panel [data-field="do"]').inputValue() === "remote.ready", `${width}/${theme}/${language} readiness action is reachable through node selection`);
    await p.screenshot({ path: join(shots, `readiness-selection-${width}-${theme}-${language}.png`), fullPage: true }); await p.goto(base + "/#/workflows/code-firstmate");await revealEditorControl(p, '[data-view-toggle="simple"]'); await p.locator('[data-view-toggle="simple"]').click();await p.waitForSelector('svg.rt-graph[data-view="simple"]');await revealEditorControl(p, '[data-fit]'); await p.click('[data-fit]');await p.waitForTimeout(100);
    const simpleFont=await p.evaluate(()=>{const svg=document.querySelector('svg.rt-graph'),k=svg.getScreenCTM().a;return Math.min(...[...svg.querySelectorAll('[data-node] .rt-label')].map(t=>parseFloat(getComputedStyle(t).fontSize)*k));});
    ok(simpleFont>=11,`${width}/${theme}/${language} Simple Fit titles remain at least11px`);await p.screenshot({path:join(shots,`readable-simple-fit-${width}-${theme}-${language}.png`),fullPage:true});
    if(width===390){
      for(const id of ["gates","merge","after"]){const target=p.locator(`svg [data-stage-node="${id}"]`);ok(await target.count()===1,`${width}/${theme}/${language} default lower ${id} stage exists`);if(await target.count())await frame(p,target,`simple-default-group-${id}-${width}-${theme}-${language}`);}
      for(const route of ["remote-ready→merge-card[ok]","merge-card→merge[merge]","merge→after-merge"]){const target=p.locator(`svg [data-edge="${route}"] path`).first();ok(await target.count()===1,`${width}/${theme}/${language} default lower ${route} route exists`);if(await target.count())await frame(p,target,`simple-default-arrow-${route.replaceAll(/[^a-z]/g,"-")}-${width}-${theme}-${language}`);}
      for(const id of ["gates","merge","after"]){const stage=p.locator(`svg [data-stage-node="${id}"]`);await stage.focus();await stage.press("Enter");}
      await revealEditorControl(p, '[data-fit]'); await p.click('[data-fit]');await p.waitForTimeout(100);
      for(const id of ["remote-ready","merge-card","merge","after-merge","cleanup","done"]){const target=p.locator(`svg [data-node="${id}"]`);ok(await target.count()===1,`${width}/${theme}/${language} lower Simple ${id} exists`);if(await target.count())await frame(p,target,`simple-lower-${id}-${width}-${theme}-${language}`);}
      for(const id of ["gates","merge","after"]){const target=p.locator(`svg [data-stage-toggle="${id}"],svg [data-stage-node="${id}"]`).first();ok(await target.count()===1,`${width}/${theme}/${language} lower Simple ${id} grouping exists`);if(await target.count())await frame(p,target,`simple-group-${id}-${width}-${theme}-${language}`);}
      for(const route of ["remote-ready→merge-card[ok]","merge-card→merge[merge]","merge→after-merge","after-merge→cleanup","cleanup→done"]){const edge=p.locator(`svg [data-edge="${route}"] path`).first();ok(await edge.count()===1,`${width}/${theme}/${language} lower Simple ${route} arrow exists`);if(await edge.count())await frame(p,edge,`simple-arrow-${route.replaceAll(/[^a-z]/g,"-")}-${width}-${theme}-${language}`);}
      ok((await p.evaluate(()=>{const svg=document.querySelector('svg.rt-graph'),k=svg.getScreenCTM().a;return Math.min(...[...svg.querySelectorAll('[data-node] .rt-label')].map(t=>parseFloat(getComputedStyle(t).fontSize)*k));}))>=11,`${width}/${theme}/${language} lower scrolling preserves11px title threshold`);
    }
    await p.goto(base + "/#/inbox/SC-990");
    const card = p.locator('[data-inbox-studio] [data-scard="SC-990"]'); await card.waitFor();
    if (language === "zh-TW") { const toggle = card.locator('[data-card-lang="zh-TW"]'); if (await toggle.count()) await toggle.click(); }
    const approve = card.locator('[data-option="approve-name"]'); await approve.scrollIntoViewIfNeeded();
    ok(await approve.isVisible() && await card.locator('[data-option="close"]').isVisible(), `${width}/${theme}/${language} naming decision actions visible and reachable`);
    ok(/fixture\/project/.test(await card.textContent()) && /outside-prefix\/task/.test(await card.textContent()), `${width}/${theme}/${language} exact naming target visible`);
    await card.screenshot({ path: join(shots, `naming-card-${width}-${theme}-${language}.png`) });
    await p.goto(base + "/#/inbox/SC-991");
    const mergeCard = p.locator('[data-inbox-studio] [data-scard="SC-991"]');await mergeCard.waitFor();
    if(language === "zh-TW")await mergeCard.locator('[data-card-lang="zh-TW"]').click();
    const identity=mergeCard.locator('[data-sec="remote-target"]');ok(await identity.count()===1,`${width}/${theme}/${language} actual remote identity exists at top`);
    if(await identity.count()){
      const stored=await (await p.request.get(base+'/api/scards/SC-991')).json();
      for(const [key,value] of Object.entries({repository:`${stored.detail.remoteTarget.repository} #${stored.detail.remoteTarget.pr}`,branch:stored.detail.remoteTarget.branch,head:stored.detail.remoteTarget.head,base:stored.detail.remoteTarget.base,"base-head":stored.detail.remoteTarget.baseHead,method:stored.detail.remoteTarget.method,grant:stored.detail.remoteTarget.grant}))ok(await identity.locator(`[data-remote-target="${key}"]`).textContent()===value,`${width}/${theme}/${language} identity ${key} equals actual stored target`);
      ok((await mergeCard.locator('.cc-sec').first().getAttribute('data-sec'))==='remote-target',`${width}/${theme}/${language} target precedes upper intent`);
      await frame(p,mergeCard.locator('.cc-h'),`remote-merge-top-${width}-${theme}-${language}`);await frame(p,identity,`remote-merge-identity-${width}-${theme}-${language}`);
    }
    for(const section of ["intent","why","scope","done","before-after","how","walk","door","review","gates","cost"]){const target=mergeCard.locator(`[data-sec="${section}"]`);ok(await target.count()===1,`${width}/${theme}/${language} ${section} section exists`);if(await target.count()){if(section==="walk"){for(const summary of await target.locator("details summary").all())await summary.click();ok(await target.locator(".cc-diff > div").count()>0,`${width}/${theme}/${language} actual Git diff walk is expanded`);}await frame(p,target,`remote-merge-section-${section}-${width}-${theme}-${language}`);}}
    const raw=mergeCard.locator('details:has(.rt-card-body)');await raw.locator('summary').click();await frame(p,raw,`remote-merge-card-text-${width}-${theme}-${language}`);
    ok(await mergeCard.locator("[data-done]").count()>0&&await mergeCard.locator("[data-walk]").count()>0,`${width}/${theme}/${language} real done line and Git diff walk are nonempty`);
    const mergeAction=mergeCard.locator('[data-option="merge"]');await mergeAction.scrollIntoViewIfNeeded();
    ok(await mergeAction.isVisible()&&await mergeCard.locator('[data-option="changes"]').isVisible()&&await mergeCard.locator('[data-option="close"]').isVisible(), `${width}/${theme}/${language} remote merge actions visible and reachable`);
    ok(await mergeCard.locator('[data-sec="gates"]').count()===1, `${width}/${theme}/${language} remote merge retains intent detail and gate evidence`);
    await frame(p,mergeCard.locator(".cc-actions.actions"),`remote-merge-bottom-actions-${width}-${theme}-${language}`);
    await mergeCard.screenshot({path:join(shots,`remote-merge-card-${width}-${theme}-${language}.png`)});
    await p.goto(base + "/#/inbox/SC-992");const rebaseCard=p.locator('[data-inbox-studio] [data-scard="SC-992"]');await rebaseCard.waitFor();if(language==="zh-TW")await rebaseCard.locator('[data-card-lang="zh-TW"]').click();const rebaseAction=rebaseCard.locator('[data-option="rebase"]');await rebaseAction.scrollIntoViewIfNeeded();ok(await rebaseAction.isVisible()&&await rebaseCard.locator('[data-option="close"]').isVisible(), `${width}/${theme}/${language} native rebase captain actions visible`);ok(language!=="zh-TW"||/工作輪次/.test(await rebaseAction.textContent()), `${width}/${theme}/${language} native rebase action localizes`);await rebaseCard.screenshot({path:join(shots,`native-rebase-card-${width}-${theme}-${language}.png`)});
    await p.goto(base+"/#/inbox/SC-993");const pendingCard=p.locator('[data-inbox-studio] [data-scard="SC-993"]');await pendingCard.waitFor();if(language==="zh-TW")await pendingCard.locator('[data-card-lang="zh-TW"]').click();const pendingApprove=pendingCard.locator('[data-option="approve-name"]');await pendingApprove.scrollIntoViewIfNeeded();ok(await pendingApprove.isVisible()&&await pendingCard.locator('[data-option="close"]').isVisible(),`${width}/${theme}/${language} updated-head naming actions reachable`);ok(/→/.test(await pendingCard.textContent()),`${width}/${theme}/${language} update naming shows original and new head`);await pendingCard.screenshot({path:join(shots,`updated-head-naming-${width}-${theme}-${language}.png`)});
    await context.close();
  }
} catch (e) { console.error(e.message); failed++; }
finally { await browser?.close(); app.kill("SIGTERM"); await new Promise(resolve => { if (app.exitCode !== null) resolve(); else app.once("exit", resolve); }); rmSync(temp, { recursive: true, force: true }); }
console.log(`${passed} passed / ${failed} failed`); process.exitCode = failed ? 1 : 0;
