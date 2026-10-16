import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Board (docs/units/board.md): every run in flight in parallel with its stage
// pipeline, the decisions waiting on the captain answered in place, the crew on duty;
// the Inbox decisions only. Studio runs and cards come from tests/fixture/board (three
// runs in parallel: build round 2, waiting on the merge card, failed at CI); firstmate's
// tasks and cards from a temp copy of tests/fixture/state, answers through a mock board.
// Screenshots at 1440 and 390, light and dark, beside the prototype's Board.
//   node tests/board-ui.mjs
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { boardFixture, routeBoardFixture } from "./fixture/board/studio.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("board-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-board-ui-"));
const state = join(tmp, "fm", "state"); // fm's root (tmp/fm) is protected: Studio's data and worktrees live beside it, never inside
mkdirSync(join(tmp, "fm"), { recursive: true }); cpSync(join(here, "fixture/state"), state, { recursive: true });
const now = Date.now() / 1000;
for (const r of readdirSync(join(state, "runs"))) utimesSync(join(state, "runs", r), now, now);
const reviewer = readdirSync(join(state, "runs")).find((r) => r.startsWith("reviewer-"));
writeFileSync(join(state, "runs", reviewer, "process.json"), JSON.stringify({ actor: reviewer, pid: process.pid })); // one firstmate round is live
// a one-way firstmate merge card with the door confirmation (the board's own check), answered from the Board
const oneway = (zh) => ({ title: "MERGE CARD — merge PR #902: rename the price column", explanation: "Review approved; CI green on this head.",
  intent: [{ kind: "fact", text: "The price column is renamed." }, { kind: "fact", text: "Readers move to the new name." }], why: [{ kind: "fact", text: "Two names for one value confused the report." }],
  door: { kind: "one-way", reason: "Other services read the old name.", rollback: "A new migration adds the old name back." },
  check: { q: "What changes after the merge?", options: ["Nothing", "The column name"] },
  options: { A: { description: "Merge #902" }, B: { description: "Hold the merge" } } });
writeFileSync(join(state, "pending", "D-board-oneway.json"), JSON.stringify({ id: "D-board-oneway", kind: "merge", task: "T-306", pr: 902, ts: new Date().toISOString(), title: oneway().title, details: { en: oneway(), "zh-TW": oneway() } }));
mkdirSync(join(tmp, "data"));
writeFileSync(join(tmp, "data", "intents.jsonl"), JSON.stringify({ id: "I-001", ts: new Date().toISOString(), goal: "Add a price filter", details: "", constraints: null, deadline: null, budget: null, text: "Add a price filter", status: "received", source: "chat" }) + "\n");

const secret = "ef".repeat(32);
writeFileSync(join(tmp, "board.secret"), secret + "\n");
const received = [];
const mock = createServer((req, res) => { let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
  const b = body ? JSON.parse(body) : null; received.push({ path: req.url, body: b });
  if (req.url === "/decisions/check-door") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(b.check_answer === 1 ? { ok: true, id: b.id } : { ok: false, code: "doorUnconfirmed", why: "Not that one." })); }
  // the board refuses one card the way it refuses a stale answer
  if (b?.id === "D-fixture-door-check") { res.writeHead(409, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "this card was already answered on the board" })); }
  // a slow board: a second click lands while the first answer is still in flight
  setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); }, 400);
}); });
await new Promise((r) => mock.listen(0, "127.0.0.1", r));

const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "0", CREW_DATA: join(tmp, "data"),
  CREW_BOARD_URL: `http://127.0.0.1:${mock.address().port}`, CREW_BOARD_SECRET: join(tmp, "board.secret"), CREW_RECENT_DAYS: "3650",
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = join(root, "tests/out/board"); mkdirSync(shots, { recursive: true });
// the approved prototype, saved as served; shown with Studio's own vendored IBM Plex (the test has no network)
const PROTO = join(here, "fixture/board/prototype.html"), PB = "http://127.0.0.1:9";
const serveProto = (ctx) => ctx.route(`${PB}/**`, (r) => { const u = new URL(r.request().url());
  if (u.pathname === "/proto.html") return r.fulfill({ status: 200, contentType: "text/html", body: readFileSync(PROTO, "utf8").replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '<link rel="stylesheet" href="/fonts.css">') });
  const f = join(root, "public", u.pathname); if (!existsSync(f)) return r.fulfill({ status: 404, body: "" });
  return r.fulfill({ status: 200, contentType: f.endsWith(".css") ? "text/css" : "font/woff2", body: readFileSync(f) }); });
