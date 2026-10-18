import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Board as a task overview (docs/units/board.md, "Round 6: task overview"): one row per Task, ordered
// Waiting for you, Stuck, Running, Done today, with filter tabs; a milestone track per row; Now names who works
// (seat and model) or which card waits, with a deep link to it in the Inbox; an overlap badge; a detail panel with
// only the selected Task's visited path. No card body and no workflow graph on the Board.
// At 1440 with the Firstmate panel open, 1440 with it closed, and 390 (a phone, zh-TW).
// Studio runs and cards come from tests/fixture/board; firstmate's tasks and cards from a temp copy of tests/fixture/state.
//   node tests/board-overview-ui.mjs        (BOARD_SHOTS=<dir> puts the screenshots there; default tests/out/board-overview)
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { boardFixture, routeBoardFixture } from "./fixture/board/studio.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("board-overview-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-board-overview-"));
const state = join(tmp, "fm", "state");
mkdirSync(join(tmp, "fm"), { recursive: true }); cpSync(join(here, "fixture/state"), state, { recursive: true });
const now = Date.now() / 1000;
for (const r of readdirSync(join(state, "runs"))) utimesSync(join(state, "runs", r), now, now);
mkdirSync(join(tmp, "data"));

const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "0", CREW_DATA: join(tmp, "data"),
  CREW_RECENT_DAYS: "3650", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude",
  CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = process.env.BOARD_SHOTS || join(root, "tests/out/board-overview"); mkdirSync(shots, { recursive: true });
const summary = await fetch(`${base}/api/summary`).then((r) => r.json());
const fmShown = summary.tasks.filter((t) => t.status !== "idle" && t.status !== "done");
const fmGroup = (t) => (t.status === "needs-you" ? "you" : t.status === "failed" ? "stuck" : "run");
const PIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return d.getTime(); })();
async function open(width, { chat = false, lang = "en" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 } });
  await ctx.clock.setFixedTime(PIN); await ctx.addInitScript((t) => { window.crewClock = () => t; }, PIN);
  // a captain past onboarding: the first-project guide hidden, as Hide guide leaves it (as workflow-overview-ui does)
  await ctx.addInitScript(([l, chat]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} if (!chat) addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [lang, chat]);
  await ctx.addInitScript(() => { const ES = window.EventSource; window.EventSource = class extends ES { constructor(...a) { super(...a); window.__es = this; } }; });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const fx = boardFixture(PIN); await routeBoardFixture(ctx, fx);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e}`));
  await p.goto(`${base}/#/board`); await p.waitForSelector('[data-task="R-101"] .tb-track i', { timeout: 10000 });
  await p.waitForFunction(() => document.querySelectorAll("[data-task]").length >= 5 && [...document.querySelectorAll('[data-task^="R-"]')].every((r) => r.querySelector(".tb-track i")), null, { timeout: 10000 }).catch(() => {});
  if (chat) await p.evaluate(() => document.body.classList.remove("chat-closed"));
  await p.waitForTimeout(400);
  return { ctx, p, fx };
}
const rowIds = (p) => p.$$eval("[data-task]", (rs) => rs.map((r) => r.dataset.task));
const groups = (p) => p.$$eval("[data-task]", (rs) => rs.map((r) => r.dataset.group));
const ORDER = { you: 0, stuck: 1, run: 2, done: 3 };
// the Board shows no decision card (no card body, no options) and no workflow graph
const noCards = (p) => p.evaluate(() => !document.querySelector('#view [data-scard], #view .scard, #view [data-need-card], #view [data-card], #view .icard, #view [data-option], #view .opt')
  && !/no minor unit|renames a column that other services read/.test(document.querySelector("#view").innerText));
