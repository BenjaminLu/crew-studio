import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Board after a live release (W34), at 1440 with the Firstmate panel open and at 390, in English and 繁體中文:
//  S28 the header read "2 tasks, 0 crew on duty, — today" and showed "GitHub off" while money-kit was connected to GitHub
//      with a verified grant: the line ends at the crew when no cost was recorded, and the chip counts the connected
//      projects ("GitHub · 1 project"), or is not shown; it never says off while a project's grant verifies.
//  S29 a dispatched Firstmate proposal had a row of its own beside the Task it started ("R-093 · Firstmate proposal ·
//      74234e98afe…", "Proposal dispatched") and counted in Done today: it folds into that Task, which names it; a proposal
//      shows as a row only while it waits for approval or when it closed without starting; no raw hash anywhere.
// Studio runs and cards come from tests/fixture/board plus the proposals below; the sidebar's projects through a route
// (the connected flag itself is src/project-overview.ts, tested in tests/project-overview.ts). Offline: stub providers only.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { boardFixture, routeBoardFixture } from "./fixture/board/studio.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-board-live-ui-"));
const home = join(tmp, "home"), data = join(tmp, "data"), state = join(tmp, "state"), proj = join(tmp, "proj");
for (const d of [home, data, state, proj, join(home, ".codex")]) mkdirSync(d, { recursive: true });
const TOKEN = "board-live-ui", shots = process.env.BOARD_LIVE_SHOTS;
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CREW_PAGE_RELEASE"]) delete env[k];
let pass = 0, fail = 0, browser, app; const errors = [];
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const seen = async (p, sel, timeout = 10000) => { try { await p.locator(sel).first().waitFor({ timeout }); return true; } catch { return false; } };

// ---- the fixture: no job reported a cost; three Firstmate proposals ----
const now = Date.now(), at = (min) => new Date(now - min * 60000).toISOString(), HASH = "74234e98afe" + "0123456789abcdef".repeat(3) + "01234";
const fx = boardFixture(now);
for (const r of Object.values(fx.details)) for (const n of Object.values(r.nodes)) for (const j of n?.data?.jobs || []) j.cost = null;
const PDEF = { id: "firstmate-proposal", name: "Firstmate proposal", kind: "firstmate-proposal", version: 1, params: {}, roles: [],
  nodes: [{ id: "dispatch", kind: "hook", label: "Captain dispatch" }, { id: "launch", kind: "hook", label: "Start approved workflow" }, { id: "done", kind: "hook", label: "Dispatched" }, { id: "closed", kind: "hook", label: "Closed without work" }],
  edges: [{ from: "dispatch", to: "launch", when: "approve" }, { from: "dispatch", to: "closed", when: "close" }, { from: "launch", to: "done", when: "ok" }] };
const node = (state, o = {}) => ({ state, visits: state === "pending" ? 0 : 1, extra: 0, attempt: 0, outcome: state === "passed" ? "ok" : null, cause: null, error: null, startedAt: null, endedAt: null, inbox: [], agent: null, swap: null, job: null, card: null, waiting: null, ...o });
const proposal = (id, title, status, nodes, o = {}) => ({ id, workflow: "firstmate-proposal", version: 1, def: PDEF, title, text: title,
  params: { source: HASH, target: JSON.stringify({ workflow: "images", version: 4, title, text: title }), definition: HASH, project: HASH }, by: "firstmate", status, result: o.result ?? null,
  createdAt: at(o.min ?? 30), updatedAt: o.endedAt ?? at(1), endedAt: o.endedAt ?? null, error: null, nodes, queue: [], steps: [], ctx: o.ctx ?? {}, classifier: null, events: [], recovered: 0, cards: [], ledger: [], ledgerOk: true, crew: null, done: [] });
// R-120 started R-121 (the images Task; here a copy of R-101's shape): folded into it
fx.details["R-120"] = proposal("R-120", "轉角書店方形社群海報", "succeeded", { dispatch: node("passed"), launch: node("passed"), done: node("passed"), closed: node("pending") }, { endedAt: at(20), ctx: { childRun: "R-121" } });
fx.details["R-121"] = { ...structuredClone(fx.details["R-101"]), id: "R-121", title: "轉角書店方形社群海報", params: { _firstmateProposal: "R-120", _firstmateDefinition: HASH, _crewTeam: HASH }, ctx: {} };
// R-122 waits for the captain's approval; R-123 was closed without starting anything
fx.details["R-122"] = proposal("R-122", "轉角書店書籤設計", "waiting", { dispatch: node("running", { waiting: "card" }), launch: node("pending"), done: node("pending"), closed: node("pending") }, { min: 5 });
fx.details["R-123"] = proposal("R-123", "被關掉的提案", "succeeded", { dispatch: node("passed", { outcome: "close" }), launch: node("pending"), done: node("pending"), closed: node("passed") }, { result: "closed", endedAt: at(15) });
const projects = (connected) => ({ projects: [
  { id: "money-kit", name: "money-kit", enabled: true, kind: "external", connected, folderMissing: false, canStart: true, attention: 0, running: 1, held: 0,
    status: connected ? { tone: "", en: "GitHub · acme/money-kit · 1 running", tw: "GitHub · acme/money-kit · 1 進行中" } : { tone: "warn", en: "GitHub: grant does not verify", tw: "GitHub：授權驗證不過" } },
  { id: "studio", name: "Studio", enabled: true, kind: "studio", attention: 0, running: 0, held: 0, status: { tone: "", en: "idle", tw: "閒置" } }] });