const seen = (p, sel, timeout = 8000) => p.waitForSelector(sel, { timeout }).then(() => true, () => false);
const summary = await fetch(`${base}/api/summary`).then((r) => r.json());
const fmTasks = summary.tasks.filter((t) => t.status !== "done" && t.status !== "idle");
const fmLive = summary.crew.filter((c) => c.alive);

// the fixture's clock: noon tomorrow, local time (a day the real clock is not on, so a Board that reads the real clock fails);
// the page's clock is pinned to the same instant, so "today" never depends on when the suite runs
const PIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return d.getTime(); })();
async function open(width, scheme, fx) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme });
  await ctx.clock.setFixedTime(PIN); await ctx.addInitScript((t) => { window.crewClock = () => t; }, PIN); // the Board's clock seam, and the page's Date, at the same instant
  await ctx.addInitScript(() => { const ES = window.EventSource; window.__streams = 0; window.EventSource = class extends ES { constructor(...a) { super(...a); window.__streams++; window.__es = this; } }; });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await routeBoardFixture(ctx, fx);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`));
  let streams = 0; p.on("request", (r) => { if (new URL(r.url()).pathname === "/api/stream") streams++; });
  p.streams = () => streams;
  return { ctx, p };
}
const segs = (p, id) => p.$$eval(`[data-run="${id}"] .pipe i`, (is) => is.map((i) => i.className.replace(/\s*pulse\s*/, "").trim()));

try {
  // ---------- 1440 light: the behaviour ----------
  { const fx = boardFixture(PIN); const { ctx, p } = await open(1440, "light", fx);
    await p.goto(`${base}/`); await seen(p, '[data-run="R-101"]', 10000);
    const views = await p.$$eval(".nav > .nav-item", (bs) => bs.filter((b) => !b.hidden && getComputedStyle(b).display !== "none").map((b) => b.dataset.view));
    ok(p.url().endsWith("#/board") && views[0] === "board" && JSON.stringify(views) === JSON.stringify(["board", "firstmate", "inbox", "crew", "runs", "workflows", "library"]), "home is the Board, first in the sidebar", `${p.url()} ${JSON.stringify(views)}`);

    // every run in flight, Studio and firstmate, one row each, with its segments
    const rows = await p.$$eval("[data-run]", (rs) => rs.map((r) => r.dataset.run));
    const want = ["R-101", "R-102", "R-103", "R-104", ...fmTasks.map((t) => t.id)];
    ok(want.every((id) => rows.includes(id)) && rows.length === want.length && !rows.includes("R-090") && !rows.includes("R-091"), "the Board lists every parallel run (four Studio runs and the firstmate tasks in flight, not a finished run)", JSON.stringify({ rows, want }));
    const s1 = await segs(p, "R-101"), s2 = await segs(p, "R-102"), s3 = await segs(p, "R-103");
    ok(JSON.stringify(s1) === JSON.stringify(["done", "done", "done", "running", "", "", ""]) && JSON.stringify(s2) === JSON.stringify(["done", "done", "done", "done", "human", "", ""])
      && JSON.stringify(s3) === JSON.stringify(["done", "done", "done", "failed", "", "", ""]) && JSON.stringify(await segs(p, "R-104")) === JSON.stringify(["done", "human", "", "", "", "", ""]), "the Board lists every parallel run with the correct segment states", JSON.stringify({ s1, s2, s3 }));
    ok(await p.locator('[data-run="R-101"] .pipe i.running.pulse').count() === 1, "the running segment pulses");
    const titles = await p.$$eval('[data-run="R-101"] .pipe i', (is) => is.map((i) => i.title));
    ok(titles[3]?.startsWith("Build loop") && titles[0]?.startsWith("Intake") && titles[6]?.startsWith("After merge"), "segments are the workflow's stages (graph-layout's grouping)", JSON.stringify(titles));
    for (const t of fmTasks) { const s = await segs(p, t.id);
      ok(s.length === 7 && s.some((x) => ["running", "human", "failed"].includes(x)) , `the firstmate task ${t.id} has a seven-stage pipeline with its current stage marked`, JSON.stringify(s)); }
    for (const t of fmTasks.filter((x) => x.round && ["build", "ci", "review"].includes(x.node))) { const l = (await p.textContent(`[data-run="${t.id}"] .pipe-l`)).trim();
      ok(l.endsWith(`Build loop · round ${t.round}`), `the firstmate label shows its round (${t.id})`, l); }
    ok(fmTasks.some((x) => x.round && ["build", "ci", "review"].includes(x.node)), "the fixture has a firstmate task in its build loop with a round");
    const l1 = (await p.textContent('[data-run="R-101"] .pipe-l')).trim(), l2 = (await p.textContent('[data-run="R-102"] .pipe-l')).trim(), l3 = (await p.textContent('[data-run="R-103"] .pipe-l')).trim();
    ok(l1 === "4/7 Build loop · round 2/3" && l2 === "5/7 Gates" && l3 === "4/7 Build loop · round 1/3", "the label shows stage and round", JSON.stringify([l1, l2, l3]));
    // row details and the subtitle
    const badge = async (id) => (await p.textContent(`[data-run="${id}"] .badge`)).trim();
    const ava = await p.locator('[data-run="R-101"] .c-crew .ava').first().getAttribute("title");
    const spend = (await p.textContent('[data-run="R-101"] .c-cost')).trim(), el = (await p.textContent('[data-run="R-101"] .c-el')).trim();
    const sub = (await p.textContent("#boardSub")).trim();
    const crewN = 1 + fmLive.length;
    ok(await badge("R-101") === "Running" && await badge("R-102") === "Waiting for you" && await badge("R-103") === "Failed" && /codex/.test(ava) && /gpt-5\.5/.test(ava)
      && spend.startsWith("$1.51") && /^4[45]m \d\ds$/.test(el) && await p.locator('[data-run="R-102"] .c-crew .ava').count() === 0
      && sub === `${want.length} tasks, ${crewN} crew on duty, $5.52 today`, "row details and subtitle: badge, crew with vendor and model, spend, elapsed; real counts; today's spend over every run that ran today (R-091 finished today: its $1.00 counts)", JSON.stringify({ ava, spend, el, sub, crewN }));
    ok(/CI failed: 2 of 14 tests fail/.test(await p.textContent('[data-run="R-103"] + .err, [data-run="R-103"] .err').catch(() => "")), "a failed run shows its error under the row");
    ok(await p.locator("[data-crew-strip] .ava").count() === crewN, "Crew on duty shows every live agent across the runs", String(await p.locator("[data-crew-strip] .ava").count()));

    // Needs you: exactly the decisions waiting
    const needs = await p.$$eval("[data-need]", (rs) => rs.map((r) => r.dataset.need).sort());
    const wantNeeds = ["SC-201", "SC-202", ...summary.pending.map((c) => c.id)].sort();
    ok(JSON.stringify(needs) === JSON.stringify(wantNeeds) && (await p.textContent("#needsCount")).trim() === String(wantNeeds.length), "Needs you lists exactly the waiting decisions", JSON.stringify({ needs, wantNeeds }));
    const nrow = (await p.textContent('[data-need="SC-201"]'));
    ok(/R-102/.test(nrow) && /merge/i.test(nrow) && /no minor unit/.test(nrow) && /m ago/.test(nrow), "a Needs you row shows its run, kind, a one-line why and its age", nrow);
    await p.screenshot({ path: join(shots, "board-before-answer-1440-light.png"), fullPage: true });

    // a live event updates one row, without a reload
    await p.evaluate(() => { window.__marker = 1; document.querySelectorAll("[data-run]").forEach((r) => { r.__tag = r.dataset.run; }); });
    const rq = []; p.on("request", (r) => { const u = new URL(r.url()); if (/^\/api\/(wruns|summary)/.test(u.pathname)) rq.push(u.pathname); });
    fx.details["R-101"].nodes.build.state = "passed";
    Object.assign(fx.details["R-101"].nodes.ci, { state: "running", visits: 2 });
    const nodes = Object.fromEntries(Object.entries(fx.details["R-101"].nodes).filter(([, n]) => n).map(([k, n]) => [k, { state: n.state, visits: n.visits, outcome: n.outcome, waiting: n.waiting }]));
    await p.evaluate((d) => window.__es.dispatchEvent(new MessageEvent("wrun", { data: JSON.stringify(d) })), { id: "R-101", status: "running", event: { seq: 41, ts: new Date().toISOString(), type: "node", node: "ci", from: "pending", to: "running" }, nodes });
    await p.waitForTimeout(700);
    const same = await p.evaluate(() => ({ marker: window.__marker, others: [...document.querySelectorAll("[data-run]")].filter((r) => r.dataset.run !== "R-101").every((r) => r.__tag === r.dataset.run) }));
    const ci = await p.$eval('[data-run="R-101"] .pipe i:nth-child(4)', (i) => i.title);
    ok(same.marker === 1 && same.others && /ci/i.test(ci) && rq.filter((u) => u !== "/api/wruns/agents").every((u) => u === "/api/wruns/R-101") /* the Crew page's agent list (crew-studio-agents) follows wrun too */, "a live event updates one row without reload", JSON.stringify({ same, ci, rq }));
    // a firstmate row follows its task's events live
    { const t = fmTasks.find((x) => ["build", "ci", "review"].includes(x.node)) || fmTasks[0];
      appendFileSync(join(state, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), actor: "firstmate", type: "gate_passed", task: t.id, summary: { en: "gates passed", "zh-TW": "關卡通過" } }) + "\n");
      ok(await p.waitForFunction((id) => /^5\/7 Gates/.test(document.querySelector(`[data-run="${id}"] .pipe-l`)?.textContent || ""), t.id, { timeout: 8000 }).then(() => true, () => false)
        && await p.evaluate(() => window.__marker === 1), `a firstmate row updates live, without a reload (${t.id} moves to Gates)`); }
    ok(p.streams() === 1 && await p.evaluate(() => window.__streams) === 1, "one stream connection", String(p.streams()));

    // a click opens the run
    await p.click('[data-run="R-103"] .run-t'); await p.waitForTimeout(200);
    ok(p.url().endsWith("#/run/R-103"), "a click on a row opens the run view", p.url());
    await p.goto(`${base}/#/board`); await seen(p, '[data-need="SC-201"]');

    // answer a Studio card in place: a refusal shows inline, then the answer goes and the row leaves
    await p.click('[data-need="SC-201"] [data-need-open]');
    ok(await seen(p, '[data-need-card="SC-201"] [data-option="merge"]'), "Answer expands the card in place, with its options");
    ok(p.url().endsWith("#/board"), "expanding a card does not navigate", p.url());
    await p.screenshot({ path: join(shots, "board-card-open-1440-light.png"), fullPage: true });
    await p.click('[data-need-card="SC-201"] [data-option="changes"]');
    ok(await p.waitForFunction(() => /say what to change/.test(document.querySelector('[data-need-card="SC-201"]')?.innerText || ""), null, { timeout: 4000 }).then(() => true, () => false), "a refusal shows inline (the server's reason)");
    // the card was answered Merge elsewhere meanwhile (another tab): answering Merge again shows as answered, not refused
    Object.assign(fx.open[0], { status: "answered", answer: { choice: "merge", note: null, by: "captain (another tab)", at: new Date().toISOString(), confirm: null } });
    const calls0 = fx.calls();
    { let release; const held = new Promise((r) => (release = r));
      await p.route(/\/api\/scards\/SC-201\/answer$/, async (r) => { await held; const [st, b] = fx.answer("SC-201", JSON.parse(r.request().postData() || "{}")); await r.fulfill({ status: st, contentType: "application/json", body: JSON.stringify(b) }); }); // every answer to SC-201 goes through here until the count below
      await p.click('[data-need-card="SC-201"] [data-option="merge"]'); await p.waitForTimeout(150);
      ok(await p.$$eval('[data-need-card="SC-201"] [data-option]', (bs) => bs.length > 0 && bs.every((b) => b.disabled)), "a Studio card's options are disabled while its answer is in flight");
      await p.click('[data-need-card="SC-201"] [data-option="merge"]', { timeout: 1000, force: true }).catch(() => {});
      release(); }
    ok(await p.waitForFunction(() => !document.querySelector('[data-need="SC-201"]') && /Merge ✓/.test(document.querySelector('[data-answered="SC-201"]')?.textContent || ""), null, { timeout: 5000 }).then(() => true, () => false),
      "a Studio card already answered with the same choice shows as answered: Merge ✓ inline, and the row leaves Needs you", await p.textContent(".needs"));
    await p.waitForTimeout(800); // a second post, had one gone, would have landed by now
    await p.unroute(/\/api\/scards\/SC-201\/answer$/);
    ok(fx.calls() - calls0 === 1 && !/answered exactly once|Refused/.test(await p.textContent(".needs")), "two quick clicks on a Studio option post one answer, and the result stays a success", String(fx.calls() - calls0));

    // a one-way Studio card: the note and tick survive a re-render; without the tick the answer is refused, with it the answer goes
    const dbg = []; p.on("response", async (r) => { if (/SC-202/.test(r.url())) dbg.push(`${r.request().method()} ${r.status()} ${r.request().postData()} ${await r.text().catch(() => "")}`.slice(0, 200)); });
    await p.click('[data-need="SC-202"] [data-need-open]'); await seen(p, '[data-need-card="SC-202"] [data-confirm-door="SC-202"]');
    await p.fill('[data-need-card="SC-202"] textarea', "keep the old column for a week");
    await p.click('[data-need-card="SC-202"] [data-option="approve"]');
    ok(await p.waitForFunction(() => /confirm the door first/.test(document.querySelector('[data-need-card="SC-202"]')?.innerText || ""), null, { timeout: 4000 }).then(() => true, () => false), "a one-way Studio card in Needs you refuses an answer without the door tick", await p.innerText('[data-need-card="SC-202"]').catch((e) => String(e)));
    await p.check('[data-confirm-door="SC-202"]');
    // a real remount: close the card and open it again (mountCard runs afresh)
    await p.click('[data-need="SC-202"] [data-need-open]'); await p.waitForTimeout(150);
    ok(await p.locator('[data-need-card="SC-202"]').count() === 0, "Close folds the card away");
    await p.click('[data-need="SC-202"] [data-need-open]'); await seen(p, '[data-need-card="SC-202"] textarea');
    ok(await p.inputValue('[data-need-card="SC-202"] textarea') === "keep the old column for a week" && await p.isChecked('[data-confirm-door="SC-202"]') && /confirm the door first/.test(await p.innerText('[data-need-card="SC-202"]')),
      "an expanded card keeps its note, tick and refusal when it is mounted again");
    // a live update that changes nothing on the Board redraws nothing; one that changes a run redraws the runs and keeps the open card's elements
    await p.evaluate(() => { document.querySelector('[data-need-card="SC-202"]').__keep = 1; document.querySelector("#runs").__keep = 1; soft(); });
    ok(await p.evaluate(() => document.querySelector("#runs").__keep === 1 && document.querySelector('[data-need-card="SC-202"]').__keep === 1), "a live update that changes nothing on the Board does not redraw it");
    await p.click('[data-need="D-fixture-door-check"] [data-need-open]'); await seen(p, '[data-need-card="D-fixture-door-check"] .opt');
    await p.evaluate(() => { document.querySelector('[data-need-card="SC-202"]').__keep = 1; document.querySelector('[data-need-card="D-fixture-door-check"]').__keep = 1; document.querySelector("#runs").__keep = 1; });
    { const t = fmTasks.at(-1); appendFileSync(join(state, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), actor: "firstmate", type: "review_opened", task: t.id, summary: { en: "review opened", "zh-TW": "開始審查" } }) + "\n"); }
    await p.waitForFunction(() => document.querySelector("#runs").__keep !== 1, null, { timeout: 8000 }).catch(() => {});
    ok(await p.evaluate(() => document.querySelector("#runs").__keep !== 1 && document.querySelector('[data-need-card="SC-202"]').__keep === 1), "a live redraw keeps the open Studio card's own elements (mid-typing, mid-click)");
    ok(await p.evaluate(() => document.querySelector('[data-need-card="D-fixture-door-check"]').__keep === 1), "a live redraw keeps the open firstmate card's own elements");
    // the captain's own action elsewhere on the Board (folding another card) redraws it; the Studio card stays the same mounted component
    await p.click('[data-need="D-fixture-door-check"] [data-need-open]'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.querySelector('[data-need-card="SC-202"]')?.__keep === 1), "the open Studio card stays one mounted component across the Board's own redraws");
    await p.evaluate(() => window.__es.dispatchEvent(new MessageEvent("scard", { data: JSON.stringify({ id: "SC-201", status: "answered" }) }))); await p.waitForTimeout(800);
    ok(await p.inputValue('[data-need-card="SC-202"] textarea') === "keep the old column for a week" && await p.isChecked('[data-confirm-door="SC-202"]'), "an expanded card keeps its note and its door tick across a re-render (an scard event)");
    await p.click('[data-need-card="SC-202"] [data-option="approve"]');
    ok(await p.waitForFunction(() => !document.querySelector('[data-need="SC-202"]') && /Go one-way ✓/.test(document.querySelector('[data-answered="SC-202"]')?.textContent || ""), null, { timeout: 5000 }).then(() => true, () => false)
      && fx.open[1].answer?.confirm === "one-way", "a one-way Studio card in Needs you answers with the door tick", dbg.join(" || ") + JSON.stringify(fx.open[1].answer) + (await p.textContent(".needs")).slice(0, 600));

    // a Studio card that leaves elsewhere (answered on another page, cancelled with its run) leaves no state behind on the Board
    for (const [id, how] of [["SC-298", { status: "answered", answer: { choice: "approve", note: null, by: "captain (another tab)", at: new Date().toISOString(), confirm: "one-way" } }], ["SC-299", { status: "cancelled" }]]) {
      fx.open.push({ ...JSON.parse(JSON.stringify(fx.open[1])), id, status: "open", answer: null });
      await p.evaluate(() => window.__es.dispatchEvent(new MessageEvent("scard", { data: "{}" })));
      await seen(p, `[data-need="${id}"]`); await p.click(`[data-need="${id}"] [data-need-open]`); await seen(p, `[data-need-card="${id}"] textarea`);
      await p.fill(`[data-need-card="${id}"] textarea`, "half-written note");
      const held0 = await p.evaluate((x) => { const b = window.crewBoard.held(); return [b.open, b.cstate, b.mounted].every((l) => l.includes(x)); }, id);
      Object.assign(fx.open.find((c) => c.id === id), how);
      await p.evaluate(() => window.__es.dispatchEvent(new MessageEvent("scard", { data: "{}" }))); const left = await p.waitForFunction((x) => !document.querySelector(`[data-need="${x}"]`), id, { timeout: 5000 }).then(() => true, () => false);
      const held1 = await p.evaluate(() => window.crewBoard.held());
      ok(held0 && left && ![held1.open, held1.cstate, held1.mounted].some((l) => l.includes(id)), `a Studio card ${how.status} elsewhere leaves Needs you and the Board drops its open flag, state and mounted card`, JSON.stringify(held1)); }
    // a firstmate decision that leaves firstmate's pending list elsewhere (answered on firstmate's own board) leaves nothing behind either:
    // firstmate's pending list, not only the Studio open-card list, decides what the Board keeps (done line 18)
    { const id = "D-board-leaves";
      const push = (list) => p.evaluate((l) => window.__es.dispatchEvent(new MessageEvent("pending", { data: JSON.stringify({ pending: l, tasks: S.tasks }) })), list);
      const was = await p.evaluate(() => S.pending);
      await push([...was, { ...JSON.parse(JSON.stringify(was.find((c) => c.id === "D-firstmate-workflow-T304-2") || was[0])), id, ts: new Date().toISOString() }]);
      await seen(p, `[data-need="${id}"]`); await p.click(`[data-need="${id}"] [data-need-open]`); await seen(p, `[data-need-card="${id}"]`);
      const held0 = await p.evaluate((x) => { const b = window.crewBoard.held(); return b.open.includes(x) && b.mounted.includes(x); }, id);
      await push(was); await p.waitForFunction((x) => !document.querySelector(`[data-need="${x}"]`), id, { timeout: 5000 }).catch(() => {});
      const held1 = await p.evaluate(() => window.crewBoard.held());
      ok(held0 && ![held1.open, held1.cstate, held1.mounted].some((l) => l.includes(id)), "a firstmate decision that leaves firstmate's pending list elsewhere leaves Needs you and the Board drops its open flag and mounted card", JSON.stringify([held0, held1])); }

    // a firstmate card in place: a refusal from the board shows inline; an answer goes through the board
    const fm1 = summary.pending.find((c) => c.id === "D-firstmate-workflow-T305-1"), ref = summary.pending.find((c) => c.id === "D-fixture-door-check");
    if (ref) { if (!(await p.locator(`[data-need-card="${ref.id}"]`).count())) await p.click(`[data-need="${ref.id}"] [data-need-open]`); const card = p.locator(`[data-need-card="${ref.id}"]`);
      await card.locator('.opt:has(.letter:text-is("A"))').click(); await p.locator(`[data-need-card="${ref.id}"] .actions .btn.primary`).click();
      ok(await p.waitForFunction((id) => /already answered on the board/.test(document.querySelector(`[data-need-card="${id}"] [data-answer-result]`)?.textContent || "") && !document.querySelector(".modal"), ref.id, { timeout: 5000 }).then(() => true, () => false),
        "a refusal from the board shows inline on a firstmate card (no dialog)"); }
    if (fm1) { await p.click(`[data-need="${fm1.id}"] [data-need-open]`);
      const card = p.locator(`[data-need-card="${fm1.id}"]`); await card.locator('.opt:has(.letter:text-is("A"))').click();
      { let release; const held = new Promise((r) => (release = r));
        await p.route(/\/api\/answer$/, async (r) => { await held; await r.continue(); }, { times: 1 });
        await p.locator(`[data-need-card="${fm1.id}"] .actions .btn.primary`).click(); await p.waitForTimeout(150);
        ok(await p.evaluate((id) => { const box = document.querySelector(`[data-need-card="${id}"]`); return !!box && box.querySelector(".actions .btn.primary").disabled && [...box.querySelectorAll(".opt")].every((o) => o.disabled)
          && /Sending…/.test(box.querySelector("[data-answer-result]")?.textContent || ""); }, fm1.id), "a firstmate card's controls are disabled while its answer is in flight, and it says Sending…");
        await p.locator(`[data-need-card="${fm1.id}"] .actions .btn.primary`).click({ timeout: 1000, force: true }).catch(() => {});
        release(); }
      ok(await p.waitForFunction((id) => !document.querySelector(`[data-need="${id}"]`) && /A recorded ✓/.test(document.querySelector(`[data-answered="${id}"]`)?.textContent || "") && !document.querySelector(".modal"), fm1.id, { timeout: 5000 }).then(() => true, () => false),
        "a firstmate card is answered inline from Needs you (no dialog): the result shows and the row leaves");
      ok(received.filter((r) => r.path === "/decisions" && r.body?.id === fm1.id && r.body?.chosen === "A").length === 1, "the firstmate answer went through the board once, after two quick clicks", String(received.filter((r) => r.body?.id === fm1.id).length)); }
    // a one-way firstmate merge card on the Board: the door confirmation, then one answer
    { const id = "D-board-oneway"; await p.click(`[data-need="${id}"] [data-need-open]`); const card = p.locator(`[data-need-card="${id}"]`);
      await card.locator('.opt:has(b:text-is("Merge #902"))').click();
      ok(await card.locator(".actions .btn.primary").isDisabled(), "a one-way firstmate merge in Needs you stays locked until the door is confirmed");
      await card.locator('[data-intent="1"]').check(); await card.locator('[data-intent="2"]').check(); await card.locator('[data-check-answer="1"]').click();
      await p.waitForFunction(() => /unlocked/.test(document.querySelector('[data-need-card="D-board-oneway"] [data-door-check]')?.innerText || ""), null, { timeout: 6000 }).catch(() => {});
      await card.locator(".actions .btn.primary").click();
      ok(await p.waitForFunction(() => /A recorded ✓/.test(document.querySelector('[data-answered="D-board-oneway"]')?.textContent || ""), null, { timeout: 6000 }).then(() => true, () => false)
        && received.some((r) => r.path === "/decisions" && r.body?.id === id && JSON.stringify(r.body.reviewed_intents) === "[1,2]" && r.body.check_answer === 1), "a one-way firstmate card in Needs you answers with the door confirmation"); }
    await p.screenshot({ path: join(shots, "board-after-answer-1440-light.png"), fullPage: true });

    // the Inbox: decisions only, answered in place
    await p.goto(`${base}/#/inbox`); await p.waitForTimeout(800);
    ok(await p.locator(".trail, [data-inbox-intents], [data-intent-row]").count() === 0, "the Inbox has no progress trail");
    if (fm1) { const line = () => p.textContent(`[data-card="${fm1.id}"] [data-answer-result]`).catch(() => "");
      const before = await line();
      await p.evaluate((id) => window.onCardAnswered({ id }, false, "Refused: no such pending card"), fm1.id); await p.waitForTimeout(200);
      ok(/A recorded ✓/.test(before) && /A recorded ✓/.test(await line()), "a late refusal does not overwrite a recorded answer", `${before} → ${await line()}`); }
    const fm2 = summary.pending.find((c) => c.id === "D-firstmate-workflow-T304-2");
    if (fm2) { const card = p.locator(`[data-card="${fm2.id}"]`); await card.locator('.opt:has(.letter:text-is("B"))').click(); await card.locator(".actions .btn.primary").click();
      ok(await p.waitForFunction((id) => /B recorded ✓/.test(document.querySelector(`[data-card="${id}"] [data-answer-result]`)?.textContent || "") && !document.querySelector(".modal"), fm2.id, { timeout: 5000 }).then(() => true, () => false)
        && received.some((r) => r.path === "/decisions" && r.body?.id === fm2.id && r.body?.chosen === "B"), "a firstmate card is answered inline from the Inbox (no dialog), through the board"); }
    await p.screenshot({ path: join(shots, "inbox-1440-light.png"), fullPage: true });
    await ctx.close(); }

  // ---------- the REAL runtime routes: a stub-provider run on this server reaches its dispatch card ----------
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`real: ${e}`));
    await p.goto(`${base}/#/board`); await p.waitForTimeout(800);
    ok(/, — today$/.test((await p.textContent("#boardSub")).trim()), "no cost recorded at all: today's spend reads —", await p.textContent("#boardSub"));
    const text = ["Add a percent function to money-kit", "STUB_FILE src/percent.ts :: export function percent(a: number, p: number): number {\\n  return Math.round((a * p) / 100);\\n}\\n"].join("\n");
    const started = await p.evaluate((t) => fetch("/api/wruns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t, workflow: "code-firstmate" }) }).then((r) => r.json()), text);
    const rid = started.id;
    ok(/^R-\d+$/.test(rid || ""), "a real run starts on the runtime (stub provider)", JSON.stringify(started).slice(0, 300));
    // the card is answerable once its own checks have raised it
    let card = null; for (let i = 0; i < 240 && !card; i++) { const cs = await p.evaluate(() => fetch("/api/scards?open=1").then((r) => r.json())); card = (cs.cards || []).find((c) => c.run === rid && c.ste) || null; if (!card) await p.waitForTimeout(500); }
    ok(!!card && card.kind === "dispatch", "the real run reaches its dispatch card", JSON.stringify(card)?.slice(0, 200));
    const det = await p.evaluate((id) => fetch(`/api/wruns/${id}`).then((r) => r.json()), rid);
    ok(Array.isArray(det.def?.nodes) && Object.values(det.nodes).some((n) => (n.data?.jobs || []).some((j) => "cost" in j && j.provider)) && det.steps.some((s) => s.job) && det.nodes.dispatch?.waiting === "card",
      "the real run detail carries what the Board reads (def, nodes[*].data.jobs, steps[].job, waiting: card)");
    await p.goto(`${base}/#/board`);
    ok(await seen(p, `[data-run="${rid}"]`, 10000) && /^1\/7 Intake/.test((await p.textContent(`[data-run="${rid}"] .pipe-l`)).trim()) && JSON.stringify(await segs(p, rid)) === JSON.stringify(["human", "", "", "", "", "", ""]),
      "the real run shows on the Board, waiting on the captain at Intake", (await p.textContent(`[data-run="${rid}"]`).catch(() => "")).slice(0, 200));
    ok(await seen(p, `[data-need="${card?.id}"]`), "its card is in Needs you");
    const answerTrace={};p.on("response",async response=>{if(new URL(response.url()).pathname===`/api/scards/${card?.id}/answer`){answerTrace.headersAt=Date.now();answerTrace.status=response.status();const got=await response.json().catch(()=>null);answerTrace.card=got?.id;answerTrace.choice=got?.answer?.choice;}});
    await p.click(`[data-need="${card?.id}"] [data-need-open]`);answerTrace.clickedAt=Date.now();await p.click(`[data-need-card="${card?.id}"] [data-option="dispatch"]`);
    ok(await p.waitForFunction((id) => !document.querySelector(`[data-need="${id}"]`) && /✓/.test(document.querySelector(`[data-answered="${id}"]`)?.textContent || ""), card?.id, { timeout: 10000 }).then(() => true, () => false), "the real card is answered inline from Needs you",JSON.stringify({...answerTrace,observedAt:Date.now(),dom:await p.evaluate(id=>({pending:!!document.querySelector(`[data-need="${id}"]`),receipt:document.querySelector(`[data-answered="${id}"]`)?.textContent||null}),card?.id)}));
    ok(await p.waitForFunction((id) => { const l = document.querySelector(`[data-run="${id}"] .pipe-l`)?.textContent || ""; return l && !/^1\/7 Intake/.test(l); }, rid, { timeout: 60000 }).then(() => true, () => false),
      "the real run advances past Intake on the Board, live", (await p.textContent(`[data-run="${rid}"] .pipe-l`).catch(() => "")));
    await p.screenshot({ path: join(shots, "board-real-run-1440-light.png"), fullPage: true });
    await ctx.close(); }

  // ---------- screenshots: the Board and the prototype's Board, same sizes ----------
  const protoOk = existsSync(PROTO);
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const fx = boardFixture(PIN); const { ctx, p } = await open(width, scheme, fx);
    await p.goto(`${base}/#/board`); await seen(p, '[data-run="R-103"]', 10000);
    await p.evaluate(() => document.body.classList.add("chat-closed")); await p.waitForTimeout(400); // the prototype's Board is shot with its chat closed too
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways scroll at ${width} ${scheme}`);
    await p.screenshot({ path: join(shots, `board-${width}-${scheme}.png`), fullPage: true });
    if (protoOk) { await serveProto(ctx); const q = await ctx.newPage(); await q.goto(`${PB}/proto.html`); await q.waitForTimeout(1500);
      await q.evaluate((s) => { document.documentElement.setAttribute("data-theme", s); document.body.classList.add("chat-closed"); }, scheme);
      await q.screenshot({ path: join(shots, `prototype-board-${width}-${scheme}.png`), fullPage: true }); await q.close(); }
    ok(existsSync(join(shots, `board-${width}-${scheme}.png`)) && (!protoOk || existsSync(join(shots, `prototype-board-${width}-${scheme}.png`))), `screenshots at ${width} ${scheme}, the Board and the prototype's Board`);
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  await browser.close(); app.kill(); mock.close();
}
console.log(`\nboard-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
