import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Board (docs/units/board.md): every Task in parallel, one row each with its milestone
// track; each waiting decision's Task links to its card in the Inbox, where it is answered
// (the Board shows no card); the Inbox decisions only. Studio runs and cards come from
// tests/fixture/board (runs in parallel: build round 2, waiting on the merge card, failed at
// CI, ...); firstmate's tasks and cards from a temp copy of tests/fixture/state, answers
// through a mock board. Screenshots at 1440 and 390, light and dark. The layout, filters,
// detail panel and keyboard are tests/board-overview-ui.mjs.
//   node tests/board-ui.mjs
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { boardFixture, routeBoardFixture } from "./fixture/board/studio.mjs";
import { approveStaffing, codexCrewEnv } from "./lib/codex-crew.mjs";

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
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude",
  ...codexCrewEnv(join(tmp, "home")), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = join(root, "tests/out/board"); mkdirSync(shots, { recursive: true });
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
// a row's milestone states (done, running, waiting on the captain, failed, not reached), from its track
const segs = (p, id) => p.$$eval(`[data-task="${id}"] .tb-track i`, (is) => is.map((i) => (/\bs-(\w+)/.exec(i.className) || [])[1] || ""));
const stage = (p, id) => p.textContent(`[data-task="${id}"] .tb-stage`).then((t) => t.trim());
const nowOf = (p, id) => p.textContent(`[data-task="${id}"] .tb-now-t`).then((t) => t.trim());
const links = (p) => p.$$eval("[data-task] [data-inbox-link]", (as) => Object.fromEntries(as.map((a) => [a.closest("[data-task]").dataset.task, a.dataset.inboxLink])));

