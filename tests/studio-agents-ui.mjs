import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Studio runs on the Crew page and the Inbox, live (unit crew-studio-agents): an agent node that is working
// shows on #/crew beside firstmate's rounds (run, node, role, model, round, elapsed, last activity) with its
// Prompt, Transcript and Report; a Studio card arriving or answered elsewhere updates the Inbox without a
// reload; the Overview counts and lists Studio cards. 1440 light and 390 dark.      node tests/studio-agents-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => { console.error("studio-agents-ui: Playwright not found; set PLAYWRIGHT_MODULE"); process.exit(2); });
const tmp = mkdtempSync(join(tmpdir(), "crew-saui-")); const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN ??= "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  CREW_RENDER_STUB: "1", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`; await waitUp(base, app);
let pass = 0, fail = 0; const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base); const errors = []; const shots = join(root, "tests/out"); mkdirSync(shots, { recursive: true });
const INTENT = ["Add a percent function to money-kit", "STUB_LINGER",
  "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\nimport { percent } from "../src/percent";\\n\\ntest("percent rounds to the cent", () => expect(percent(1999, 15)).toBe(300));\\n'].join("\n");
const post = (p, u, b) => p.evaluate(async ([u, b]) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) }; }, [u, b]);
let runId = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" }); const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  if(process.env.COFFEE_LOCAL_JOBS_UI){
    let outcome='running',cleanup='pending';
    await p.route('**/api/wruns/agents',route=>route.fulfill({json:{agents:[],localJobs:[{id:'R-014/video/6/7',task:'R-014',label:'HyperFrames film',provider:'hyperframes',phase:'render',outcome,cleanup,startedAt:'2026-10-15T14:30:00.000Z',lastProgressAt:'2026-10-15T14:30:01.000Z'}]}}));
    for(const width of [390,1440]){await p.setViewportSize({width,height:900});await p.goto(`${base}/#/crew`);await p.waitForSelector('[data-local-render-job]');ok(await p.locator('[data-local-render-job]').innerText().then(t=>t.includes('render')&&t.includes('pending')&&t.includes('2026-10-15')),`local render source phase/timestamps visible at ${width}`);ok(await p.locator('[data-local-render-job] a').getAttribute('href')==='#/run/R-014','local render links to exact Task');ok(await p.locator('[data-agent-node]').count()===0,'renderer is not fabricated as LLM agent');await p.screenshot({path:join(tmp,`local-render-${width}.png`),fullPage:true});}
    for(const state of [['succeeded','verified'],['failed','unverified'],['cancelled','verified']]){[outcome,cleanup]=state;await p.reload();await p.waitForSelector('[data-local-render-job]');ok(await p.locator('[data-local-render-job]').innerText().then(t=>t.includes(outcome)&&t.includes(cleanup)),`source terminal ${outcome}/${cleanup} visible`);}
    console.log(`CAPTURES ${tmp}`);console.log(`${pass}/${fail}`);await browser.close();app.kill();process.exit(fail?1:0);
  }
  const other = await ctx.newPage(); await other.goto(`${base}/#/runs`);
  // ---------- the Inbox updates live: a card arrives (no reload) ----------
  await p.goto(`${base}/#/inbox`); await p.waitForSelector("#navInbox", { state: "attached" }); await p.waitForTimeout(500); await p.evaluate(() => { window.__noReload = 1; });
  const started = await post(other, "/api/wruns", { text: INTENT, workflow: "code-firstmate" }); runId = started.body?.id;
  await p.waitForSelector('[data-inbox-studio] [data-option="dispatch"]', { timeout: 120000 });
  ok(!!runId && await p.evaluate(() => window.__noReload === 1) && (await p.textContent("#navInbox")).trim() === "1", "a Studio card that arrives shows in the open Inbox live (the page did not reload) and counts in the sidebar", JSON.stringify(started));
  // ---------- the Overview counts and lists it ----------
  await other.goto(`${base}/#/board`); await other.waitForSelector("[data-need-scard]", { timeout: 15000 }).catch(() => {});
  const ov = await other.textContent("#view");
  // the Board (unit board) replaced the old Overview at #/board: Needs you counts the Studio card and lists it
  ok((await other.textContent("#needsCount").catch(() => "")).trim() === "1" && await other.locator("[data-need-scard]").count() === 1, "the Board counts the Studio card under Needs you and lists it", ov.slice(0, 300));
  // ---------- answered elsewhere: it leaves the open Inbox live ----------
  const card = await p.getAttribute("[data-inbox-studio] [data-scard]", "data-scard");
  const ans = await post(other, `/api/scards/${card}/answer`, { choice: "dispatch" });
  await p.waitForFunction(() => !document.querySelector("[data-inbox-studio]") && (document.querySelector("#navInbox")?.textContent ?? "").trim() === "", null, { timeout: 15000 }).catch(() => {});
  ok(ans.status === 200 && await p.evaluate(() => window.__noReload === 1) && !(await p.locator("[data-inbox-studio]").count()), "answered on another page, the card leaves the open Inbox live (no reload)", JSON.stringify(ans.status));
  // ---------- the Crew page shows the working agent ----------
  await p.goto(`${base}/#/crew`); await p.waitForSelector(`[data-agent-node^="${runId}/build/"]`, { timeout: 120000 });
  await p.waitForFunction(() => /fs_list|tool/.test(document.querySelector("[data-agent-node] .rt-agent-act")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {});
  const tile = await p.textContent(`[data-agent-node^="${runId}/build/"]`);
  ok(tile.includes(runId) && /Build round/.test(tile) && /worker/.test(tile) && /round 1/.test(tile) && /up \d+[sm]/.test(tile) && /stub/.test(tile) && /code-firstmate/.test(tile) && /fs_list|tool/.test(tile) && Number((await p.textContent("#navCrew")).trim()) >= 1,
    "the Crew page shows the Studio agent working: run, node, role, model, round, elapsed time, last activity (and the sidebar counts it)", tile);
  await p.screenshot({ path: join(shots, "studio-agents-crew-1440-light.png") });
  const links = await p.$$eval(`[data-agent-node^="${runId}/build/"] [data-agent-link]`, (xs) => xs.map((a) => [a.dataset.agentLink, a.getAttribute("href")]));
  ok(JSON.stringify(links.map((l) => l[0])) === '["prompt","transcript","report"]' && links.every(([k, href]) => href === `#/runs/node/${runId}/build/1/${k}`), "it links the node's Prompt, Transcript and Report", JSON.stringify(links));
  await p.click(`[data-agent-node^="${runId}/build/"] [data-agent-link="transcript"]`); 
  ok(await p.waitForSelector('[data-tab="transcript"][aria-selected="true"]', { timeout: 15000 }).then(() => true, () => false) && p.url().endsWith(`#/runs/node/${runId}/build/1/transcript`), "Transcript opens the node's transcript tab");
  await p.goto(`${base}/#/runs/node/${runId}/build/1/prompt`); await p.waitForSelector('[data-tab="prompt"][aria-selected="true"]', { timeout: 15000 });
  await p.waitForFunction(() => /BUILD ROUND/.test(document.querySelector("#view")?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
  ok(/BUILD ROUND/.test(await p.textContent("#view")), "Prompt opens the prompt the node was given");
  // ---------- 390 dark ----------
  { const c2 = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: "dark" }); const q = await c2.newPage(); q.on("pageerror", (e) => errors.push(e.message));
    await q.goto(`${base}/#/crew`); await q.waitForSelector("[data-agent-node]", { timeout: 15000 }).catch(() => {});
    const sw = await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); await q.screenshot({ path: join(shots, "studio-agents-crew-390-dark.png") });
    ok((await q.locator("[data-agent-node]").count()) >= 1 && sw, "the Crew page with a Studio agent renders at 390 dark with no sideways scroll"); await c2.close(); }
  await post(other, `/api/wruns/${runId}/cancel`, {});
  await p.goto(`${base}/#/crew`); await p.waitForFunction(() => document.querySelector("[data-studio-agents]")?.dataset.studioAgents === "0", null, { timeout: 30000 }).catch(() => {});
  ok(await p.getAttribute("[data-studio-agents]", "data-studio-agents") === "0", "once the run is cancelled the agent leaves the Crew page");
  ok(!errors.length, "no page errors", errors.slice(0, 5).join(" | "));
} catch (e) { ok(false, `exception ${e.message}`, appLog.slice(-1500)); }
await browser.close(); app.kill();
console.log(`\nstudio-agents-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
