import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The list toolbar on every list page (public/list-tools.js; docs/units/list-tools.md), on the real server: Tasks, Workflows,
// Skills, Projects, Crew, Terminals, Library and Review room read many synthetic rows (the page's own API answered by the
// test), Activity reads the fixture event log through the server's own paging (src/activity-list.ts), and the Agent rounds
// panel reads the server's rounds through ?runs=. It checks the search (script-insensitive, the first word marked), key:value
// words and their suggestions, the facet popover and its counts, chips, the 30-day window and what it leaves out, paging and
// page size, the state in the URL (reload and back keep it), the empty state, "/" and Escape, at 1440 and 390, and takes
// the screenshots the review reads.        node tests/list-tools-ui.mjs   (LT_SHOTS=<dir> to keep them elsewhere)
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("list-tools-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-list-tools-ui-")), state = join(tmp, "state"), data = join(tmp, "data");
cpSync(join(here, "fixture/state"), state, { recursive: true }); mkdirSync(data, { recursive: true });
// the Inbox reads only the test's Studio cards: the fixture's firstmate cards are left out of this copy
for (const f of readdirSync(join(state, "pending"))) rmSync(join(state, "pending", f), { force: true });
// Studio's own agent rounds: 3 runs × 80 rounds, more than the 200 the list keeps
const ROUND_RUNS = ["R-9001", "R-9002", "R-9003"];
for (const r of ROUND_RUNS) for (let i = 0; i < 80; i++) mkdirSync(join(data, "runs", r, "nodes", "worker", `r${i}`), { recursive: true });
const shots = process.env.LT_SHOTS || join(root, "tests/out/list-tools"); mkdirSync(shots, { recursive: true });

// ---------- synthetic rows: deterministic, generic names ----------
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; const pick = (a) => a[Math.floor(rnd() * a.length)];
const NOW = Date.now(), ago = (d, h = 0) => new Date(NOW - d * 86400e3 - h * 3600e3).toISOString();
const wfs = ["code-change", "documents", "images", "web-prototype", "issue-triage"];
const verbs = ["Fix", "Add", "Refactor", "Tidy", "Upgrade", "Remove"], things = ["login flow", "rate limits", "order status", "home banner", "log format", "webhook retries", "dark theme", "upload limit", "CI cache", "search ranking"];
const statuses = [["running", null], ["waiting", null], ["succeeded", "done"], ["succeeded", "done"], ["failed", "fail"], ["cancelled", null]];
const runs = Array.from({ length: 312 }, (_, i) => { const [status, result] = i < 6 ? statuses[i % 2] : pick(statuses); const d = i < 10 ? 0 : Math.floor(i / 4) + Math.floor(rnd() * 3);
  return { id: `R-${4200 - i}`, workflow: pick(wfs), version: 1 + Math.floor(rnd() * 5), title: i === 3 ? "軟體更新流程" : `${pick(verbs)} ${pick(things)}`, request: "", status, result,
    project: pick(["studio", "api-gateway", "docs-site"]), createdAt: ago(d, 1), updatedAt: ago(d, 0.5), endedAt: status === "running" || status === "waiting" ? null : ago(d, 0.5), error: null, childRun: null, archived: false, origin: null, merged: false, reconciled: null, cancelReason: null,
    current: status === "running" ? [{ node: "worker", state: "running", waiting: null, label: "Worker" }] : status === "waiting" ? [{ node: "spec", state: "waiting", waiting: "card", label: "Spec" }] : [], door: null }; }).reverse();
const wfList = Array.from({ length: 40 }, (_, i) => ({ id: `wf-${i}`, name: `${pick(["Code change", "Documents", "Images", "Video", "Web prototype", "Issue triage"])} ${i}`, displayName: null, description: "Takes a request through spec, work, review and delivery.", kind: null, version: 1 + (i % 7), versions: 1 + (i % 7), updatedAt: ago(i), nodes: 4 + (i % 9), personal: i >= 12, params: null }));
const skills = Array.from({ length: 58 }, (_, i) => ({ id: `sk-${i}`, name: `${pick(["worker", "reviewer", "designer", "spec-writer", "qa-checklist", "release-notes", "ts-style", "sql-migrations"])}-${i}`, description: `Rules for ${pick(things)}.`, fits: null, source: "/skills", sourceKind: pick(["builtin", "folder", "home", "git"]), current: 1, sha256: "a".repeat(64), filesSha256: "b".repeat(64), bytes: 900, files: [], skipped: [], ignored: [],
  versions: [{ n: 1, sha256: "a".repeat(64), bytes: 900, ignored: [], createdAt: ago(i), by: "captain" }], usedBy: rnd() > 0.5 ? [{ workflow: pick(wfs), node: "worker", v: 1 }] : [] }));