try {
  // ---------- 1440 light: the behaviour ----------
  { const fx = boardFixture(PIN); const { ctx, p } = await open(1440, "light", fx);
    await p.goto(`${base}/`); await seen(p, '[data-task="R-101"] .tb-track i', 10000);
    await p.waitForFunction(() => [...document.querySelectorAll('[data-task^="R-"]')].every((r) => r.querySelector(".tb-track i")), null, { timeout: 8000 }).catch(() => {});
    const views = await p.$$eval(".nav > .nav-item", (bs) => bs.filter((b) => !b.hidden && getComputedStyle(b).display !== "none").map((b) => b.dataset.view));
    ok(p.url().endsWith("#/board") && views[0] === "board" && JSON.stringify(views) === JSON.stringify(["board", "firstmate", "inbox", "crew", "runs", "workflows", "library"]), "home is the Board, first in the sidebar", `${p.url()} ${JSON.stringify(views)}`);

    // every Task, Studio and firstmate, one row each, with its milestones
    const rows = await p.$$eval("[data-task]", (rs) => rs.map((r) => r.dataset.task));
    const want = ["R-101", "R-102", "R-103", "R-104", "R-105", "R-106", "R-107", "R-091", ...fmTasks.map((t) => t.id)];
    ok(want.every((id) => rows.includes(id)) && rows.length === want.length && !rows.includes("R-090"), "the Board lists every parallel run (Studio runs in flight, the one done today, the firstmate tasks in flight; not an old finished run)", JSON.stringify({ rows, want }));
    const s1 = await segs(p, "R-101"), s2 = await segs(p, "R-102"), s3 = await segs(p, "R-103");
    ok(JSON.stringify(s1) === JSON.stringify(["done", "done", "done", "running", "", "", ""]) && JSON.stringify(s2) === JSON.stringify(["done", "done", "done", "done", "human", "", ""])
      && JSON.stringify(s3) === JSON.stringify(["done", "done", "done", "failed", "", "", ""]) && JSON.stringify(await segs(p, "R-104")) === JSON.stringify(["done", "human", "", "", "", "", ""]), "the Board lists every parallel run with the correct milestone states", JSON.stringify({ s1, s2, s3 }));
    ok(await p.locator('[data-task="R-101"] .tb-track i.cur').count() === 1 && await p.getAttribute('[data-task="R-101"] .tb-track i.cur', "data-ms") === "build", "the current milestone is marked");
    const titles = await p.$$eval('[data-task="R-101"] .tb-track i', (is) => is.map((i) => i.title));
    ok(titles[3]?.startsWith("Build loop") && titles[0]?.startsWith("Intake") && titles[6]?.startsWith("After merge"), "milestones are the workflow's stages (graph-layout's grouping)", JSON.stringify(titles));
    for (const t of fmTasks) { const s = await segs(p, t.id);
      ok(s.length === 7 && s.some((x) => ["running", "human", "failed"].includes(x)), `the firstmate task ${t.id} has a seven-milestone track with its current milestone marked`, JSON.stringify(s)); }
    for (const t of fmTasks.filter((x) => x.round && ["build", "ci", "review"].includes(x.node))) { const l = await stage(p, t.id);
      ok(/^Build loop · round \d+ · 4\/7$/.test(l) && l.includes(`round ${t.round}`), `the firstmate label shows its round (${t.id})`, l); }
    ok(fmTasks.some((x) => x.round && ["build", "ci", "review"].includes(x.node)), "the fixture has a firstmate task in its build loop with a round");
    const l1 = await stage(p, "R-101"), l2 = await stage(p, "R-102"), l3 = await stage(p, "R-103");
    ok(l1 === "Build loop · round 2/3 · 4/7" && l2 === "Gates · 5/7" && l3 === "Build loop · round 1/3 · 4/7", "the label shows stage and round", JSON.stringify([l1, l2, l3]));
    // row details and the subtitle
    const word = async (id) => (await p.textContent(`[data-task="${id}"] .tb-st`)).trim();
    const el = (await p.textContent('[data-task="R-101"] .tb-el')).trim(), sub = (await p.textContent("#boardSub")).trim();
    const crewN = 1 + fmLive.length, open0 = want.length - 1; // R-091 is done
    ok(await word("R-101") === "Running" && await word("R-102") === "Waiting for you" && await word("R-103") === "Stuck" && await word("R-091") === "Done" && /codex gpt-5\.5$/.test(await nowOf(p, "R-101"))
      && /^4[45]m$/.test(el) && sub === `${open0} tasks, ${crewN} crew on duty, $5.94 today`, "row details and subtitle: status, who works with provider and model, elapsed; real counts; today's spend over every run that ran today (R-091 finished today: its $1.00 counts)", JSON.stringify({ el, sub, crewN, now: await nowOf(p, "R-101") }));
    ok(/CI failed: 2 of 14 tests fail/.test(await nowOf(p, "R-103")), "a failed run says its error on its row");

    // the decisions waiting: each Task with an open card links to it in the Inbox; no card is shown on the Board
    const lk = await links(p);
    // (a firstmate card whose task firstmate does not list, D-board-oneway's T-306, has no row to link from: the Inbox holds it)
    const pendingShown = summary.pending.filter((c) => rows.includes(c.task));
    ok(lk["R-102"] === "SC-201" && lk["R-104"] === "SC-202" && lk["R-106"] === "SC-203" && lk["R-107"] === "SC-204" && pendingShown.length > 0 && pendingShown.every((c) => summary.pending.some((d) => d.id === lk[c.task] && d.task === c.task)) && Object.keys(lk).length === new Set(["R-102", "R-104", "R-106", "R-107", ...pendingShown.map((c) => c.task)]).size,
      "every waiting decision's Task links to it in the Inbox, and only those", JSON.stringify(lk));
    ok(await p.locator("#view [data-scard], #view [data-need-card], #view [data-card], #view [data-option]").count() === 0 && !/no minor unit/.test(await p.textContent("#view")), "the Board shows no card body");
    // (1440 with the Firstmate panel open is the compact layout: the row's status already says Waiting for you, Now names the card)
    ok(/^(Waiting for you: )?Merge: format\(\) supports JPY/.test(await nowOf(p, "R-102")), "a waiting Task names its card", await nowOf(p, "R-102"));
    await p.screenshot({ path: join(shots, "board-1440-light-overview.png"), fullPage: true });

    // a live event updates the Board without a reload, and asks for that one run only
    await p.click('[data-task="R-104"] .tb-title');
    await p.evaluate(() => { window.__marker = 1; });
    const rq = []; p.on("request", (r) => { const u = new URL(r.url()); if (/^\/api\/(wruns|summary)/.test(u.pathname)) rq.push(u.pathname); });
    fx.details["R-101"].nodes.build.state = "passed";
    Object.assign(fx.details["R-101"].nodes.ci, { state: "running", visits: 2 });
    const nodes = Object.fromEntries(Object.entries(fx.details["R-101"].nodes).filter(([, n]) => n).map(([k, n]) => [k, { state: n.state, visits: n.visits, outcome: n.outcome, waiting: n.waiting }]));
    await p.evaluate((d) => window.__es.dispatchEvent(new MessageEvent("wrun", { data: JSON.stringify(d) })), { id: "R-101", status: "running", event: { seq: 41, ts: new Date().toISOString(), type: "node", node: "ci", from: "pending", to: "running" }, nodes });
    await p.waitForTimeout(700);
    ok(await p.evaluate(() => window.__marker) === 1 && /^CI/.test(await nowOf(p, "R-101")) && rq.filter((u) => u !== "/api/wruns/agents").every((u) => u === "/api/wruns/R-101") /* the Crew page's agent list (crew-studio-agents) follows wrun too */
      && await p.getAttribute("[data-task-detail]", "data-task-detail") === "R-104", "a live event updates one run without reload, and the selected row stays selected", JSON.stringify({ rq, now: await nowOf(p, "R-101") }));
    // a firstmate row follows its task's events live
    { const t = fmTasks.find((x) => ["build", "ci", "review"].includes(x.node)) || fmTasks[0];
      appendFileSync(join(state, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), actor: "firstmate", type: "gate_passed", task: t.id, summary: { en: "gates passed", "zh-TW": "關卡通過" } }) + "\n");
      ok(await p.waitForFunction((id) => /^Gates · 5\/7/.test(document.querySelector(`[data-task="${id}"] .tb-stage`)?.textContent || ""), t.id, { timeout: 8000 }).then(() => true, () => false)
        && await p.evaluate(() => window.__marker === 1), `a firstmate row updates live, without a reload (${t.id} moves to Gates)`); }
    ok(p.streams() === 1 && await p.evaluate(() => window.__streams) === 1, "one stream connection", String(p.streams()));
    // a live update that changes nothing on the Board redraws nothing
    await p.evaluate(() => { document.querySelector("#tasks").__keep = 1; soft(); });
    ok(await p.evaluate(() => document.querySelector("#tasks").__keep === 1), "a live update that changes nothing on the Board does not redraw it");

    // a click selects the Task; its panel opens the Task
    await p.click('[data-task="R-103"] .tb-title'); await p.waitForTimeout(150);
    ok(p.url().endsWith("#/board") && await p.getAttribute("[data-task-detail]", "data-task-detail") === "R-103", "a click on a row selects it and opens its panel, without navigating", p.url());
    await p.click('[data-open-task="R-103"]'); await p.waitForTimeout(200);
    ok(p.url().endsWith("#/run/R-103"), "Open task opens the run view", p.url());

    // the Studio cards are answered in the Inbox, the Board's link leading there
    await p.goto(`${base}/#/board`); await seen(p, '[data-inbox-link="SC-201"]'); await p.click('[data-inbox-link="SC-201"]');
    ok(await seen(p, '[data-scard="SC-201"] [data-option="merge"]') && p.url().endsWith("#/inbox/SC-201"), "the Board's link opens the card in the Inbox, with its options");
    await p.click('[data-scard="SC-201"] [data-option="changes"]');
    ok(await p.waitForFunction(() => /say what to change|write it first/.test(document.querySelector('[data-scard="SC-201"]')?.innerText || ""), null, { timeout: 4000 }).then(() => true, () => false), "a refusal shows inline (the server's reason)");
    // the card was answered Merge elsewhere meanwhile (another tab): answering Merge again shows as answered, not refused
    Object.assign(fx.open[0], { status: "answered", answer: { choice: "merge", note: null, by: "captain (another tab)", at: new Date().toISOString(), confirm: null } });
    const calls0 = fx.calls();
    { let release; const held = new Promise((r) => (release = r));
      await p.route(/\/api\/scards\/SC-201\/answer$/, async (r) => { await held; const [st, b] = fx.answer("SC-201", JSON.parse(r.request().postData() || "{}")); await r.fulfill({ status: st, contentType: "application/json", body: JSON.stringify(b) }); });
      await p.click('[data-scard="SC-201"] [data-option="merge"]'); await p.waitForTimeout(150);
      ok(await p.$$eval('[data-scard="SC-201"] [data-option]', (bs) => bs.length > 0 && bs.every((b) => b.disabled)), "a Studio card's options are disabled while its answer is in flight");
      await p.click('[data-scard="SC-201"] [data-option="merge"]', { timeout: 1000, force: true }).catch(() => {});
      release(); }
    await p.waitForTimeout(1200);
    await p.unroute(/\/api\/scards\/SC-201\/answer$/);
    ok(fx.calls() - calls0 === 1 && !/Refused/.test(await p.textContent("#view")), "two quick clicks on a Studio option post one answer, and the result stays a success", String(fx.calls() - calls0));
    // the answered card leaves the Board: its Task no longer links to it
    await p.goto(`${base}/#/board`); await seen(p, '[data-task="R-102"]');
    ok(await p.waitForFunction(() => !document.querySelector('[data-inbox-link="SC-201"]'), null, { timeout: 5000 }).then(() => true, () => false), "an answered card leaves the Board: its Task no longer links to it");
    // a one-way Studio card in the Inbox: the note and tick survive a re-render; without the tick the answer is refused, with it the answer goes
    await p.goto(`${base}/#/inbox/SC-202`); await seen(p, '[data-scard="SC-202"] [data-confirm-door="SC-202"]');
    await p.fill('[data-scard="SC-202"] textarea', "keep the old column for a week");
    const calls1 = fx.calls(); await p.click('[data-scard="SC-202"] [data-option="approve"]');
    ok(await p.waitForFunction(() => /confirm the door first/i.test(document.querySelector('[data-scard="SC-202"]')?.innerText || ""), null, { timeout: 4000 }).then(() => true, () => false) && fx.calls() === calls1,
      "a one-way Studio card refuses an answer without the door tick, on the card, before anything is sent", String(fx.calls() - calls1));
    await p.check('[data-confirm-door="SC-202"]');
    await p.evaluate(() => window.__es.dispatchEvent(new MessageEvent("scard", { data: JSON.stringify({ id: "SC-201", status: "answered" }) }))); await p.waitForTimeout(800);
    ok(await p.inputValue('[data-scard="SC-202"] textarea') === "keep the old column for a week" && await p.isChecked('[data-confirm-door="SC-202"]'), "an open card keeps its note and its door tick across a re-render (an scard event)");
    await p.click('[data-scard="SC-202"] [data-option="approve"]'); await p.waitForTimeout(900);
    ok(fx.open[1].answer?.confirm === "one-way", "a one-way Studio card answers with the door tick", JSON.stringify(fx.open[1].answer));

    // a firstmate card in the Inbox: a refusal from the board shows inline; an answer goes through the board
    const fm1 = summary.pending.find((c) => c.id === "D-firstmate-workflow-T305-1"), ref = summary.pending.find((c) => c.id === "D-fixture-door-check");
    if (ref) { await p.goto(`${base}/#/inbox/${ref.id}`); const card = p.locator(`[data-card="${ref.id}"]`);
      await card.locator('.opt:has(.letter:text-is("A"))').click(); await card.locator(".actions .btn.primary").click();
      ok(await p.waitForFunction((id) => /already answered on the board/.test(document.querySelector(`[data-card="${id}"] [data-answer-result]`)?.textContent || "") && !document.querySelector(".modal"), ref.id, { timeout: 5000 }).then(() => true, () => false),
        "a refusal from the board shows inline on a firstmate card (no dialog)"); }
    if (fm1) { await p.goto(`${base}/#/inbox/${fm1.id}`); const card = p.locator(`[data-card="${fm1.id}"]`); await card.locator('.opt:has(.letter:text-is("A"))').click();
      { let release; const held = new Promise((r) => (release = r));
        await p.route(/\/api\/answer$/, async (r) => { await held; await r.continue(); }, { times: 1 });
        await card.locator(".actions .btn.primary").click(); await p.waitForTimeout(150);
        ok(await p.evaluate((id) => { const box = document.querySelector(`[data-card="${id}"]`); return !!box && box.querySelector(".actions .btn.primary").disabled && [...box.querySelectorAll(".opt")].every((o) => o.disabled)
          && /Sending…/.test(box.querySelector("[data-answer-result]")?.textContent || ""); }, fm1.id), "a firstmate card's controls are disabled while its answer is in flight, and it says Sending…");
        await card.locator(".actions .btn.primary").click({ timeout: 1000, force: true }).catch(() => {});
        release(); }
      ok(await p.waitForFunction((id) => /A recorded ✓/.test(document.querySelector(`[data-answered="${id}"]`)?.textContent || document.querySelector(`[data-card="${id}"] [data-answer-result]`)?.textContent || "") && !document.querySelector(".modal"), fm1.id, { timeout: 5000 }).then(() => true, () => false),
        "a firstmate card is answered inline from the Inbox (no dialog): the result shows");
      ok(received.filter((r) => r.path === "/decisions" && r.body?.id === fm1.id && r.body?.chosen === "A").length === 1, "the firstmate answer went through the board once, after two quick clicks", String(received.filter((r) => r.body?.id === fm1.id).length));
      const line = () => p.textContent(`[data-answered="${fm1.id}"], [data-card="${fm1.id}"] [data-answer-result]`).catch(() => "");
      const before = await line();
      await p.evaluate((id) => window.onCardAnswered({ id }, false, "Refused: no such pending card"), fm1.id); await p.waitForTimeout(200);
      ok(/A recorded ✓/.test(before) && /A recorded ✓/.test(await line()), "a late refusal does not overwrite a recorded answer", `${before} → ${await line()}`); }
    // a one-way firstmate merge card: the door confirmation, then one answer
    { const id = "D-board-oneway"; await p.goto(`${base}/#/inbox/${id}`); const card = p.locator(`[data-card="${id}"]`);
      await card.locator('.opt:has(b:text-is("Merge #902"))').click();
      ok(await card.locator(".actions .btn.primary").isDisabled(), "a one-way firstmate merge stays locked until the door is confirmed");
      await card.locator('[data-intent="1"]').check(); await card.locator('[data-intent="2"]').check(); await card.locator('[data-check-answer="1"]').click();
      await p.waitForFunction(() => /unlocked/.test(document.querySelector('[data-card="D-board-oneway"] [data-door-check]')?.innerText || ""), null, { timeout: 6000 }).catch(() => {});
      await card.locator(".actions .btn.primary").click();
      await p.waitForTimeout(1000);
      ok(received.some((r) => r.path === "/decisions" && r.body?.id === id && JSON.stringify(r.body.reviewed_intents) === "[1,2]" && r.body.check_answer === 1), "a one-way firstmate card answers with the door confirmation"); }
    ok(await p.locator(".trail, [data-inbox-intents], [data-intent-row]").count() === 0, "the Inbox has no progress trail");
    const fm2 = summary.pending.find((c) => c.id === "D-firstmate-workflow-T304-2");
    if (fm2) { await p.goto(`${base}/#/inbox/${fm2.id}`); const card = p.locator(`[data-card="${fm2.id}"]`); await card.locator('.opt:has(.letter:text-is("B"))').click(); await card.locator(".actions .btn.primary").click();
      ok(await p.waitForFunction((id) => /B recorded ✓/.test(document.querySelector(`[data-answered="${id}"]`)?.textContent || document.querySelector(`[data-card="${id}"] [data-answer-result]`)?.textContent || "") && !document.querySelector(".modal"), fm2.id, { timeout: 5000 }).then(() => true, () => false)
        && received.some((r) => r.path === "/decisions" && r.body?.id === fm2.id && r.body?.chosen === "B"), "a firstmate card is answered inline from the Inbox (no dialog), through the board"); }
    await p.screenshot({ path: join(shots, "inbox-1440-light.png"), fullPage: true });
    await ctx.close(); }

  // ---------- the REAL runtime routes: a stub-provider run on this server reaches its dispatch card ----------
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`real: ${e}`));
    await p.goto(`${base}/#/board`); await p.waitForTimeout(800);
    ok(/crew on duty$/.test((await p.textContent("#boardSub")).trim()) && !/today|—/.test(await p.textContent("#boardSub")), "no cost recorded at all: the line ends at the crew, no \"— today\" (live S28)", await p.textContent("#boardSub"));
    // the change and its test: the spec's environment preflight (firstmate/env-preflight) needs the test its done line names
    const text = ["Add a percent function to money-kit", "STUB_FILE src/percent.ts :: export function percent(a: number, p: number): number {\\n  return Math.round((a * p) / 100);\\n}\\n",
      'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n'].join("\n");
    // code-firstmate starts only on a registered project with an approved crew (src/domain/staffing.ts): the built-in sandbox
    // project, its crew approved through the captain's staffing discussion on the fixture Codex account (tests/lib/codex-crew.mjs)
    const api = async (path, body) => p.evaluate(async ([path, body]) => { const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [path, body]);
    await approveStaffing(api, "sandbox", "code-firstmate");
    const started = await p.evaluate((t) => fetch("/api/wruns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t, workflow: "code-firstmate", params: { project: "sandbox" } }) }).then((r) => r.json()), text);
    const rid = started.id;
    ok(/^R-\d+$/.test(rid || ""), "a real run starts on the runtime (stub provider)", JSON.stringify(started).slice(0, 300));
    // the card is answerable once its own checks have raised it
    let card = null; for (let i = 0; i < 240 && !card; i++) { const cs = await p.evaluate(() => fetch("/api/scards?open=1").then((r) => r.json())); card = (cs.cards || []).find((c) => c.run === rid && c.ste) || null; if (!card) await p.waitForTimeout(500); }
    ok(!!card && card.kind === "dispatch", "the real run reaches its dispatch card", JSON.stringify(card)?.slice(0, 200));
    const det = await p.evaluate((id) => fetch(`/api/wruns/${id}`).then((r) => r.json()), rid);
    ok(Array.isArray(det.def?.nodes) && Object.values(det.nodes).some((n) => (n.data?.jobs || []).some((j) => "cost" in j && j.provider)) && det.steps.some((s) => s.job) && det.nodes.dispatch?.waiting === "card",
      "the real run detail carries what the Board reads (def, nodes[*].data.jobs, steps[].job, waiting: card)");
    await p.goto(`${base}/#/board`);
    ok(await seen(p, `[data-task="${rid}"] .tb-track i`, 10000) && /^Intake · (round \d+\/\d+ · )?1\/7$/.test(await stage(p, rid)) && JSON.stringify(await segs(p, rid)) === JSON.stringify(["human", "", "", "", "", "", ""]),
      "the real run shows on the Board, waiting on the captain at Intake", (await p.textContent(`[data-task="${rid}"]`).catch(() => "")).slice(0, 200));
    ok(await seen(p, `[data-task="${rid}"] [data-inbox-link="${card?.id}"]`), "its row links to its card in the Inbox");
    await p.click(`[data-inbox-link="${card?.id}"]`); await seen(p, `[data-scard="${card?.id}"] [data-option="dispatch"]`);
    await p.click(`[data-scard="${card?.id}"] [data-option="dispatch"]`);
    ok(await p.waitForFunction(async (id) => (await (await fetch(`/api/scards/${id}`)).json()).status === "answered", card?.id, { timeout: 10000 }).then(() => true, () => false), "the real card is answered from the Inbox the Board linked to");
    await p.goto(`${base}/#/board`);
    ok(await p.waitForFunction((id) => { const l = document.querySelector(`[data-task="${id}"] .tb-stage`)?.textContent || ""; return l && !/^Intake /.test(l); }, rid, { timeout: 60000 }).then(() => true, () => false),
      "the real run advances past Intake on the Board, live", (await stage(p, rid).catch(() => "")));
    await p.screenshot({ path: join(shots, "board-real-run-1440-light.png"), fullPage: true });
    await ctx.close(); }

  // ---------- screenshots: the Board at 1440 and 390, light and dark ----------
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const fx = boardFixture(PIN); const { ctx, p } = await open(width, scheme, fx);
    await p.goto(`${base}/#/board`); await seen(p, '[data-task="R-103"]', 10000);
    await p.evaluate(() => document.body.classList.add("chat-closed")); await p.waitForTimeout(400);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways scroll at ${width} ${scheme}`);
    await p.screenshot({ path: join(shots, `board-${width}-${scheme}.png`), fullPage: true });
    ok(existsSync(join(shots, `board-${width}-${scheme}.png`)), `screenshot at ${width} ${scheme}`);
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  await browser.close(); app.kill(); mock.close();
}
console.log(`\nboard-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
