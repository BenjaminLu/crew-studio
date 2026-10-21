import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Script skills on the Crew page (#/team; docs/units/skill-packages.md §9) in a real isolated Studio and Chromium, en at 1440
// and 繁體中文 at 390: each script skill chip carries its readiness (ready, not ready with the missing program, not approved,
// text only), its full line in the title; adding an undecided script skill shows its scripts and hosts and asks once
// (Approve with scripts / Text only / Don't add) before anything is saved. No accounts, no model calls, no network.
//      bun tests/skill-readiness-ui.mjs
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { CrewStore } = await import("../src/domain/crew.ts");
const { Skills } = await import("../src/skills.ts");
const { SkillApprovals } = await import("../src/skillpkg/approvals.ts");
const root = join(import.meta.dir, ".."), dir = mkdtempSync(join(tmpdir(), "skill-ready-ui-")), data = join(dir, "data"), home = join(dir, "home"), token = "skill-ready-fixture";
mkdirSync(home); mkdirSync(data); const bin = join(dir, "bin"); mkdirSync(bin);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const mk = (d, files) => { for (const [f, t] of Object.entries(files)) { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), t); } return d; };
const md = (name, extra = "") => `---\nname: ${name}\ndescription: ${name} fixture\n${extra}---\n\nUse the scripts.\n`;
// the library: four script skills (no lockfile, so nothing to install): ready, a program missing, not decided, and one to add
const lib = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => null });
const imp = (name, extra = "") => lib.importFolder(mk(join(dir, "src", name), { "SKILL.md": md(name, extra), "scripts/run.sh": "#!/bin/sh\necho hi\n" }), "captain").version;
const vOk = imp("ok-skill"), vMiss = imp("miss-skill", "metadata:\n  requires:\n    bins: [no-such-program-xyz]\n"), vNew = imp("new-skill"), vAdd = imp("add-skill"), vApprove = imp("approve-skill");
const pin = (id, v) => ({ id, v: 1, sha256: v.sha256, filesSha256: v.filesSha256 });
const ap = new SkillApprovals(data);
for (const [id, v] of [["ok-skill", vOk], ["miss-skill", vMiss]]) ap.record(id, { v: 1, sha256: v.sha256, filesSha256: v.filesSha256, scripts: "approved", hosts: [], by: "captain", via: "test" });
const m = (provider, model, effort, skills = []) => ({ provider, model, effort, skills });
new CrewStore(data).write({ schema: 1, members: { coordinator: m("codex", "gpt-6.1-sol", "medium"), maker: m("codex", "gpt-6.1-sol", "medium", [pin("ok-skill", vOk), pin("miss-skill", vMiss), pin("new-skill", vNew), pin("approve-skill", vApprove)]),
  "alt-maker": m("codex", "gpt-6.1-sol", "medium"), reviewer: m("codex", "gpt-6.1-sol", "high"), "design-reviewer": m("codex", "gpt-6.1-sol", "medium") }, seats: {}, workflows: {} }, null, { by: "captain", via: "page" });
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, CREW_DATA: data, CREW_PORT: String(port), CREW_SESSION_TOKEN: token, CREW_GH: "0", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_HOST_CODEX_BIN: "/nonexistent/codex", CREW_CODEX_BIN: "/nonexistent/codex", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_RETRO_AUTO: "0", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1" };
delete env.CREW_MAIN_PROJECT; delete env.CREW_FM_STATE;
const app = spawn("bun", ["src/server.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] }); let log = ""; app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d)); let browser;
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base, token);
  // Studio prepares the approved versions by itself at start: wait until the page's view says so
  const api = async () => (await fetch(`${base}/api/team`, { headers: { cookie: `crew_session=${token}` } })).json();
  for (let i = 0; i < 100; i++) { const v = await api(); if (v.skillStatus?.["ok-skill@v1"]?.state === "ready" && v.skillStatus?.["miss-skill@v1"]?.state === "not-ready") break; await new Promise((r) => setTimeout(r, 100)); }
  for (const [lang, width, height] of [["en", 1440, 940], ["zh-TW", 390, 844]]) {
    const tag = `${lang} ${width}`, zh = lang !== "en";
    const p = await browser.newPage({ viewport: { width, height } }); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${base}/#/team`); await p.evaluate((l) => setLang(l), lang);
    await p.locator("[data-team-page]").waitFor();await p.locator('[data-crew-section="workflows"]').click();await p.locator("[data-crew-workflow-picker]").selectOption("web-prototype");await p.locator('[data-crew-node="design-a"]').click();await p.locator('[data-crew-fold="node-skills:web-prototype:design-a"] > summary').click();
    const row = p.locator('[data-team-row="design-a"]'); await row.waitFor();
    const mark = (name) => row.locator(".tm-skill", { hasText: name }).locator("[data-skill-ready]");
    const st = async (name) => ({ state: await mark(name).getAttribute("data-skill-ready"), title: await mark(name).getAttribute("title") });
    const a = await st("ok-skill"), b = await st("miss-skill"), c = await st("new-skill");
    ok(a.state === "ready" && (zh ? /含 1 個 script · 可以用/ : /1 script · ready/).test(a.title ?? ""), `a prepared, approved script skill shows ready ${tag}`, JSON.stringify(a));
    ok(b.state === "not-ready" && (zh ? /還不能用：缺 no-such-program-xyz/ : /not ready: no-such-program-xyz missing/).test(b.title ?? ""), `a script skill missing a program shows not ready, naming the program ${tag}`, JSON.stringify(b));
    // decided on the en pass: the change that added add-skill listed the undecided script skills the team would load
    ok(zh ? c.state === "ready" && /可以用/.test(c.title ?? "") : c.state === "needs-approval" && /not approved/.test(c.title ?? ""), `an undecided script skill shows not approved (en), and after explicit upgrade, ready (zh-TW) ${tag}`, JSON.stringify(c));
    ok((await mark("ok-skill").innerText()) === (zh ? "可以用" : "Ready") && (await mark("miss-skill").innerText()) === (zh ? "缺少執行條件" : "Missing prerequisite") && await mark("new-skill").evaluate(e=>e.tagName)==="BUTTON", `readiness is visible localized text on a keyboard-accessible button ${tag}`);
    await mark("miss-skill").focus(); await p.keyboard.press("Enter");
    let status=p.locator('[data-skill-status]');await status.waitFor();await p.waitForFunction(()=>document.querySelector('[data-status-label],[data-status-error]'));
    ok((await status.innerText()).includes('no-such-program-xyz') && await status.locator('[data-status-action="retry"]').count()===1 && await status.locator('[data-status-action="scripts"]').count()===0 && (await status.locator('[data-status-guidance]').innerText()).includes(zh?'可信':'trusted'), `missing prerequisite gives the actual reason, remediation and retry, without asking approval again ${tag}`);
    await status.locator('[data-status-action="retry"]').click();
    await p.waitForFunction(()=>document.querySelector('[data-status-action="retry"]')?.disabled===false);
    ok(await status.locator('[data-status-label]').getAttribute('data-status-label')==='not-ready', `retry does not invent success while the program is still missing ${tag}`);
    await status.locator('[data-status-close]').click();
    await p.waitForFunction(()=>document.activeElement?.dataset.skillStatusOpen==='miss-skill@v1');
    ok(await mark('miss-skill').evaluate(e=>document.activeElement===e), `closing status returns keyboard focus to the original skill ${tag}`);
    if (lang === "en") {
      await mark('new-skill').click();status=p.locator('[data-skill-status]');await status.locator('[data-status-action="text-only"]').waitFor();
      ok((await status.innerText()).includes('scripts/run.sh')&&(await status.innerText()).includes('Allowed network destinations: none')&&await status.locator('[data-status-action="text-only"]').count()===1, `an assigned pending skill exposes exact scripts, hosts and both real choices ${tag}`);
      await status.locator('[data-status-cancel]').click();
      ok((await api()).skillStatus['new-skill@v1'].state==='needs-approval', `cancel keeps the assigned skill pending and records no decision ${tag}`);
      await mark('new-skill').click();await status.waitFor();
      const file=join(lib.libVersion('new-skill',1).dir,'files','scripts/run.sh'), original=readFileSync(file,'utf8');writeFileSync(file,original+'# changed after inspection\n');
      await status.locator('[data-status-action="scripts"]').click();await status.locator('[data-status-error]').waitFor();
      ok((await api()).skillStatus['new-skill@v1'].state==='needs-approval', `changed source bytes refuse approval in the actual UI ${tag}`);
      writeFileSync(file,original);await status.locator('[data-status-refresh]').click();await status.locator('[data-status-action="text-only"]').waitFor();
      await status.locator('[data-status-action="text-only"]').click();await p.waitForFunction(()=>document.querySelector('[data-status-label]')?.dataset.statusLabel==='text-only');
      await status.locator('[data-status-close]').click();
      ok((await st('new-skill')).state==='text-only', `text-only approval directly updates the assigned skill without re-adding it ${tag}`);
      await mark('new-skill').click();await status.locator('[data-status-review-upgrade]').waitFor();
      ok(await status.locator('[data-status-action="enable-scripts"]').count()===0, `text-only does not expose a one-click permission upgrade ${tag}`);
      await status.locator('[data-status-review-upgrade]').focus();await p.keyboard.press('Enter');await status.locator('[data-status-upgrade-review]').waitFor();
      ok((await status.innerText()).includes('scripts/run.sh')&&(await status.innerText()).includes('Allowed network destinations: none'), `upgrade freshly shows exact source files, hosts and Studio-wide version scope ${tag}`);
      await status.locator('[data-status-upgrade-cancel]').click();
      ok((await api()).skillStatus['new-skill@v1'].state==='text-only', `cancel upgrade retains text-only without a new approval ${tag}`);
      await mark('new-skill').click();await status.locator('[data-status-review-upgrade]').click();await status.locator('[data-status-upgrade-review]').waitFor();
      ap.record('new-skill',{v:1,sha256:vNew.sha256,filesSha256:vNew.filesSha256,scripts:'text-only',hosts:[],by:'captain',via:'concurrent-test'});
      await status.locator('[data-status-action="enable-scripts"]').click();await status.locator('[data-status-error]').waitFor();
      ok((await api()).skillStatus['new-skill@v1'].state==='text-only', `an intervening signed decision refuses a stale upgrade screen ${tag}`);
      await status.locator('[data-status-close]').click();await mark('new-skill').click();await status.locator('[data-status-review-upgrade]').click();await status.locator('[data-status-upgrade-review]').waitFor();
      await status.locator('[data-status-action="enable-scripts"]').click();await p.waitForFunction(()=>!document.querySelector('[data-status-action="enable-scripts"]'));
      for(let i=0;i<30&&(await status.locator('[data-status-label]').getAttribute('data-status-label'))!=='ready';i++){await status.locator('[data-status-refresh]').click();await p.waitForTimeout(100);}
      ok((await status.locator('[data-status-label]').getAttribute('data-status-label'))==='ready'&&ap.all('new-skill').some(x=>x.scripts==='text-only')&&ap.all('new-skill').at(-1)?.via==='page-script-upgrade', `explicit upgrade reaches actual ready while retaining signed text-only history ${tag}`);
      await status.locator('[data-status-close]').click();
      await mark('approve-skill').click();await status.waitFor();await status.locator('[data-status-action="scripts"]').click();
      await p.waitForFunction(()=>!document.querySelector('[data-status-action="scripts"]'));await status.locator('[data-status-refresh]').click();
      for(let i=0;i<30&&(await status.locator('[data-status-label]').getAttribute('data-status-label'))!=='ready';i++){await status.locator('[data-status-refresh]').click();await p.waitForTimeout(100);}
      ok((await status.locator('[data-status-label]').getAttribute('data-status-label'))==='ready', `direct script approval prepares the exact assigned version ${tag}`);
      await status.locator('[data-status-close]').click();
      // adding an undecided script skill to a node: the page shows its scripts and hosts and asks before saving
      await row.locator(".tm-add").selectOption("add-skill");
      const panel = p.locator("[data-skill-decide]"); await panel.waitFor();
      ok((await panel.locator("[data-decide-skill]").evaluateAll((e) => e.map((x) => x.dataset.decideSkill))).join(",") === "add-skill@v1" && (await panel.innerText()).includes("scripts/run.sh") && (await panel.innerText()).includes("Network when it runs: none") && await p.locator('[data-decide="scripts"]').count() === 1 && await p.locator('[data-decide="text-only"]').count() === 1,
        `the page asks once before saving: the undecided script skills the team would load, its scripts, its network, approve with scripts or text only ${tag}`, await panel.innerText());
      const before = (await api()).team.hash;
      ok(before === (await api()).team.hash && !(await api()).workflows.find((w) => w.id === "web-prototype").nodes.find((n) => n.node === "design-a").skills.some((s) => s.id === "add-skill"), `nothing is saved until the captain answers ${tag}`);
      await p.locator('[data-decide="text-only"]').click();
      await p.waitForFunction(() => !document.querySelector("[data-skill-decide]"));
      await row.locator(".tm-skill", { hasText: "add-skill" }).waitFor();
      ok((await st("add-skill")).state === "text-only", `answered "Text only": the change is saved and the chip says text only ${tag}`, JSON.stringify(await st("add-skill")));
    }
    // the skill viewer, opened from the chip, says the same
    await row.locator(".tm-skill", { hasText: "miss-skill" }).locator("[data-skill-view]").first().click();
    const sv = p.locator("[data-skv-scripts]"); await sv.waitFor();
    ok(await sv.getAttribute("data-skv-scripts") === "not-ready" && (zh ? /還不能用：缺 no-such-program-xyz/ : /not ready: no-such-program-xyz missing/).test(await sv.innerText()), `the skill viewer shows the version's scripts and readiness ${tag}`, await sv.innerText());
    await p.keyboard.press("Escape");
    if(zh){
      await mark('miss-skill').click();status=p.locator('[data-skill-status]');await status.waitFor();
      const recovered=join(bin,'no-such-program-xyz');writeFileSync(recovered,'#!/bin/sh\necho fixture\n');chmodSync(recovered,0o755);
      await status.locator('[data-status-action="retry"]').click();await p.waitForFunction(()=>document.querySelector('[data-status-label]')?.dataset.statusLabel==='ready');
      ok((await st('miss-skill')).state==='ready'&&(await api()).skillStatus['miss-skill@v1'].state==='ready', `installing the actual fixture program then retrying changes both UI and backend from not-ready to ready ${tag}`);
      await status.locator('[data-status-close]').click();
    }
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no horizontal scroll ${tag}`);
    ok(!errors.length, `no browser errors ${tag}`, errors.join(" | "));
    await p.close();
  }
} catch (e) { fail++; console.log(`  FAIL  ${e?.stack ?? e}\n${log.slice(-1500)}`); }
finally { await browser?.close(); if (app.exitCode === null) { const stopped = new Promise((r) => app.once("exit", r)); app.kill("SIGTERM"); await stopped; } rmSync(dir, { recursive: true, force: true }); }
console.log(`\nskill-readiness-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
