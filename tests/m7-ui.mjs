// M7 in the browser: the Packs page (built-in pack, workflow genesis from a
// description, the draft with its gates, evals and files, install), and the
// file-organization pack (dry run, untick a move, apply, undo). 1440 and 390,
// light and dark: no console error, no sideways scroll, nothing leaves the machine.   node tests/m7-ui.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("m7-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const tmp = mkdtempSync(join(tmpdir(), "crew-m7ui-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data"), home = join(tmp, "home");
mkdirSync(join(state, "pending"), { recursive: true }); writeFileSync(join(state, "events.jsonl"), ""); mkdirSync(data); mkdirSync(home);
const dl = join(home, "Downloads"); mkdirSync(dl);
for (const f of ["holiday.jpg", "invoice-0042.pdf", "slides.pptx", "archive.zip", "voice-memo.m4a", "clip.mov", "script.py", "readme.txt"]) writeFileSync(join(dl, f), f);
// A pre-existing historical draft keeps its legacy review/install UI readable.
const historical='historical-ui';const draftDir=join(data,'packs/drafts',historical);const historicalFiles={'manifest.yaml':JSON.stringify({id:historical,name:'Historical UI review',version:'0.1.0',description:'Pre-existing legacy record',skills:[{role:'maker',file:'skills/maker.md'}],gates:[],artifactTypes:[],workflows:['workflows/review.yaml'],evals:['evals/maker.json'],permissions:[]}),'skills/maker.md':'# Maker\n- Ask when unclear','workflows/review.yaml':JSON.stringify({id:historical,name:'Historical review',version:1,nodes:[{id:'ask',kind:'human',label:'Ask',x:0,y:0},{id:'done',kind:'done',label:'Done',x:200,y:0}],edges:[['ask','done']],roles:[{id:'maker',label:'Maker',skill:`pack:${historical}/skills/maker.md`}]}),'evals/maker.json':JSON.stringify([{id:'historical-case',role:'maker',title:'Existing replay',ask:'What when unclear?',terms:['ask'],expect:[{pattern:'ask',why:'asks'}]}])};for(const[file,text]of Object.entries(historicalFiles)){mkdirSync(dirname(join(draftDir,file)),{recursive:true});writeFileSync(join(draftDir,file),text);}writeFileSync(join(data,'packs/drafts',historical+'.json'),JSON.stringify({id:historical,description:'Pre-existing legacy record',status:'drafted',createdAt:'2026-10-13T00:00:00Z',job:null,summary:'Historical replay record',validation:{ok:true,errors:[],warnings:[]},evals:{total:1,passed:1},error:null,by:'captain'}));
const port = await freePort();
const env = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: home, CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [], offbox = [];
const page = async (width, scheme) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.labs", "1"); } catch {} }); // these pages are labs (backbone sidebar)
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offbox.push(r.request().url()); r.abort(); });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(404|net::ERR_FAILED)/.test(m.text())) errors.push(`${width}/${scheme}: ${m.text()}`); });
  return p;
};
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = join(root, "tests/out");
let draftId = null, planId = null;
try {
  {
    const p = await page(1440, "light");
    await p.goto(`${base}/#/packs`);
    ok(await p.locator('[data-pack="file-organization"]').waitFor({ timeout: 8000 }).then(() => true, () => false), "the Packs page lists the built-in file-organization pack");
    await p.locator("#genesisAsk").fill("Every Friday, sort the open support mail, answer the easy ones and escalate the rest to a person");
    await p.locator(".x-ask .btn.primary").click();
    // a same-document hash change (no load event): wait on the hash itself, with room for a loaded machine (the stub drafts the pack first)
    await p.waitForFunction(() => location.hash.startsWith("#/tasks/"), null, { timeout: 30000 });
    const nativeTask=decodeURIComponent(p.url().split("#/tasks/")[1]);await p.goto(`${base}/#/pack-genesis/${nativeTask}`);await p.locator('[data-interview]').first().waitFor({timeout:30000});ok(await p.locator('[data-interview]').count()===6,"new genesis from Packs opens the actual native batch interview without a detached legacy draft");
    draftId=historical;await p.goto(`${base}/#/pack-draft/${draftId}`);
    await p.locator(".badge", { hasText: "Ready to install" }).first().waitFor({ timeout: 10000 });
    ok(await p.locator(".x-gates .x-gk.ok").count() === 2 && await p.locator("details code", { hasText: "manifest.yaml" }).count() === 1, "genesis: the draft passes its two gates (format, evals) and shows its files");
    await p.locator(".btn.primary", { hasText: "Install" }).click();
    await p.locator(".modal .btn.primary").click();
    ok(await p.locator(".badge", { hasText: "Installed" }).first().waitFor({ timeout: 5000 }).then(() => true, () => false), "Install from the draft page");
    await p.goto(`${base}/#/fileorg`);
    await p.locator("#foRoot").fill(dl);
    await p.locator("#view form .btn.primary").click();
    await p.waitForFunction((re) => new RegExp(re).test(location.hash), "#\\/fileorg\\/P-", { timeout: 90000 }); // a hash change has no load event
    planId = p.url().split("#/fileorg/")[1];
    await p.locator("[data-move]").first().waitFor();
    ok(await p.locator("[data-move]").count() === 8 && existsSync(join(dl, "holiday.jpg")), "dry run: eight planned moves, nothing moved");
    await p.locator("[data-move] input").first().uncheck();
    await p.waitForTimeout(400);
    ok(await p.locator(".x-mv.off").count() === 1, "untick a move in review");
    await p.locator(".btn.primary", { hasText: "Apply" }).click();
    await p.locator(".modal .btn.primary").click();
    await p.locator(".badge", { hasText: "Applied" }).first().waitFor({ timeout: 5000 });
    ok(existsSync(join(dl, "Images", "holiday.jpg")) || existsSync(join(dl, "holiday.jpg")), "apply moves the files");
    await p.screenshot({ path: join(shots, "m7-plan-applied-1440-light.png"), fullPage: true });
    await p.locator(".btn", { hasText: "Undo" }).click();
    await p.locator(".modal .btn.primary").click();
    await p.locator(".badge", { hasText: "Undone" }).first().waitFor({ timeout: 5000 });
    ok(existsSync(join(dl, "holiday.jpg")) && existsSync(join(dl, "invoice-0042.pdf")) && !existsSync(join(dl, "Documents")), "undo puts every file back");
    await p.close();
  }
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const p = await page(width, scheme);
    for (const [name, hash] of [["packs", "#/packs"], ["draft", `#/pack-draft/${draftId}`], ["pack", "#/pack/file-organization"], ["fileorg", "#/fileorg"], ["plan", `#/fileorg/${planId}`]]) {
      await p.goto(`${base}/${hash}`);
      await p.waitForTimeout(600);
      ok(await noHScroll(p), `${name} ${width} ${scheme}: no sideways scroll`);
      await p.screenshot({ path: join(shots, `m7-${name}-${width}-${scheme}.png`), fullPage: true });
    }
    await p.close();
  }
  ok(errors.length === 0, "no console errors", errors.join("\n"));
  ok(offbox.length === 0, "no request leaves this machine", offbox.join(", "));
} catch (e) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}\n${appLog.slice(-1500)}`); }
finally { await browser.close(); app.kill(); }
console.log(`\nm7-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