const noGraphs = (p) => p.evaluate(() => !document.querySelector('#view svg.graph, #view .wo-frame, #view [data-wo-workflow], #view [data-run-graph-navigation], #view [data-graph]')
  && [...document.querySelectorAll("#view svg")].every((s) => s.classList.contains("ic")));
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector("#main").scrollWidth <= document.querySelector("#main").clientWidth + 1);
// the whole page: #main scrolls, so the shot grows the viewport to its content for a moment
async function shot(p, name) {
  const vp = p.viewportSize(), tall = await p.evaluate(() => Math.ceil(document.querySelector("#main").scrollHeight + document.querySelector("#main").getBoundingClientRect().top + 8));
  if (tall > vp.height) { await p.setViewportSize({ width: vp.width, height: tall }); await p.waitForTimeout(250); }
  await p.screenshot({ path: join(shots, name), fullPage: true });
  if (tall > vp.height) { await p.setViewportSize(vp); await p.waitForTimeout(150); }
}
// exactly one row of the list is in the tab order (its id), and the list is a list of list items with no option or listbox
const tabRows = (p) => p.$$eval("[data-task]", (rs) => rs.filter((r) => r.tabIndex === 0).map((r) => r.dataset.task));
const ariaOk = (p) => p.evaluate(() => { const l = document.querySelector("#tasks [role=list]"); return !!l && !document.querySelector("#view [role=listbox], #view [role=option]")
  && [...l.children].every((c) => c.getAttribute("role") === "listitem") && [...document.querySelectorAll("#view [data-task-detail]")].every((d) => !d.parentElement.closest("[role=list]") || d.parentElement.matches("[role=listitem]")); });
const sorted = (gs) =>gs.every((g, i) => !i || ORDER[gs[i - 1]] <= ORDER[g]);