const names = ["Ada", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hana"];
const crew = Array.from({ length: 140 }, (_, i) => { const alive = i < 3, phase = alive ? pick(["building", "reviewing"]) : pick(["finished", "finished", "stopped", "ended: failed"]); const nm = pick(names);
  return { actor: `worker-${i}`, name: nm, role: pick(["worker", "reviewer", "designer"]), task: `T-${100 + (i % 30)}`, title: `${pick(verbs)} ${pick(things)}`, vendor: pick(["claude", "codex"]), model: pick(["opus", "sonnet", "gpt"]), round: 1 + (i % 4), attempt: 1, alive, phase, taskPhase: null, taskStatus: null, project: pick(["api-gateway", "docs-site"]),
    started: ago(0, i), elapsedMs: 60000 * (3 + i % 50), lastWrite: ago(0, i), activity: null, pr: null, merged: null, ci: null, report: false, result: null, lines: [] }; });
const terms = Array.from({ length: 52 }, (_, i) => ({ id: `t${i}`, project: { id: "p", name: pick(["api-gateway", "docs-site", "mobile-app"]), path: "/tmp/x" }, preset: "shell", kind: "shell", label: `${pick(["dev server", "tests", "shell", "build", "logs"])} ${i}`, command: pick(["bun run dev", "bun test", "zsh"]), by: "captain",
  startedAt: ago(i), endedAt: i < 4 ? null : ago(i), exitCode: i < 4 ? null : 0, signal: null, state: i < 2 ? "working" : i < 4 ? "waiting" : pick(["done", "exited"]), reason: null, ask: null, cols: 80, rows: 24, running: i < 4, transcriptTruncated: false, git: null, review: null, restored: false, stopped: null }));
const arts = Array.from({ length: 150 }, (_, i) => ({ id: `art-${i}`, title: `${pick(["Home page", "Launch page", "Product shot", "Intro film", "Voice-over", "Guide"])} ${i + 1}`, type: pick(["web", "image", "video", "audio"]), project: pick(["api-gateway", "docs-site"]), source: "url", created: ago(Math.floor(i / 3)), note: null, entry: null,
  versions: [{ n: 1, status: pick(["draft", "approved", "in-review"]), createdAt: ago(Math.floor(i / 3)), url: "https://example.com", files: [] }], latest: 1, approved: null }));
const code = Array.from({ length: 30 }, (_, i) => ({ kind: "code", id: `PR-${500 + i}`, title: `${pick(verbs)} ${pick(things)}`, ts: ago(i * 2), pr: 500 + i, url: `https://example.com/pull/${500 + i}`, commit: null, branch: `feat/x-${i}`, checks: { pass: 3, fail: 0 }, task: null, intent: null, door: null, lineage: null }));
const kinds = ["question", "approve", "merge", "spec"];
const scards = Array.from({ length: 46 }, (_, i) => ({ id: `SC-${900 + i}`, run: `R-${4200 - i}`, node: "ask", visit: 1, kind: kinds[i % 4], status: "open", workflow: wfs[i % 3],
  title: { en: i === 5 ? "Approve the 軟體 release" : `${pick(verbs)} ${pick(things)}`, "zh-TW": i === 5 ? "核准軟體發行" : `${pick(verbs)} ${pick(things)}` }, body: "Pick one",
  options: [{ id: "a", label: "A", primary: true }, { id: "b", label: "B", note: true }], createdAt: ago(46 - i), answer: null }));
const ZONES = ["waiting", "reviewing", "concluded", "archived"];
const rooms = Array.from({ length: 96 }, (_, i) => ({ id: `PR-${String(i).padStart(4, "0")}`, title: `${pick(verbs)} ${pick(things)} #${100 + i}`, titleZh: null, repository: pick(["owner/api-gateway", "owner/docs-site", "owner/mobile-app"]), zone: pick(ZONES), open: rnd() > 0.3, running: false, turns: Math.floor(rnd() * 9), updatedAt: ago(Math.floor(i / 4)) }));
const projects = Array.from({ length: 36 }, (_, i) => ({ id: `proj-${i}`, name: `owner/${pick(["billing", "search", "auth", "infra", "sdk-js", "status-page"])}-${i}`, kind: i === 0 ? "studio" : pick(["local", "local", "external", "builtin"]), enabled: rnd() > 0.15, attention: rnd() > 0.8 ? 1 : 0, running: rnd() > 0.6 ? 2 : 0, held: 0, failed24h: rnd() > 0.85 ? 1 : 0, mini: [], connected: false }));
const API = { "/api/wruns": { runs, cards: [] }, "/api/wf": { workflows: wfList, held: [], trash: [], names: {}, checks: [] }, "/api/skills": { skills, roles: [], caps: {} }, "/api/skills/homes": { homes: [] },
  "/api/crew/live": crew, "/api/terminals": { terminals: terms, presets: [], projects: [], canWrite: true }, "/api/artifacts": { artifacts: arts, runs: [], render: {} }, "/api/library": { code, files: [], artifacts: arts },
  "/api/review-room": { rooms, settings: { autoTeach: false }, tutors: [], providers: [] }, "/api/projects/overview": { projects }, "/api/scards": { cards: scards } };

const port = await freePort(), base = `http://127.0.0.1:${port}`, env = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data, CREW_FM_STATE: state, CREW_RECENT_DAYS: "3650",
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
app.stdout.resume(); await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base), errors = [];
const open = async (lang, width = 1440) => {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 } });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); localStorage.setItem("crew.chatOpen", "0"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [lang]);
  await ctx.route((u) => Object.hasOwn(API, u.pathname), (r) => r.fulfill({ json: API[new URL(r.request().url()).pathname] }));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); return { p, ctx };
};
const go = async (p, hash, list) => { await p.goto(`${base}/${hash}`);
  // the terminals page shows the running terminals' tabs; its list is under Launch…
  if (list === "terminals") { await p.waitForSelector("[data-term-new]", { timeout: 20000 }); if (await p.$eval("[data-term-new]", (e) => e.getAttribute("aria-expanded") !== "true")) await p.click("[data-term-new]"); }
  await p.waitForSelector(`[data-lt-count="${list}"]`, { timeout: 20000 }); await p.waitForTimeout(150); };