try {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data,
    CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_LOCAL_UNRESTRICTED: "0",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs") } });
  app.stdout.resume(); app.stderr.resume(); await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  for (const [width, lang] of [[1440, "en"], [1440, "zh-TW"], [390, "en"], [390, "zh-TW"]]) {
    const tag = `${width}-${lang}`, en = lang === "en", wide = width > 500;
    const ctx = await browser.newContext({ viewport: { width, height: wide ? 900 : 844 } });
    await ctx.addInitScript(({ lang, open }) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.chatOpen", open); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, { lang, open: wide ? "1" : "0" });
    await routeBoardFixture(ctx, fx);
    let connected = true;
    await ctx.route(/\/api\/projects\/overview$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projects(connected)) }));
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
    await p.goto(base + "/#/board");
    ok(await seen(p, "#tb-R-121"), `${tag}: the Board lists its Tasks`);
    if (wide) ok(await p.locator("#chatLog").isVisible(), `${tag}: the Firstmate panel is open beside the Board`);
    // S28: the header line and the GitHub chip
    await p.waitForFunction(() => /crew on duty|船員值班/.test(document.querySelector("#boardSub")?.textContent || ""), {}, { timeout: 10000 }).catch(() => {});
    const sub = (await p.textContent("#boardSub"))?.trim() || "";
    ok(en ? /^\d+ tasks?, \d+ crew on duty$/.test(sub) : /^\d+ 個任務、\d+ 位船員值班$/.test(sub), `${tag}: with no cost recorded the line ends at the crew (no "— today")`, sub);
    ok(await seen(p, '[data-gh="projects"]'), `${tag}: the GitHub chip shows the connected project`);
    const chip = (await p.locator('[data-gh="projects"]').first().innerText().catch(() => "")).trim();
    ok(chip === (en ? "GitHub · 1 project" : "GitHub · 1 個專案"), `${tag}: it says GitHub and how many projects are connected`, chip);
    ok(!/GitHub off|GitHub 未啟用/.test(await p.locator("body").innerText()), `${tag}: nothing says GitHub is off while a project's grant verifies`);
    // S29: one row per piece of work
    ok(await p.locator("#tb-R-120").count() === 0, `${tag}: a dispatched proposal has no row of its own`);
    const meta = (await p.locator("#tb-R-121 .tb-meta").innerText().catch(() => "")) || "";
    ok(meta.includes(en ? "from Firstmate's proposal R-120" : "來自 Firstmate 的提案 R-120"), `${tag}: the Task it started names the proposal`, meta);
    ok(await p.locator("#tb-R-122").count() === 1 && await p.locator("#tb-R-122").getAttribute("data-group") === "you", `${tag}: a proposal waiting for approval keeps its row, waiting for you`);
    ok(await p.locator("#tb-R-123").count() === 1 && await p.locator("#tb-R-123").getAttribute("data-group") === "done", `${tag}: a proposal closed without starting keeps its row`);
    const done = Number(await p.locator('[data-tb-tab="done"] .tb-count').innerText()), doneRows = await p.locator('.tb-row[data-group="done"]').count();
    ok(done === doneRows && !(await p.locator('.tb-row[data-group="done"]').evaluateAll((els) => els.map((e) => e.dataset.task))).includes("R-120"), `${tag}: Done today counts the rows shown, not the folded proposal`, `${done} vs ${doneRows}`);
    const text = await p.locator("main, #main, body").first().innerText();
    ok(!/[0-9a-f]{11,}/i.test(text.replace(/R-\d+/g, "")), `${tag}: no raw hash shows on the Board`, (text.match(/[0-9a-f]{11,}/i) || [""])[0]);
    // the path panel of the started Task names the proposal too
    if (wide) { await p.locator("#tb-R-121").click(); }
    else { await p.locator("#tb-R-121").click(); }
    ok(await seen(p, '[data-task-detail="R-121"]') && (await p.locator('[data-task-detail="R-121"] .tb-d-meta').innerText()).includes(en ? "from Firstmate's proposal R-120" : "來自 Firstmate 的提案 R-120"), `${tag}: the Task's path panel names the proposal`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: nothing scrolls the page sideways`);
    if (shots) { mkdirSync(shots, { recursive: true }); await p.screenshot({ path: join(shots, `${tag}.png`) }); }
    // no project connected and Studio's own poller off: no chip at all
    if (width === 1440 && en) {
      connected = false; await p.reload(); await seen(p, "#tb-R-121");
      await p.waitForTimeout(600);
      ok(await p.locator(".ghbar").count() === 0 && !/GitHub off|GitHub 未啟用/.test(await p.locator("body").innerText()), `${tag}: with no project connected the chip is not shown (never "GitHub off")`);
    }
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { ok(false, "the UI run finished", String(e?.stack ?? e).slice(0, 800)); }
finally { await browser?.close().catch(() => {}); app?.kill("SIGTERM"); }
console.log(`board-live-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