try {
  // ---------- 1440, Firstmate panel closed: the table with the detail panel beside it ----------
  { const { ctx, p, fx } = await open(1440);
    ok(await p.locator(".bd-page.tb-wide").count() === 1, "1440 closed: the wide layout (a table and the panel beside it)");
    const ids = await rowIds(p), gs = await groups(p);
    const want = ["R-101", "R-102", "R-103", "R-104", "R-105", "R-106", "R-107", "R-091", ...fmShown.map((t) => t.id)];
    ok(want.every((id) => ids.includes(id)) && ids.length === want.length && !ids.includes("R-090"), "one row per Task: every Studio run in flight, the one done today, the firstmate tasks; not an old finished run", JSON.stringify({ ids, want }));
    ok(new Set(ids).size === ids.length, "no Task has two rows");
    ok(sorted(gs), "rows are ordered Waiting for you, Stuck, Running, Done", JSON.stringify(gs));
    const g = Object.fromEntries(ids.map((id, i) => [id, gs[i]]));
    ok(g["R-102"] === "you" && g["R-104"] === "you" && g["R-103"] === "stuck" && g["R-105"] === "stuck" && g["R-101"] === "run" && g["R-091"] === "done", "each Studio run in its group: cards waiting → Waiting for you; failed and Firstmate-first escalation → Stuck; building → Running; merged today → Done", JSON.stringify(g));
    // the round cap: stuck while the cap is the latest thing that happened (its round-budget card open); waiting for you once the
    // Task moved on after it (a rescope ran the spec again and raised the dispatch card), although fix still holds outcome "cap"
    ok(g["R-107"] === "stuck" && g["R-106"] === "you", "a round cap is stuck until the Task moves on: rescoped after the cap, it waits for you on its dispatch card", JSON.stringify([g["R-106"], g["R-107"]]));
    ok(fmShown.every((t) => g[t.id] === fmGroup(t)), "each firstmate task in its group", JSON.stringify(fmShown.map((t) => [t.id, t.status, g[t.id]])));
    ok(await noCards(p), "1440 closed: no card body on the Board (cards live in the Inbox)");
    ok(await noGraphs(p), "1440 closed: no workflow graph on the Board");
    ok(await p.locator("[data-need], #needs, [data-workflow-overview]").count() === 0, "no Needs you section and no Live workflows section");
    // the milestone track: code-firstmate's stages, the current one marked, its round
    const seg = (id) => p.$$eval(`[data-task="${id}"] .tb-track i`, (is) => is.map((i) => i.className.split(" ")[0]));
    ok(JSON.stringify(await seg("R-101")) === JSON.stringify(["past", "past", "past", "cur", "", "", ""]) && JSON.stringify(await seg("R-102")) === JSON.stringify(["past", "past", "past", "past", "cur", "", ""])
      && JSON.stringify(await seg("R-091")) === JSON.stringify(Array(7).fill("done")), "the milestone track follows the workflow's stages, the current milestone marked", JSON.stringify([await seg("R-101"), await seg("R-102")]));
    const st = (id) => p.textContent(`[data-task="${id}"] .tb-stage`).then((t) => t.trim());
    ok(await st("R-101") === "Build loop · round 2/3 · 4/7" && await st("R-102") === "Gates · 5/7" && await st("R-103") === "Build loop · round 1/3 · 4/7", "the stage label names the milestone, its round and the position", JSON.stringify([await st("R-101"), await st("R-102"), await st("R-103")]));
    // Now: who works (node, seat, model), or which card waits with its Inbox link
    const nowT = (id) => p.textContent(`[data-task="${id}"] .tb-now-t`).then((t) => t.trim());
    ok(await nowT("R-101") === "Build round · Copy editor · codex gpt-5.5", "Now names who works on a running Task: node, the seat its crew resolution gave it (a workflow-node override), provider and model", await nowT("R-101"));
    // no crew resolution (a staffed code workflow, a Task from before the team): no seat is guessed
    ok(await p.evaluate(async () => { const r = await fetch("/api/wruns/R-101").then((x) => x.json()); r.crew = null; return window.crewBoard.task(r, []).now; }) === "Build round · codex gpt-5.5", "without a crew resolution Now names no seat");
    ok(await p.evaluate(async () => { const r = await fetch("/api/wruns/R-101").then((x) => x.json()); r.roundCap = 5; return window.crewBoard.task(r, []).round?.cap; }) === 5, "the round's cap is the run's effective policy (roundCap), not only the org's");
    ok(/^Waiting for you: Dispatch: the rescoped spec/.test(await nowT("R-106")) && await p.getAttribute('[data-task="R-106"] [data-inbox-link]', "href") === "#/inbox/SC-203", "the Task rescoped after its cap names its dispatch card and links to it", await nowT("R-106"));
    ok(await nowT("R-107") === "Fix (refine loop): round cap reached" && await p.getAttribute('[data-task="R-107"] [data-inbox-link]', "href") === "#/inbox/SC-204", "a Task at its round cap says so and links to its round-budget card", await nowT("R-107"));
    ok(await nowT("R-102") === "Waiting for you: Merge: format() supports JPY, a currency without cents" && await p.getAttribute('[data-task="R-102"] [data-inbox-link]', "href") === "#/inbox/SC-201", "Now on a waiting Task names its card and links to it in the Inbox", await nowT("R-102"));
    ok(/Firstmate is deciding first/.test(await nowT("R-105")) && /CI failed: 2 of 14 tests fail/.test(await nowT("R-103")), "Now on a stuck Task says why: Firstmate deciding, or the failure", JSON.stringify([await nowT("R-105"), await nowT("R-103")]));
    // overlap: R-101 and R-104 both change src/money.ts
    ok(await p.getAttribute('[data-task="R-101"] [data-overlap]', "data-overlap") === "R-104" && await p.getAttribute('[data-task="R-104"] [data-overlap]', "data-overlap") === "R-101" && await p.locator('[data-task="R-102"] [data-overlap], [data-task="R-103"] [data-overlap]').count() === 0
      && (await p.textContent('[data-task="R-101"] [data-overlap]')).trim() === "↻ will rebase", "the overlap badge marks the two open Tasks whose scopes meet (test paths aside), and no other");
    ok(/^\d+m$|^\dh$/.test((await p.textContent('[data-task="R-101"] .tb-el')).trim()), "elapsed reads compactly", await p.textContent('[data-task="R-101"] .tb-el'));
    ok(await p.getAttribute("[data-task-detail]", "data-task-detail") === ids[0] && await p.getAttribute(`[data-task="${ids[0]}"]`, "aria-current") === "true" && JSON.stringify(await tabRows(p)) === JSON.stringify([ids[0]]), "the first row is selected, its panel open, and it is the one row in the tab order");
    ok(await ariaOk(p), "1440 closed: the rows are a list of list items (no listbox, no option holding links)");
    // the filters, with their counts; a filter that hides the selected Task moves the selection (and the panel) to its first row
    await p.click('[data-task="R-101"] .tb-title');
    for (const k of ["you", "stuck", "run", "done", "all"]) {
      await p.click(`[data-tb-tab="${k}"]`); await p.waitForTimeout(80);
      const n = Number((await p.textContent(`[data-tb-tab="${k}"] .tb-count`)).trim()), gk = await groups(p), shown = await rowIds(p), panel = await p.getAttribute("[data-task-detail]", "data-task-detail"), tabs = await tabRows(p);
      ok(gk.length === (k === "all" ? ids.length : gs.filter((x) => x === k).length) && n === gk.length && (k === "all" || gk.every((x) => x === k)) && await p.getAttribute(`[data-tb-tab="${k}"]`, "aria-selected") === "true", `the ${k} filter shows its rows and its count (${n})`, JSON.stringify(gk));
      ok(shown.includes(panel) && tabs.length === 1 && tabs[0] === panel && (k !== "you" || panel === shown[0]), `under the ${k} filter the panel shows a row of the list, and that row is the one in the tab order`, JSON.stringify({ panel, tabs, first: shown[0] }));
    }
    // the keyboard enters the list from the filter tabs (Tab), and ←/→ switch the filter
    await p.click('[data-tb-tab="done"]'); await p.focus('[data-tb-tab="done"]'); await p.keyboard.press("Tab");
    ok(await p.evaluate(() => document.activeElement?.dataset.task) === "R-091", "Tab from the filter tabs reaches the selected row");
    await p.focus('[data-tb-tab="done"]'); await p.keyboard.press("ArrowLeft"); await p.waitForTimeout(80);
    ok(await p.getAttribute('[data-tb-tab="stuck"]', "aria-selected") === "true" && await p.evaluate(() => document.activeElement?.dataset.tbTab) === "stuck" && (await groups(p)).every((x) => x === "stuck")
      && await p.$$eval("[data-tb-tab]", (ts) => ts.filter((t) => t.tabIndex === 0).map((t) => t.dataset.tbTab).join()) === "stuck", "← moves to the previous filter tab, shows its rows, and only that tab is in the tab order");
    await p.keyboard.press("End"); await p.waitForTimeout(80); await p.keyboard.press("ArrowRight"); await p.waitForTimeout(80);
    ok(await p.getAttribute('[data-tb-tab="all"]', "aria-selected") === "true", "→ past the last filter wraps to All");
    await p.click('[data-task="' + ids[0] + '"] .tb-title');
    // the detail panel: only the selected Task's visited path
    await p.click('[data-task="R-101"] .tb-title');
    const path = await p.$$eval('[data-task-path="R-101"] li', (ls) => ls.map((l) => `${l.dataset.pathNode}:${l.dataset.visit}${l.classList.contains("cur") ? "*" : ""}`));
    ok(JSON.stringify(path) === JSON.stringify(["spec:1", "build:1", "review:1", "build:2*"]), "the panel shows only this Task's visited path, the current node ringed", JSON.stringify(path));
    ok(/round 2 ↺/.test(await p.textContent('[data-task-path="R-101"] li[data-visit="2"]')), "a loop shows as round N ↺", await p.textContent('[data-task-path="R-101"] li[data-visit="2"]'));
    ok(await p.locator("[data-task-detail] .tb-ev").count() > 0 && /Build/.test(await p.textContent("[data-task-detail] .tb-d-ev")), "the panel lists recent events");
    ok(await p.getAttribute('[data-full-graph="R-101"]', "href") === "#/run/R-101?graph=1" && await p.getAttribute('[data-open-task="R-101"]', "href") === "#/run/R-101", "the panel links to the full graph and to the Task");
    ok(p.url().endsWith("#/board"), "selecting a row does not navigate", p.url());
    await p.click('[data-task="R-105"] .tb-title');
    ok(await p.locator('[data-task-path="R-105"] li.cur').count() === 1 && await p.getAttribute('[data-task-path="R-105"] li.cur', "data-path-node") === "firstmate", "a Firstmate-first escalation rings Firstmate on the path");
    await shot(p, "board-1440-closed.png");
    // keyboard: ↑/↓ move the selection along the rows, Enter opens the Task
    await p.click('[data-tb-tab="all"]'); await p.click(`[data-task="${ids[0]}"] .tb-title`); await p.focus(`[data-task="${ids[0]}"]`);
    await p.keyboard.press("ArrowDown"); await p.waitForTimeout(80);
    ok(await p.evaluate(() => document.activeElement?.dataset.task) === ids[1] && await p.getAttribute("[data-task-detail]", "data-task-detail") === ids[1], "↓ selects and focuses the next row, and the panel follows");
    await p.keyboard.press("ArrowUp"); await p.waitForTimeout(80);
    ok(await p.evaluate(() => document.activeElement?.dataset.task) === ids[0], "↑ goes back");
    // a live update keeps the selected row, its focus and the scroll
    await p.click('[data-task="R-104"] .tb-title');
    await p.evaluate(() => { const m = document.querySelector("#main"); m.style.height = "500px"; m.scrollTop = 120; window.__scroll = m.scrollTop; });
    fx.details["R-101"].nodes.build.state = "passed"; Object.assign(fx.details["R-101"].nodes.ci, { state: "running", visits: 2 }); fx.details["R-101"].updatedAt = new Date(PIN).toISOString();
    const nodes = Object.fromEntries(Object.entries(fx.details["R-101"].nodes).map(([k, n]) => [k, { state: n.state, visits: n.visits, outcome: n.outcome, waiting: n.waiting }]));
    await p.evaluate((d) => window.__es.dispatchEvent(new MessageEvent("wrun", { data: JSON.stringify(d) })), { id: "R-101", status: "running", event: { seq: 41, ts: new Date(PIN).toISOString(), type: "node", node: "ci", from: "pending", to: "running" }, nodes });
    await p.waitForFunction(() => /^CI/.test(document.querySelector('[data-task="R-101"] .tb-now-t')?.textContent || ""), null, { timeout: 4000 }).catch(() => {});
    ok(/^CI/.test(await nowT("R-101")), "a live event updates the row (CI now runs)", await nowT("R-101"));
    ok(await p.getAttribute("[data-task-detail]", "data-task-detail") === "R-104" && await p.evaluate(() => document.activeElement?.dataset.task) === "R-104" && await p.evaluate(() => Math.abs(document.querySelector("#main").scrollTop - window.__scroll) <= 1),
      "a live update keeps the selected row, its focus and the scroll", JSON.stringify(await p.evaluate(() => [document.activeElement?.dataset.task, document.querySelector("#main").scrollTop, window.__scroll])));
    await p.evaluate(() => { document.querySelector("#main").style.height = ""; });
    // the deep link to the Inbox: the Board's link opens that card there
    await p.click('[data-task="R-102"] [data-inbox-link]');
    ok(await p.waitForSelector('[data-scard="SC-201"]', { timeout: 5000 }).then(() => true, () => false) && p.url().endsWith("#/inbox/SC-201"), "去收件匣 opens the card in the Inbox", p.url());
    await p.goto(`${base}/#/board`); await p.waitForSelector('[data-task="R-101"]');
    await p.click('[data-task="R-101"] .tb-title'); await p.focus('[data-task="R-101"]'); await p.keyboard.press("Enter");
    ok(await p.waitForFunction(() => location.hash === "#/run/R-101").then(() => true, () => false), "Enter on a row opens the Task", p.url());
    await p.goto(`${base}/#/board`); await p.waitForSelector('[data-task="R-101"]'); await p.click('[data-task="R-101"] .tb-title'); await p.click('[data-full-graph="R-101"]');
    ok(await p.waitForSelector("[data-run-graph-navigation]", { timeout: 6000 }).then(() => true, () => false) && /graph=1/.test(p.url()), "完整流程圖 opens the Task page's graph", p.url());
    await p.goto(`${base}/#/board`); await p.waitForSelector('[data-task="R-101"] .tb-track i');
    ok(await noSideways(p), "1440 closed: no sideways scroll");
    // the milestone derivation on a definition without stages: the main path's work nodes
    const ms = await p.evaluate(() => window.crewBoard.milestones({ id: "images", nodes: [{ id: "intake", kind: "hook" }, { id: "draft", kind: "hook", role: "w" }, { id: "checks", kind: "check" }, { id: "accept", kind: "card" }, { id: "fix", kind: "agent" }, { id: "library", kind: "hook" }, { id: "done", kind: "hook" }, { id: "closed", kind: "hook" }],
      edges: [{ from: "intake", to: "draft" }, { from: "draft", to: "checks" }, { from: "checks", to: "fix", when: "fail" }, { from: "checks", to: "accept", when: "pass" }, { from: "fix", to: "checks" }, { from: "accept", to: "closed", when: "close" }, { from: "accept", to: "library", when: "accept" }, { from: "library", to: "done" }] }).map((m) => m.id));
    ok(JSON.stringify(ms) === JSON.stringify(["draft", "checks", "accept"]), "milestones without stages: the main path (forward edges first) and its work nodes only", JSON.stringify(ms));
    await ctx.close(); }

  // ---------- 1440, Firstmate panel open: a compact list with the panel beside it ----------
  { const { ctx, p } = await open(1440, { chat: true });
    ok(await p.locator(".bd-page.tb-mid").count() === 1 && await p.locator("#chat").isVisible(), "1440 with the Firstmate panel open: the compact layout, the panel beside the list");
    ok(sorted(await groups(p)), "1440 open: rows are ordered Waiting for you, Stuck, Running, Done");
    ok(await noCards(p) && await noGraphs(p), "1440 open: no card body and no workflow graph");
    await p.click('[data-task="R-101"] .tb-title');
    const box = await p.evaluate(() => { const l = document.querySelector(".tb-list").getBoundingClientRect(), d = document.querySelector("[data-task-detail]").getBoundingClientRect(); return { beside: d.left >= l.right - 1, path: document.querySelectorAll('[data-task-path="R-101"] li').length }; });
    ok(box.beside && box.path === 4, "1440 open: the detail panel sits on the right with the Task's path", JSON.stringify(box));
    ok(await ariaOk(p) && (await tabRows(p)).length === 1, "1440 open: a list of list items, one row in the tab order");
    await p.click('[data-tb-tab="done"]');
    ok(await p.getAttribute("[data-task-detail]", "data-task-detail") === "R-091" && JSON.stringify(await tabRows(p)) === JSON.stringify(["R-091"]), "1440 open: a filter that hides the selected Task moves the selection and the panel to its first row");
    await p.click('[data-tb-tab="all"]');
    ok(await p.getAttribute('[data-task="R-102"] [data-inbox-link]', "href") === "#/inbox/SC-201", "1440 open: the waiting Task links to its card in the Inbox");
    ok(await noSideways(p), "1440 open: no sideways scroll");
    await shot(p, "board-1440-firstmate-open.png");
    await ctx.close(); }

  // ---------- 390, zh-TW: cards, the waiting bar, the panel under the selected card ----------
  { const { ctx, p } = await open(390, { lang: "zh-TW" });
    ok(await p.locator(".bd-page.tb-narrow").count() === 1, "390: the card layout");
    const you = (await groups(p)).filter((x) => x === "you").length;
    const bar = (await p.textContent("[data-tb-waitbar]").catch(() => "")).trim();
    ok(bar === `${you} 個任務在等你去收件匣 →` && await p.getAttribute("[data-tb-waitbar]", "href") === "#/inbox", "390: the top bar says how many Tasks wait and links to the Inbox", bar);
    ok(await p.locator("[data-task-detail]").count() === 0, "390: no panel until a card is chosen");
    const ids390 = await rowIds(p);
    ok(JSON.stringify(await tabRows(p)) === JSON.stringify([ids390[0]]) && await ariaOk(p), "390: with nothing chosen the first card is the one in the tab order, in a list of list items");
    // the keyboard: Tab from the filter tabs enters the cards, ↓ moves the focus (no panel opens), Space opens the panel
    await p.focus('[data-tb-tab="all"]'); await p.keyboard.press("Tab");
    ok(await p.evaluate(() => document.activeElement?.dataset.task) === ids390[0], "390: Tab from the filter tabs reaches the first card");
    await p.keyboard.press("ArrowDown"); await p.waitForTimeout(80);
    ok(await p.evaluate(() => document.activeElement?.dataset.task) === ids390[1] && await p.locator("[data-task-detail]").count() === 0 && JSON.stringify(await tabRows(p)) === JSON.stringify([ids390[1]]), "390: ↓ moves the focus to the next card without opening a panel");
    await p.keyboard.press(" "); await p.waitForTimeout(80);
    ok(await p.locator(`[data-task="${ids390[1]}"] > [data-task-detail="${ids390[1]}"]`).count() === 1, "390: Space opens the focused card's panel inside it");
    await p.keyboard.press(" "); await p.waitForTimeout(80);
    ok(sorted(await groups(p)) && await noCards(p) && await noGraphs(p), "390: ordered rows, no card body, no workflow graph");
    ok((await p.textContent('[data-tb-tab="stuck"]')).includes("卡住") && (await p.textContent('[data-tb-tab="done"]')).includes("今天完成") && /會 rebase/.test(await p.textContent('[data-task="R-101"]')), "390: zh-TW copy (tabs, overlap badge)");
    await p.click('[data-task="R-101"] .tb-title'); await p.waitForTimeout(150);
    ok(await p.locator('[data-task="R-101"] > [data-task-detail="R-101"]').count() === 1 && /第 2 輪 ↺/.test(await p.textContent('[data-task-path="R-101"]')) && await ariaOk(p), "390: the panel opens inside the chosen card (a list item), with its path and loops in zh-TW");
    await p.click('[data-tb-tab="done"]');
    ok(await p.locator("[data-task-detail]").count() === 0 && JSON.stringify(await tabRows(p)) === JSON.stringify(["R-091"]), "390: a filter that hides the chosen card closes its panel and puts its first card in the tab order");
    await p.click('[data-tb-tab="all"]'); await p.click('[data-task="R-101"] .tb-title'); await p.waitForTimeout(150);
    ok(await noSideways(p), "390: no sideways scroll");
    await shot(p, "board-390.png");
    await p.click('[data-task="R-101"] .tb-title'); await p.waitForTimeout(150);
    ok(await p.locator("[data-task-detail]").count() === 0, "390: tapping the chosen card again folds its panel");
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  await browser.close(); app.kill();
}
console.log(`\nboard-overview-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