const count = (p, list) => p.$eval(`[data-lt-count="${list}"]`, (e) => e.textContent);
const range = (p, list) => p.$eval(`[data-lt-range="${list}"]`, (e) => e.textContent).catch(() => null);
const hashQ = async (p) => new URLSearchParams(await p.evaluate(() => location.hash.split("?")[1] || ""));
const type = async (p, list, text) => { await p.fill(`[data-lt-q="${list}"]`, text); await p.waitForTimeout(120); };
const shot = (p, name) => p.screenshot({ path: join(shots, `${name}.png`), fullPage: false });

try {
  // ======== Tasks: every behaviour, in English ========
  { const { p, ctx } = await open("en");
    await go(p, "#/runs", "runs");
    const recent = runs.filter((r) => ["running", "waiting"].includes(r.status) || Date.parse(r.updatedAt) >= NOW - 30 * 86400e3).length, older = runs.length - recent;
    ok(await count(p, "runs") === `${recent} in the last 30 days`, "Tasks: the last 30 days by default, counted", await count(p, "runs"));
    ok(await p.$eval("[data-lt-older]", (e) => e.dataset.ltOlder) === String(older) && /not shown/.test(await p.$eval("[data-lt-older]", (e) => e.textContent)), "the older Tasks are counted under the list, not dropped silently");
    ok((await p.$$("[data-run]")).length === 25 && await range(p, "runs") === `1–25 of ${recent}`, "25 a page, the footer says which", await range(p, "runs"));
    await shot(p, "tasks-toolbar-1440-en");
    // search: as you type, the first word marked; the URL keeps it
    await type(p, "runs", "webhook");
    const hits = runs.filter((r) => /webhook/i.test(r.title) && (["running", "waiting"].includes(r.status) || Date.parse(r.updatedAt) >= NOW - 30 * 86400e3)).length;
    ok(await count(p, "runs") === `${hits} of ${runs.length} match` && (await p.$$("[data-run] mark.lt-mark")).length === Math.min(25, hits), "search filters as you type and marks the word in each title", await count(p, "runs"));
    ok((await hashQ(p)).get("q") === "webhook" && await p.evaluate(() => location.hash.startsWith("#/runs?")), "the search is in the URL");
    ok(await p.evaluate(() => document.activeElement?.matches('[data-lt-q="runs"]')), "the search box keeps the focus while the list changes");
    await shot(p, "tasks-filtered-1440-en");
    // script-insensitive Chinese
    await type(p, "runs", "软件"); ok((await p.$$("[data-run]")).map((x) => x).length === 1 && await p.$eval("[data-run] mark", (e) => e.textContent) === "軟體", "a Simplified word finds and marks a Traditional title");
    // empty state
    await type(p, "runs", "no such task anywhere"); ok(!!await p.$('[data-lt-empty="runs"]') && /No task matches/.test(await p.$eval('[data-lt-empty="runs"]', (e) => e.textContent)) && !await p.$('[data-lt-foot="runs"]:not([hidden])'), "nothing matches: the empty card says so, no footer");
    await shot(p, "tasks-empty-1440-en");
    await p.click('[data-lt-reset="runs"]'); ok(await count(p, "runs") === `${recent} in the last 30 days` && !(await hashQ(p)).get("q"), "Clear search and filters brings the list back and empties the URL");
    // key: suggestions
    await p.focus('[data-lt-q="runs"]'); await p.keyboard.type("status:"); await p.waitForTimeout(150);
    const sugs = await p.$$eval("[data-lt-sug]", (es) => es.map((e) => e.textContent));
    ok(sugs.length >= 3 && sugs.every((s) => /^status:.+\d+$/.test(s)), "status: lists the status values with their counts", JSON.stringify(sugs));
    await shot(p, "tasks-suggest-1440-en");
    await p.keyboard.type("Wai"); await p.waitForTimeout(100);
    ok(JSON.stringify(await p.$$eval("[data-lt-sug]", (es) => es.map((e) => e.dataset.ltSug))) === '["status:Waiting for you"]', "a value's first letters narrow it");
    await p.click("[data-lt-sug]"); await p.waitForTimeout(150);
    const waiting = runs.filter((r) => r.status === "waiting").length;
    ok(await p.$eval('[data-lt-q="runs"]', (e) => e.value) === "status:waiting " && (await p.$$("[data-run]")).length === Math.min(25, waiting) && await count(p, "runs") === `${waiting} of ${runs.length} match`, "picking it writes the token and filters", await p.$eval('[data-lt-q="runs"]', (e) => e.value));
    await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.waitForTimeout(100);
    ok(await p.$eval('[data-lt-q="runs"]', (e) => e.value) === "" && await count(p, "runs") === `${recent} in the last 30 days`, "Escape closes the suggestions, then clears the search");
    await p.fill('[data-lt-q="runs"]', "st"); await p.waitForTimeout(100);
    ok((await p.$$eval("[data-lt-sug]", (es) => es.map((e) => e.dataset.ltSug))).join() === "status:（Status）", "a key's first letters suggest the key"); await p.fill('[data-lt-q="runs"]', ""); await p.waitForTimeout(80);
    // "/" focuses the search, never while typing elsewhere
    await p.click("h1"); await p.keyboard.press("/"); ok(await p.evaluate(() => document.activeElement?.matches('[data-lt-q="runs"]')), "/ focuses the search");
    await p.focus('[data-run-text]'); await p.keyboard.press("/"); ok(await p.$eval('[data-run-text]', (e) => e.value.endsWith("/")) && await p.evaluate(() => !document.activeElement?.matches("[data-lt-q]")), "/ in another field is typed, not taken"); await p.fill('[data-run-text]', "");
    // the facet popover: counts with every other filter applied
    await p.click('[data-lt-facet="status"]'); await p.waitForSelector('[data-lt-pop="status"]');
    const wfDocs = runs.filter((r) => r.workflow === "documents" && (["running", "waiting"].includes(r.status) || Date.parse(r.updatedAt) >= NOW - 30 * 86400e3));
    await shot(p, "tasks-facet-1440-en");
    await p.click('[data-lt-pop="status"] [data-lt-opt="status=done"]'); await p.waitForTimeout(100);
    ok(await p.$eval('[data-lt-facet="status"]', (e) => e.textContent) === "Status · 1 ▾" && await p.$eval('[data-lt-facet="status"]', (e) => e.classList.contains("primary")), "a ticked value: the button says · 1 and turns primary");
    ok(!!await p.$('[data-lt-chip="status=done"]') && (await hashQ(p)).get("status") === "done", "a chip for it, and status=done in the URL");
    await p.keyboard.press("Escape"); ok(!await p.$('[data-lt-pop]'), "Escape closes the popover");
    await p.click('[data-lt-facet="workflow"]'); await p.waitForSelector('[data-lt-pop="workflow"]');
    const docN = await p.$eval('[data-lt-pop="workflow"] [data-lt-opt="workflow=documents"]', (e) => e.closest("label").querySelector(".num").textContent);
    ok(docN === String(wfDocs.filter((r) => r.status === "succeeded" && r.result === "done").length), "a count is the rows left if that box is ticked too: every other filter applied", docN);
    await p.click("h1"); ok(!await p.$('[data-lt-pop]'), "a click outside closes the popover");
    // paging and page size: the URL keeps them, a filter returns to page 1
    await p.click('[data-lt-chip="status=done"] button'); await p.waitForTimeout(80);
    await p.click('[data-lt-page="2"]'); await p.waitForTimeout(100);
    ok(await range(p, "runs") === `26–50 of ${recent}` && (await hashQ(p)).get("page") === "2", "page 2: rows 26–50, page=2 in the URL", await range(p, "runs"));
    await shot(p, "tasks-paging-1440-en");
    await p.reload(); await p.waitForSelector('[data-lt="runs"] [data-lt-count]'); await p.waitForTimeout(150);
    ok(await range(p, "runs") === `26–50 of ${recent}`, "a reload keeps the page");
    const second = await p.$eval("[data-run]", (e) => e.dataset.run); await p.click(`[data-run="${second}"]`); await p.waitForFunction(() => location.hash.startsWith("#/run/"));
    await p.goBack(); await p.waitForSelector('[data-lt="runs"] [data-lt-count]'); await p.waitForTimeout(150);
    ok(await range(p, "runs") === `26–50 of ${recent}` && await p.$eval("[data-run]", (e) => e.dataset.run) === second, "back from a Task returns to the same page");
    await p.selectOption('[data-lt-size="runs"]', "50"); await p.waitForTimeout(100);
    ok(await range(p, "runs") === `1–50 of ${recent}` && (await p.$$("[data-run]")).length === 50, "page size 50, back to page 1");
    await type(p, "runs", "fix"); ok(!(await hashQ(p)).get("page"), "a filter returns to page 1");
    await type(p, "runs", "");
    // older Tasks
    await p.click('[data-lt-include-old="runs"]'); await p.waitForTimeout(100);
    ok(await count(p, "runs") === `${runs.length} of ${runs.length} match` && !!await p.$('[data-lt-chip="old"]') && (await hashQ(p)).get("old") === "1", "Include them: every Task, with a chip and old=1");
    await p.click('[data-lt-chip="old"] button'); await p.waitForTimeout(80);
    // #/runs?project= is the project facet; the Agent rounds panel follows the filter on the server
    await p.goto(`${base}/#/runs?project=docs-site`); await p.waitForSelector('[data-lt="runs"] [data-lt-count]'); await p.waitForTimeout(200);
    ok(await p.$$eval("[data-run]", (es) => es.length) > 0 && !!await p.$('[data-project-filter="docs-site"]') && !!await p.$('[data-lt-chip="project=docs-site"]'), "#/runs?project=<id> is the project facet, with its project row");
    ctx.close(); }

  // ======== the Agent rounds panel: filtered on the server, the 200 cap said ========
  { const all = await fetch(`${base}/api/node-runs`, { headers: { "x-crew-session": process.env.CREW_SESSION_TOKEN } });
    const one = await fetch(`${base}/api/node-runs?runs=R-9002`, { headers: { "x-crew-session": process.env.CREW_SESSION_TOKEN } });
    const a = await all.json(), b = await one.json();
    ok(a.length === 200 && all.headers.get("x-total-count") === "240", "/api/node-runs keeps the newest 200 and says there are 240", `${a.length} ${all.headers.get("x-total-count")}`);
    ok(b.length === 80 && b.every((x) => x.run === "R-9002") && one.headers.get("x-total-count") === "80", "?runs= filters before the cap: every round of that run, none of the others"); }
  { const { p, ctx } = await open("en"); await ctx.route((u) => u.pathname === "/api/wruns", (r) => r.fulfill({ json: { runs: ROUND_RUNS.map((id, i) => ({ ...runs[0], id, title: `Rounds ${i}`, status: "running" })), cards: [] } }));
    await go(p, "#/runs", "runs"); await p.waitForSelector('[data-section="node-runs"] [data-node-runs-capped]', { timeout: 10000 });
    ok(await p.$eval("[data-node-runs-capped]", (e) => e.dataset.nodeRunsCapped) === "240", "unfiltered, the panel says it shows the newest 200 of 240");
    await type(p, "runs", "R-9002"); await p.waitForSelector('[data-section="node-runs"][data-node-runs-total="80"]', { timeout: 10000 });
    ok((await p.$$("[data-node-run]")).length === 80 && (await p.$$eval("[data-node-run]", (es) => es.every((e) => e.dataset.nodeRun.startsWith("R-9002/")))), "filtered, it shows every round of the matching Task (read on the server, not the first 200)");
    ok(await p.evaluate(() => document.activeElement?.matches('[data-lt-q="runs"]')), "the panel redraws without taking the focus from the search"); await ctx.close(); }

  // ======== every other page: toolbar, a search, a facet, paging; screenshots ========
  const pages = [
    ["workflows", "#/workflows", "[data-wf]", "Video", "kind", wfList.length],
    ["skills", "#/skills", "[data-skill]", "reviewer", "source", skills.length],
    ["projects", "#/projects", "[data-project-card]", "billing", "kind", projects.length],
    ["crew", "#/crew", "[data-actor]", "Cleo", "phase", crew.length],
    ["terminals", "#/terminals", "[data-term-row]", "tests", "state", terms.length],
    ["library", "#/library", "[data-artifact],[data-pr]", "Intro", "type", arts.length + code.length],
    ["room", "#/room", "[data-room-row]", "webhook", "zone", rooms.length]];
  for (const [list, hash, rowSel, word, facet, total] of pages) {
    const { p, ctx } = await open("zh-TW");
    await go(p, hash, list);
    ok(await count(p, list) === `共 ${total} 條` && (await p.$$(`[data-lt-region="${list}"] :is(${rowSel})`)).length === 25 && await range(p, list) === `第 1–25 條，共 ${total} 條`, `${list}: every row counted, 25 a page`, `${await count(p, list)} ${await range(p, list)}`);
    await shot(p, `${list}-toolbar-1440-zh`);
    await type(p, list, word);
    const n = await p.$$eval(`[data-lt-region="${list}"] :is(${rowSel})`, (es) => es.length);
    ok(n > 0 && n <= 25 && Number(/條中 (\d+) 條符合/.exec(await count(p, list))?.[1]) < total, `${list}: a search narrows the list`, `${n} ${await count(p, list)}`);
    ok(list === "library" && n && (await p.$$(`[data-lt-region="${list}"] [data-pr]`)).length ? true : (await p.$$(`[data-lt-region="${list}"] mark.lt-mark`)).length > 0, `${list}: the word is marked`);
    await shot(p, `${list}-filtered-1440-zh`);
    await type(p, list, "");
    await p.click(`[data-lt-facet="${facet}"]`); await p.waitForSelector(`[data-lt-pop="${facet}"]`);
    const opts = await p.$$eval(`[data-lt-pop="${facet}"] label`, (es) => es.map((e) => Number(e.querySelector(".num").textContent)));
    ok(opts.length > 1 && opts.reduce((a, b) => a + b, 0) >= total, `${list}: the ${facet} popover lists its values with counts`, JSON.stringify(opts));
    await shot(p, `${list}-facet-1440-zh`);
    await p.click(`[data-lt-pop="${facet}"] label input`); await p.waitForTimeout(100);
    ok(await count(p, list) === `${total} 條中 ${opts[0]} 條符合`, `${list}: ticking the first value leaves its count`, await count(p, list));
    await p.keyboard.press("Escape");
    await p.focus(`[data-lt-q="${list}"]`); await p.keyboard.type(`${facet}:`); await p.waitForTimeout(150);
    ok((await p.$$("[data-lt-sug]")).length > 0, `${list}: ${facet}: suggests values`); await shot(p, `${list}-suggest-1440-zh`);
    await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
    await type(p, list, "zzzz-nothing"); ok(!!await p.$(`[data-lt-empty="${list}"]`), `${list}: the empty state`); await shot(p, `${list}-empty-1440-zh`);
    await p.click(`[data-lt-reset="${list}"]`); await p.waitForTimeout(100);
    if (total > 25) { await p.click(`[data-lt-next="${list}"]`); await p.waitForTimeout(100); ok(await range(p, list) === `第 26–${Math.min(50, total)} 條，共 ${total} 條` && (await hashQ(p)).get("page") === "2", `${list}: next page`, await range(p, list)); await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.$eval("#main", (m) => { m.scrollTop = m.scrollHeight; }); await shot(p, `${list}-paging-1440-zh`); }
    await ctx.close();
  }
  // Crew: while the captain types in the search, the 3 s poll goes on and new rounds come in place
  { const { p, ctx } = await open("en"); await go(p, "#/crew", "crew");
    await type(p, "crew", "Zed"); ok(!!await p.$('[data-lt-empty="crew"]'), "Crew: no round named Zed yet");
    crew.unshift({ ...crew[0], actor: "worker-new", name: "Zed", alive: true, phase: "building" });
    const came = await p.waitForSelector('[data-actor="worker-new"]', { timeout: 9000 }).then(() => true, () => false);
    ok(came && await p.evaluate(() => document.activeElement?.matches('[data-lt-q="crew"]')) && await p.$eval('[data-lt-q="crew"]', (e) => e.value) === "Zed", "a round that starts while the search box has the focus shows up, the focus and the text stay");
    crew.shift(); await ctx.close(); }
  // the Agent rounds panel says when it cannot read the rounds (never "none yet")
  { const { p, ctx } = await open("en"); await ctx.route((u) => u.pathname === "/api/node-runs", (r) => r.fulfill({ status: 500, json: { error: "x" } }));
    await go(p, "#/runs", "runs"); ok(await p.waitForSelector('[data-node-runs-error]', { timeout: 9000 }).then(() => true, () => false) && !/No agent rounds yet/.test(await p.$eval('[data-section="node-runs"]', (e) => e.textContent)), "a failed read of the rounds says so");
    await ctx.close(); }
  // the review room: zones kept under 按區, the old search attribute kept, archived opens while filtering
  { const { p, ctx } = await open("en"); await go(p, "#/room", "room");
    ok(JSON.stringify(await p.$$eval("[data-room-zone]", (es) => [...new Set(es.map((e) => e.dataset.roomZone))])) === '["waiting","reviewing"]' || (await p.$$("[data-room-zone]")).length >= 1, "Review room: a page's rooms in their zones");
    await p.fill("[data-room-search]", "#1"); await p.waitForTimeout(120);
    ok(await p.$$eval('[data-room-zone="archived"]', (es) => es.every((e) => e.open)), "while filtering, 封存 is open");
    await p.selectOption('[data-lt-sort="room"]', "new"); await p.waitForTimeout(100); ok(!await p.$("[data-room-zone]") && (await p.$$("[data-room-row]")).length > 0, "sorted by time: one list, no zones"); await ctx.close(); }

  // ======== Inbox: the toolbar filters the left list; j/k move among the matches ========
  { const { p, ctx } = await open("en"); await go(p, "#/inbox", "inbox");
    const studioRows = async () => p.$$eval('[data-inbox-row][data-inbox-source="studio"]', (es) => es.map((e) => e.dataset.inboxRow));
    ok((await studioRows()).length === 25 && /of \d+$/.test(await range(p, "inbox")), "Inbox: 25 cards a page under the toolbar", await range(p, "inbox"));
    await shot(p, "inbox-toolbar-1440-en");
    await p.click('[data-lt-facet="kind"]'); await p.waitForSelector('[data-lt-pop="kind"]'); await shot(p, "inbox-facet-1440-en");
    await p.click('[data-lt-opt="kind=merge"]'); await p.waitForTimeout(150); await p.keyboard.press("Escape"); await p.waitForTimeout(80);
    ok(!await p.$("[data-lt-pop]"), "Escape closes the Inbox's popover (its toolbar sits above the list)");
    const merges = scards.filter((c) => c.kind === "merge").map((c) => c.id);
    const rows = await studioRows();
    ok(rows.length === merges.length && rows.every((id) => merges.includes(id)), "a kind ticked: only those cards in the list", JSON.stringify(rows));
    const shown = await p.$eval("[data-inbox-head]", (e) => e.dataset.inboxHead);
    ok(merges.includes(shown) && (await p.evaluate(() => location.hash)).includes("kind=merge"), "the card shown is a match (the first one), and the URL keeps the filter", shown);
    await p.focus(`[data-inbox-row="${shown}"]`); await p.keyboard.press("j"); await p.waitForTimeout(150);
    const next = await p.$eval("[data-inbox-head]", (e) => e.dataset.inboxHead);
    ok(next === merges[merges.indexOf(shown) + 1], "j moves to the next match, skipping the cards filtered out", `${shown} -> ${next}`);
    ok((await p.evaluate(() => location.hash)).startsWith(`#/inbox/${next}?`) && (await p.evaluate(() => location.hash)).includes("kind=merge"), "the card's address keeps the toolbar's query");
    await shot(p, "inbox-filtered-1440-en");
    await p.click(`[data-lt-chip="kind=merge"] button`); await p.waitForTimeout(120);
    await type(p, "inbox", "软件"); ok(JSON.stringify(await studioRows()) === '["SC-905"]' && await p.$eval("[data-inbox-head]", (e) => e.dataset.inboxHead) === "SC-905", "a Simplified word finds a card with a Traditional title, and it is the one shown");
    await type(p, "inbox", "nothing like this"); ok(!!await p.$('[data-lt-empty="inbox"]') && !await p.$("[data-inbox-head]"), "nothing matches: the empty card, no card shown"); await shot(p, "inbox-empty-1440-en");
    await p.focus('[data-lt-q="inbox"]'); await p.fill('[data-lt-q="inbox"]', ""); await p.keyboard.type("kind:"); await p.waitForTimeout(150);
    ok((await p.$$("[data-lt-sug]")).length === 4, "kind: suggests the four kinds"); await shot(p, "inbox-suggest-1440-en");
    await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
    await p.goto(`${base}/#/inbox/SC-940`); await p.waitForSelector("[data-inbox-head]"); await p.waitForTimeout(200);
    ok(await p.$eval("[data-inbox-head]", (e) => e.dataset.inboxHead) === "SC-940" && /^26–/.test(await range(p, "inbox")) && !!await p.$('[data-inbox-row="SC-940"].on'), "a link to a card deep in the list opens the page that holds it", await range(p, "inbox"));
    await shot(p, "inbox-paging-1440-en"); await ctx.close(); }

  // ======== Activity: the server pages and counts the whole log ========
  { const { p, ctx } = await open("en"); await go(p, "#/activity", "activity");
    const total = await p.evaluate(() => fetch("/api/activity?page=1&size=25").then((r) => r.json()).then((j) => j.total));
    ok(total > 150 && await count(p, "activity") === `${total} in all` && await range(p, "activity") === `1–25 of ${total}`, "Activity: every event counted, paged by the server (no 150 cap)", `${total} ${await count(p, "activity")}`);
    await shot(p, "activity-toolbar-1440-en");
    await p.click('[data-lt-page]:not([aria-current]):not([disabled])'); await p.waitForTimeout(300);
    ok(await range(p, "activity") === `26–50 of ${total}`, "page 2 comes from the server");
    await p.click('[data-lt-page="1"]'); await p.waitForTimeout(300); ok(!(await p.$$(".ev.new")).length, "back on page 1 nothing is marked new: only a live refresh marks rows");
    await p.click('[data-lt-page="2"]'); await p.waitForTimeout(300);
    await p.click('[data-lt-facet="type"]'); await p.waitForSelector('[data-lt-pop="type"] label');
    const [tv, tn] = await p.$eval('[data-lt-pop="type"] label', (e) => [e.querySelector("input").dataset.ltOpt.slice(5), Number(e.querySelector(".num").textContent)]);
    await shot(p, "activity-facet-1440-en");
    await p.click('[data-lt-pop="type"] label input'); await p.waitForTimeout(400);
    ok(await count(p, "activity") === `${tn} of ${total} match` && (await p.$$eval(".ev .evt", (es, t) => es.every((e) => e.textContent === t), tv)), "a type ticked: its count is what the server finds, every row of that type", `${tv} ${tn} ${await count(p, "activity")}`);
    await p.keyboard.press("Escape");
    const word = await p.$eval(".ev span:nth-child(3)", (e) => e.textContent.split(/\s+/).find((w) => w.length > 4) || "a");
    await type(p, "activity", word); await p.waitForTimeout(400);
    ok(/\d+ of \d+ match/.test(await count(p, "activity")) && (await p.$$(".ev mark.lt-mark")).length > 0, "a free word searches the summaries on the server and is marked", word);
    await shot(p, "activity-filtered-1440-en");
    await p.goto(`${base}/#/activity/T-nope`); await p.waitForSelector('[data-lt="activity"] [data-lt-count]'); await p.waitForTimeout(400);
    ok(await p.evaluate(() => location.hash) === "#/activity?task=T-nope" && !!await p.$('[data-lt-empty="activity"]'), "#/activity/<task> is the task facet; nothing for it says so");
    await shot(p, "activity-empty-1440-en"); await ctx.close(); }

  // ======== 390: no sideways scroll, the popover fits ========
  { const { p, ctx } = await open("zh-TW", 390); await go(p, "#/runs", "runs");
    await p.click('[data-lt-facet="workflow"]'); await p.waitForSelector('[data-lt-pop="workflow"]');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "at 390 the page does not scroll sideways", await p.evaluate(() => `${document.documentElement.scrollWidth}`));
    await p.screenshot({ path: join(shots, "tasks-facet-390-zh.png"), fullPage: false }); await ctx.close(); }
  ok(!errors.length, "no page error", errors.join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\nlist-tools-ui: ${pass} passed, ${fail} failed (screenshots: ${shots})`); process.exit(fail ? 1 : 0);
