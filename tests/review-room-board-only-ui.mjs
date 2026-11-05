import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The board is the review room's only view (public/review-board.js, public/review-room.js sceneCard / playBar;
// docs/units/review-room.md "The board"): what only the stage showed before lives on the board's canvas. The welcome and
// its lesson button, an answer's pictures and points played one at a time, a check graded on the spot, a turn being
// written (a lesson too) with its progress, a failed turn, an answer's versions and "Regenerate with…", the answer that
// waits behind "the answer is ready", the questions for the prompt, the cost, the "not translated yet" note, the captions,
// playback and voice in a bar floating on the board, a rail listing every answer that flies the camera there, full screen
// for every scene. There is no stage. The room's routes are answered by the test: nothing paid runs.
//                                                                                  node tests/review-room-board-only-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-board-only-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-board-only-ui-")), data = join(tmp, "data"); mkdirSync(data);
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = process.env.BOARD_ONLY_SHOTS || join(root, "tests/out/review-room-board-only"); mkdirSync(shots, { recursive: true });
const H = "a".repeat(40), B = "b".repeat(40);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const cl = (text, cites = [], basis = cites.some((c) => c.ok) ? "cited" : "inference") => ({ text, kind: "claim", basis, cites });
const ok1 = (ref) => ({ ref, ok: true });
const OFFER = { provider: "codex", model: "gpt-6", effort: "high", paid: true, independence: { level: "same", adaptive: true, en: "Same model as the author.", zh: "和作者同一個模型。" }, hash: "feedc0ffee123456", voice: { vendor: "openai", model: "gpt-4o-mini-tts", voice: "alloy" } };
const ACTIONS = [["how", "How?", "怎麼運作？"], ["why", "Why?", "為什麼？"], ["teach", "Teach me", "教我"], ["merge-check", "Check", "檢查"], ["quiz", "Quiz", "考我"]].map(([id, en, zh]) => ({ id, en, zh }));
/** an invented room: a percent helper. Turn 1 asks how it works (a flow built up in two steps, code, a screenshot pair, a
 *  chart, a generated sketch), turn 2 asks a question (no picture), turn 3 is the same question regenerated on another tutor */
const BASE = { card: { id: "SC-80", run: "R-080", node: "merge-card", title: { en: "Merge: Add percent", "zh-TW": "合併：新增 percent" }, status: "open" }, task: { id: "R-080", title: "Add percent" }, pr: { id: 7, url: null }, head: H, base: B, open: true, running: null,
  offer: OFFER, actions: ACTIONS, autoTeach: { on: true, skipped: "No tutor can run on this Mac now" },
  board: [
    { id: "B0-1", turn: 0, type: "image", kind: "illustration", title: "This change at a glance", status: "pending", src: null, basis: "illustration", cites: [] },
    { id: "B1-1", turn: 1, type: "mermaid", title: "The flow", group: "flow", step: 1, code: "flowchart LR\n  A[amount in cents] --> B[percent]", basis: "cited", cites: [ok1("diff:src/percent.ts")] },
    { id: "B1-2", turn: 1, type: "mermaid", title: "The flow", group: "flow", step: 2, code: "flowchart LR\n  A[amount in cents] --> B[percent]\n  B -->|Math.round| C[cents]", basis: "cited", cites: [ok1("diff:src/percent.ts:L2-3")] },
    { id: "B1-3", turn: 1, type: "code", title: "The function", path: "src/percent.ts", commit: H, start: 1, end: 3, total: 5, lines: ["export function percent(amount: number, pct: number): number {", "  return Math.round((amount * pct) / 100);", "}"], highlight: [2], basis: "cited", cites: [] },
    { id: "B1-4", turn: 1, type: "diff", title: "The diff", header: "src/percent.ts", text: "@@ -0,0 +1,3 @@\n+export function percent(a, p) {\n+  return Math.round((a * p) / 100);\n+}", basis: "cited", cites: [] },
    { id: "B1-7", turn: 1, type: "screenshot", kind: "screenshot", title: "Checkout, before and after", pages: [{ label: "Checkout", before: "/api/wruns/R-080/captures/x/before/index.html.png", after: "/api/wruns/R-080/captures/x/after/index.html.png", changed: { removed: ["$19.99"], added: ["$20.00"] } }], basis: "cited", cites: [] },
    { id: "B1-8", turn: 1, type: "chart", kind: "chart", mode: "diffstat", from: "git", title: "Lines changed", unit: "lines", rows: [{ label: "src/percent.ts", added: 4, removed: 0 }], basis: "cited", cites: [] },
    { id: "B1-9", turn: 1, type: "image", kind: "illustration", status: "ready", title: "Rounding, sketched", src: "/api/review-room/SC-80/image/B1-9.png", provider: "codex", model: "img-1", basis: "illustration", cites: [] }],
  turns: [
    { n: 1, action: "how", text: "How does this change work?", lang: "en", status: "done", provider: "codex", model: "gpt-6", cost: { usd: 0.04 }, answer: "x", head: H,
      claims: [{ text: "## How percent works", kind: "heading", basis: null, cites: [] }, cl("An amount in cents goes into `percent` [board:B1-1].", [ok1("board:B1-1")]), cl("It is rounded to whole cents [board:B1-2].", [ok1("board:B1-2")]),
        cl("The function is three lines [board:B1-3].", [ok1("board:B1-3")]), cl("The diff adds it [board:B1-4].", [ok1("board:B1-4")]), cl("On the page the total moves by a cent [board:B1-7].", [ok1("board:B1-7")])] },
    { n: 2, action: "ask", text: "Why round at all?", lang: "en", status: "done", provider: "codex", model: "gpt-6", cost: { usd: 0.02 }, answer: "y", head: H, claims: [cl("Invoices are in whole cents [diff:src/percent.ts].", [ok1("diff:src/percent.ts")]), cl("A fraction would not add up.")] },
    { n: 3, action: "ask", text: "Why round at all?", regenOf: 2, lang: "en", status: "done", provider: "claude", model: "opus-x", answer: "z", head: H, claims: [cl("Said again: whole cents [diff:src/percent.ts].", [ok1("diff:src/percent.ts")])] }],
  tutors: [{ provider: "codex", model: "gpt-6", effort: "high", runnable: true, held: null, level: "same", current: true }, { provider: "claude", model: "opus-x", effort: null, runnable: true, held: null, level: "vendor", current: false }],
  sources: [], notes: [], diffstat: { files: [{ path: "src/percent.ts", added: 4, removed: 0 }, { path: "test/percent.test.ts", added: 3, removed: 1 }], total: { files: 2, added: 7, removed: 1 }, from: "git" },
  check: { questions: [{ n: 1, q: "What does percent(1999, 15) return? Answer below.", turn: 1, at: "t" }] } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const stubs = () => { window.__spoken = []; const v = [{ name: "Ava (Premium)", lang: "en-US", localService: true, voiceURI: "ava" }];
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => v, speak: (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 5); }, cancel: () => {} } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; }; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
  window.Audio = function (src) { const a = { src, currentTime: 0, duration: 10, play: async () => { window.__audio = a; }, pause() {} }; return a; }; };
/** a page on the room; `room` is what the room route answers (a function: answered fresh each time) */
async function open(width, room, o = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: o.dark ? "dark" : "light", reducedMotion: "reduce" });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [o.lang || "en"]);
  await ctx.addInitScript(stubs);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/api\/remote\/me$/, (r) => r.fulfill({ json: { kind: width < 600 ? "phone" : "desktop", device: null } }));
  const S = { posts: [], picks: [], arrives: [] };
  await ctx.route(/\/api\/review-room\/SC-80(\?open=1)?$/, (r) => r.fulfill({ json: typeof room === "function" ? room() : room }));
  await ctx.route(/\/api\/review-room\/SC-80\/image\//, (r) => r.fulfill({ body: PNG, contentType: "image/png" }));
  await ctx.route(/\/api\/wruns\/R-080\/captures\//, (r) => r.fulfill({ body: PNG, contentType: "image/png" }));
  await ctx.route(/\/api\/review-room\/SC-80\/lesson$/, (r) => r.fulfill({ json: { visited: [] } }));
  // arriving in the room: what the page sends back (the plan it was shown), answered a moment later with the room, its analysis started
  await ctx.route(/\/api\/review-room\/SC-80\/arrive$/, (r) => { S.arrives.push(JSON.parse(r.request().postData() || "{}")); const rm = clone(typeof room === "function" ? room() : room); rm.arrive = null; setTimeout(() => r.fulfill({ json: { room: rm } }).catch(() => {}), o.arriveMs ?? 50); });
  await ctx.route(/\/api\/review-room\/SC-80\/turn$/, (r) => { S.posts.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 409, json: { error: "confirm", code: "confirm_required", offer: OFFER } }); });
  await ctx.route(/\/api\/review-room\/SC-80\/check-answer$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); S.picks.push(b); const rm = clone(typeof room === "function" ? room() : room);
    rm.check.questions = rm.check.questions.map((q) => q.n === b.n ? { ...q, choice: b.choice, answer: 0, why: "Math.round rounds 299.85 up", cites: [], result: { correct: b.choice === 0, note: "n", turn: 4, choice: b.choice, by: "studio" } } : q);
    r.fulfill({ json: { n: b.n, correct: b.choice === 0, room: rm } }); });
  if (o.routes) await o.routes(ctx, S); // registered last: they answer before the defaults above
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e.message}`));
  await p.goto(`${base}/#/room/SC-80`); await p.waitForSelector("#view .rr-room", { timeout: 15000 }); await p.waitForTimeout(400);
  return { ctx, p, S };
}
/** where the board stands and what its parts are */
const board = (p) => p.evaluate(() => { const b = document.querySelector('[data-board]');
  return { board: !!b, cur: b?.dataset.scene ?? null, stage: !!document.querySelector(".rr-stage, [data-stage]"), regions: [...document.querySelectorAll("[data-region]")].map((e) => e.dataset.region) }; });
const inRegion = (p, key, q) => p.evaluate(([k, s]) => { const r = document.querySelector(`[data-board] [data-region="${k}"]`); return r ? [...r.querySelectorAll(s)].map((e) => e.textContent) : null; }, [key, q]);
/** a click that may find nothing (on a page without the part, the check that follows fails, the suite goes on) */
const tap = (p, sel, o = {}) => p.click(sel, { timeout: 2500, ...o }).catch(() => {});
const cam = (p) => p.evaluate(() => window.crewReviewRoom?.board?.camOf?.("SC-80") || null);

try {
  // ---------- the welcome, alone: an empty board with the lesson button and the auto-teach note ----------
  { const { ctx, p, S } = await open(1440, { ...clone(BASE), turns: [], board: [BASE.board[0]], check: { questions: [] } });
    const b = await board(p), teach = await inRegion(p, "t0", "[data-welcome-teach]"), skipped = await inRegion(p, "t0", "[data-auto-skipped]"), hint = await inRegion(p, "t0", "[data-board-empty]");
    ok(b.board && !b.stage && JSON.stringify(b.regions) === '["t0"]' && b.cur === "t0", "a new room opens on the board, its welcome a region; there is no stage", JSON.stringify(b));
    ok(teach?.length === 1 && /Teach me this change/.test(teach[0]) && /Studio did not start the lesson by itself: No tutor can run/.test(skipped?.[0] || "") && /Each answer becomes a block on this board/.test(hint?.[0] || ""), "the welcome region holds “Teach me this change”, why auto-teach was skipped, and what the board is for", JSON.stringify({ teach, skipped, hint }));
    await tap(p, '[data-region="t0"] [data-welcome-teach]'); await p.waitForSelector('[data-room-confirm="teach"]', { timeout: 3000 }).catch(() => {});
    ok(!!(await p.$('[data-room-confirm="teach"]')) && !S.posts.length, "its lesson button asks to confirm the paid round first");
    await p.screenshot({ path: join(shots, "welcome-1440.png") });
    await ctx.close(); }

  // ---------- arriving in a room starts its full analysis by itself: the welcome says so, the page sends back the plan it was shown ----------
  { const ARR = { auto: true, provider: "codex", model: "gpt-6", effort: "high", paid: true, images: false, createsHost: false, plan: "fp-arrive-1" };
    const fresh = () => ({ ...clone(BASE), turns: [], board: [BASE.board[0]], check: { questions: [] }, autoTeach: { on: true }, arrive: ARR });
    const { ctx, p, S } = await open(1440, fresh, { arriveMs: 1500 });
    await p.waitForFunction(() => !!document.querySelector('[data-region="t0"] [data-arrive]'), null, { timeout: 3000 }).catch(() => {});
    const line = await inRegion(p, "t0", "[data-arrive]");
    for (let i = 0; i < 40 && !S.arrives.length; i++) await p.waitForTimeout(50);
    ok(/Arriving here starts the full analysis by itself: one paid model round on codex · gpt-6 \(high\)/.test(line?.[0] || ""), "a room whose analysis starts on arrival says so on its welcome, with the tutor and the paid round", JSON.stringify(line));
    ok(S.arrives.length === 1 && S.arrives[0].plan === "fp-arrive-1" && !S.posts.length, "entering the room sends its arrival once, with the plan it was shown: no click, no confirmation", JSON.stringify({ arrives: S.arrives, posts: S.posts.length }));
    await p.waitForTimeout(1700); await p.evaluate(() => render()); await p.waitForTimeout(150);
    ok(S.arrives.length === 1, "redrawn, the same room on the same head sends no second arrival", String(S.arrives.length));
    await p.screenshot({ path: join(shots, "arrival-1440.png") });
    await ctx.close(); }
  // the terms changed under the page: nothing started, and nothing is sent again by itself; a room with pictures on says so
  { const ARR = { auto: true, provider: "codex", model: "gpt-6", effort: "high", paid: true, images: true, createsHost: false, plan: "fp-old" };
    let head = "h1"; const now = () => ({ ...clone(BASE), head, turns: [], board: [BASE.board[0]], check: { questions: [] }, autoTeach: { on: true }, arrive: { ...ARR, plan: head === "h1" ? "fp-old" : "fp-h2" } });
    const { ctx, p, S } = await open(1440, now, { routes: async (c, S2) => { await c.route(/\/api\/review-room\/SC-80\/arrive$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); S2.arrives.push(b);
      const rm = now(); if (b.plan === "fp-old") { rm.arrive = { ...ARR, plan: "fp-new" }; return r.fulfill({ json: { room: rm, plan: { ...ARR, plan: "fp-new" } } }); } rm.arrive = null; r.fulfill({ json: { room: rm } }); }); } });
    for (let i = 0; i < 30 && !S.arrives.length; i++) await p.waitForTimeout(50);
    const pics = await inRegion(p, "t0", '[data-arrive="on"]'); await p.waitForTimeout(800); await p.evaluate(() => render()); await p.waitForTimeout(300);
    const err = await p.$eval("[data-room-error]", (e) => e.textContent).catch(() => null);
    ok(/generated pictures are on in this room: the tutor may ask for up to two, and an opening picture is made once, each a paid image job/.test(pics?.[0] || ""), "the arrival line names the room's paid pictures too, when they are on", JSON.stringify(pics));
    ok(S.arrives.length === 1 && /What arriving starts has changed/.test(err || ""), "when what arriving starts changed under the page, nothing starts and nothing is sent again by itself; the room says so", JSON.stringify({ arrives: S.arrives.map((x) => x.plan), err }));
    // the captain comes back later from the room list: the room is read again, and its new head is analysed by itself
    head = "h2"; await p.evaluate(() => { location.hash = "#/room"; }); await p.waitForTimeout(400); await p.evaluate(() => { location.hash = "#/room/SC-80"; });
    for (let i = 0; i < 40 && S.arrives.length < 2; i++) await p.waitForTimeout(50);
    ok(S.arrives.length === 2 && S.arrives[1].plan === "fp-h2", "coming back to the room (the room list, a link) reads it again: a head that moved meanwhile is analysed by itself", JSON.stringify(S.arrives.map((x) => x.plan)));
    await ctx.close(); }
  { const { ctx, p, S } = await open(390, () => ({ ...clone(BASE), turns: [], board: [BASE.board[0]], check: { questions: [] }, arrive: { auto: true, provider: "codex", model: "gpt-6", effort: null, paid: true, plan: "fp-arrive-2" } }));
    await p.waitForTimeout(700); ok(!S.arrives.length, "a paired phone never starts a paid analysis by arriving (it only reads the room)", String(S.arrives.length)); await ctx.close(); }
  { const { ctx, p, S } = await open(1440, () => ({ ...clone(BASE), turns: [], board: [BASE.board[0]], check: { questions: [] }, arrive: { auto: true, error: "No tutor can run on this Mac now", code: "no_tutor" } }));
    await p.waitForTimeout(500); const why = await inRegion(p, "t0", '[data-arrive="none"]');
    ok(!S.arrives.length && /Studio cannot start the full analysis by itself: No tutor can run/.test(why?.[0] || ""), "when the analysis cannot start on arrival, nothing is sent and the welcome says why", JSON.stringify({ why, arrives: S.arrives.length })); await ctx.close(); }

  // ---------- an answer's scene: its pictures and points, played one at a time from the floating bar ----------
  { const { ctx, p } = await open(1440, clone(BASE));
    const b = await board(p);
    ok(b.board && !b.stage && JSON.stringify(b.regions) === '["t0","t1","t3"]' && b.cur === "t3", "every answer is a region of the board, a row per turn; the room opens on the latest", JSON.stringify(b));
    await tap(p, '[data-outline="t1"]'); await p.waitForTimeout(300);
    const kinds = await p.evaluate(() => { const r = document.querySelector('[data-region="t1"]'); return { visual: r?.querySelector("[data-visual]")?.dataset.visual, picks: [...(r?.querySelectorAll("[data-visual-pick]") || [])].map((e) => e.dataset.visualPick), points: r?.querySelectorAll(".rr-point").length, cur: document.querySelector('[data-board]')?.dataset.scene ?? null }; });
    ok(kinds.cur === "t1" && kinds.visual === "B1-7" && JSON.stringify(kinds.picks) === '["B1-1","B1-2","B1-3","B1-4","B1-7","B1-8","B1-9"]' && kinds.points === 5, "a rail entry flies the board to that answer: its picture (the one its last point cites), every other picture a chip away, all its points", JSON.stringify(kinds));
    await tap(p, '[data-region="t1"] [data-visual-pick="B1-3"]'); const code = await inRegion(p, "t1", "[data-visual] .rr-code [data-line]");
    await tap(p, '[data-region="t1"] [data-visual-pick="B1-4"]'); const diff = await inRegion(p, "t1", "[data-visual] .rr-diff .add");
    await tap(p, '[data-region="t1"] [data-visual-pick="B1-8"]'); const chart = await p.$eval('[data-region="t1"] [data-visual] [data-chart]', (e) => e.dataset.chart).catch(() => null);
    await tap(p, '[data-region="t1"] [data-visual-pick="B1-9"]'); const img = await p.$eval('[data-region="t1"] [data-visual] [data-illustration]', (e) => e.getAttribute("src")).catch(() => null);
    await tap(p, '[data-region="t1"] [data-visual-pick="B1-7"]'); await tap(p, '[data-region="t1"] [data-shot-toggle="before"]'); const shot = await p.$eval('[data-region="t1"] [data-visual] [data-shot-img]', (e) => e.dataset.shotImg).catch(() => null);
    ok(code?.length === 3 && diff?.length === 3 && chart === "diffstat" && /B1-9\.png$/.test(img || "") && shot === "before", "on the board the answer shows its code, its diff, its chart, its generated picture and its screenshots before and after", JSON.stringify({ code: code?.length, diff: diff?.length, chart, img, shot }));
    // played from the floating bar: the points not reached yet are dimmed, the picture follows the point, the caption reads it
    const bar = await p.evaluate(() => { const b = document.querySelector('[data-board] [data-playbar]'); return b && { play: !!b.querySelector("[data-play]"), replay: !!b.querySelector("[data-replay]"), voice: !!b.querySelector("[data-voice]"), caption: !!b.querySelector("[data-caption]"), next: !!b.querySelector("[data-point-next]"), scene: b.querySelector("[data-scene-pos]")?.dataset.scenePos }; });
    ok(bar && bar.play && bar.replay && bar.voice && bar.caption && bar.next && bar.scene === "2/3", "the captions, playback (a point back and on, play, replay, the scene) and the voice picker float on the board", JSON.stringify(bar));
    await tap(p, "[data-playbar] [data-replay]"); await tap(p, "[data-playbar] [data-play]");
    const r1 = await p.evaluate(() => { const r = document.querySelector('[data-region="t1"]'); if (!r) return {}; return { shown: r.querySelectorAll(".rr-point:not(.later)").length, later: r.querySelectorAll(".rr-point.later").length, visual: r.querySelector("[data-visual]").dataset.visual, nodes: [...r.querySelectorAll("[data-visual] [data-node]")].map((n) => n.dataset.node), caption: document.querySelector("[data-playbar] [data-caption-text]")?.textContent ?? "" }; });
    await tap(p, "[data-playbar] [data-point-next]");
    const r2 = await p.evaluate(() => { const r = document.querySelector('[data-region="t1"]'); if (!r) return {}; return { shown: r.querySelectorAll(".rr-point:not(.later)").length, visual: r.querySelector("[data-visual]").dataset.visual, nodes: [...r.querySelectorAll("[data-visual] [data-node]")].map((n) => n.dataset.node + (n.classList.contains("rr-new") ? "*" : "")), caption: document.querySelector("[data-playbar] [data-caption-text]")?.textContent ?? "" }; });
    ok(r1.shown === 1 && r1.later === 4 && r1.visual === "B1-1" && r1.nodes.join() === "A,B" && /An amount in cents goes into percent/.test(r1.caption) && r2.shown === 2 && r2.visual === "B1-2" && r2.nodes.join() === "A,B,C*" && /rounded to whole cents/.test(r2.caption),
      "point by point on the board: the first point and the flow's first step, then the next point brings the next step (its new part marked) and the caption reads it", JSON.stringify({ r1, r2 }));
    // the keyboard: → the next point while a scene is being played, a Space tap plays and pauses
    await tap(p, "[data-board-vp]", { position: { x: 30, y: 30 } }); await p.keyboard.press("ArrowRight"); const k3 = await p.$eval('[data-region="t1"] [data-point-pos]', (e) => e.dataset.pointPos).catch(() => null);
    await p.keyboard.press(" "); const playing = await p.$eval("[data-playbar] [data-play]", (e) => e.getAttribute("aria-pressed")).catch(() => null); await p.keyboard.press(" "); const paused = await p.$eval("[data-playbar] [data-play]", (e) => e.getAttribute("aria-pressed")).catch(() => null);
    ok(k3 === "3/5" && playing === "true" && paused === "false", "→ shows the next point of the scene being played; a Space tap plays and pauses", JSON.stringify({ k3, playing, paused }));
    // the cost and the answer's questions for the prompt
    const cost = await inRegion(p, "t1", ".rr-cost"), qs = await inRegion(p, "t1", "[data-scene-check]");
    ok(/\$0\.04 · codex · gpt-6/.test(cost?.[0] || "") && /Questions for you \(answer in the prompt below\)/.test(qs?.[0] || "") && /percent\(1999, 15\)/.test(qs?.[0] || ""), "an answer's region shows what it cost and the questions it asks to answer in the prompt", JSON.stringify({ cost, qs }));
    await p.screenshot({ path: join(shots, "answer-1440.png") });
    // versions of one question and Regenerate with…
    await tap(p, '[data-outline="t3"]'); await p.waitForTimeout(250);
    const vers = await p.$$eval('[data-region="t3"] [data-version-pick]', (els) => els.map((e) => [e.dataset.versionPick, e.getAttribute("aria-pressed")]));
    await tap(p, '[data-region="t3"] [data-version-pick="2"]'); await p.waitForTimeout(200); const back = await board(p);
    await tap(p, '[data-region="t2"] [data-regen]'); const list = await p.$$eval('[data-region="t2"] [data-regen-pick]', (els) => els.map((e) => e.dataset.regenPick));
    ok(JSON.stringify(vers) === '[["2","false"],["3","true"]]' && back.regions.includes("t2") && !back.regions.includes("t3") && JSON.stringify(list) === '["codex|gpt-6","claude|opus-x"]', "a question answered twice shows a version switcher on its region; “Regenerate with…” lists this machine's tutors there", JSON.stringify({ vers, back, list }));
    // the rail lists every answer and pans the board; no "Other scenes"
    const c0 = await cam(p); await tap(p, '[data-outline="t0"]'); await p.waitForTimeout(300); const c1 = await cam(p);
    const rail = await p.evaluate(() => ({ groups: [...document.querySelectorAll("[data-outline-turn]")].map((e) => e.textContent), items: [...document.querySelectorAll("[data-outline]")].map((e) => e.dataset.outline), other: !!document.querySelector("[data-other-scene]"), cur: document.querySelector('[data-board]')?.dataset.scene ?? null }));
    ok(JSON.stringify(rail.items) === '["t0","t1","t2"]' && rail.groups.length === 3 && /Why round at all/.test(rail.groups[2]) && !rail.other && rail.cur === "t0" && c0 && c1 && (c0.x !== c1.x || c0.y !== c1.y), "the rail lists every answer under its question and flies the camera to it (no “Other scenes”, no stage)", JSON.stringify({ rail, c0, c1 }));
    await ctx.close(); }

  // ---------- a check: multiple choice graded on the spot, a miss re-explained ----------
  { const MC = [{ n: 3, q: "What does percent(1999, 15) return?", turn: 4, at: "t", options: ["300", "299", "299.85"] }, { n: 4, q: "Where could rounding surprise a user?", turn: 4, at: "t", options: ["Negative amounts", "Halves of a cent"] }];
    const room = { ...clone(BASE), turns: [...clone(BASE.turns), { n: 4, action: "quiz", text: "Check my understanding.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "q", head: H, claims: [cl("Two questions are on the board.")] }], check: { questions: MC } };
    const { ctx, p, S } = await open(1440, room);
    const b = await board(p), opts = await p.$$eval('[data-region="t4-quiz"] [data-quiz-option]', (els) => els.map((e) => e.dataset.quizOption));
    ok(b.cur === "t4-quiz" && JSON.stringify(opts) === '["3:0","3:1","3:2","4:0","4:1"]', "a check is a region of the board: every question's options", JSON.stringify({ b, opts }));
    await tap(p, '[data-region="t4-quiz"] [data-quiz-option="3:1"]'); await p.waitForSelector('[data-region="t4-quiz"] [data-quiz-verdict]', { timeout: 5000 }).catch(() => {});
    const v = await p.evaluate(() => ({ verdict: document.querySelector('[data-region="t4-quiz"] [data-quiz-verdict]')?.dataset.quizVerdict, reteach: !!document.querySelector('[data-region="t4-quiz"] [data-quiz-reteach]') }));
    await tap(p, '[data-region="t4-quiz"] [data-quiz-reteach]').catch(() => {}); await p.waitForSelector('[data-room-confirm="ask"]', { timeout: 3000 }).catch(() => {});
    ok(JSON.stringify(S.picks) === '[{"n":3,"choice":1}]' && v.verdict === "missed" && v.reteach && !!(await p.$('[data-room-confirm="ask"]')) && !S.posts.length, "a pick is graded on the board at once; a miss offers “re-explain with the board”, confirmed first", JSON.stringify({ picks: S.picks, v }));
    await ctx.close(); }

  // ---------- a turn being written (a lesson too), then failed; the answer that finished while the captain looked away ----------
  { let now = { ...clone(BASE), running: 4, progress: { turn: 4, status: "running", said: "Reading the diff and the tests first.", tools: 3, at: "t" },
      turns: [...clone(BASE.turns), { n: 4, action: "teach", text: "Teach me this change.", lang: "en", status: "running", provider: "codex", model: "gpt-6", answer: "", head: H,
        scenes: [{ n: 1, chapter: "what", title: "A percent helper", picture: "", points: [cl("It adds percent.")] }] }] };
    const { ctx, p } = await open(1440, () => now);
    const b = await board(p), run = await p.evaluate(() => { const r = document.querySelector('[data-region="t4"]'); return r && { progress: r.querySelector("[data-turn-progress]")?.textContent, working: r.querySelector("[data-turn-running]")?.textContent, drawing: !!r.querySelector("[data-visual-drawing]"), title: r.querySelector("[data-scene-title]")?.textContent, rail: !!document.querySelector('[data-outline="t4"] [data-outline-running]') }; });
    ok(b.cur === "t4" && run && /3 tool calls so far/.test(run.progress || "") && /Reading the diff/.test(run.progress || "") && /The tutor is working \(codex · gpt-6\)/.test(run.working || "") && run.drawing && run.title === "A percent helper" && run.rail,
      "a lesson still being written is on the board: the chapters it has made so far, its tool calls and what it said, “the tutor is drawing”, marked running in the rail", JSON.stringify({ b, run }));
    await p.screenshot({ path: join(shots, "running-1440.png") });
    // the captain looks elsewhere; the turn finishes: a chip waits on the board
    await tap(p, '[data-outline="t1"]'); await p.waitForTimeout(200);
    now = { ...now, running: null, progress: null, turns: now.turns.map((t) => t.n === 4 ? { ...t, status: "done", answer: "y", claims: [cl("x")], scenes: [{ n: 1, chapter: "what", title: "A percent helper", picture: "", points: [cl("It adds percent."), cl("Rounded.")] }, { n: 2, chapter: "watch", title: "What to watch", picture: "", points: [cl("Halves round up.")] }] } : t) };
    const chip = await p.waitForSelector('[data-board] [data-answer-ready]', { timeout: 15000 }).then(() => true, () => false), stay = (await board(p)).cur;
    await tap(p, "[data-answer-ready]"); await p.waitForTimeout(300); const went = await board(p);
    ok(chip && stay === "t1" && went.cur === "t4" && went.regions.includes("t4-2") && went.regions.includes("end"), "the answer that finished while the captain looked away waits behind “The answer is ready — show it” on the board; the chip flies to it, now a lesson's chapters", JSON.stringify({ chip, stay, went }));
    await ctx.close(); }
  // ---------- review: the captain pans away while a turn runs; a lesson chapter played, then "Your questions"; a narrow board ----------
  { let now = { ...clone(BASE), running: 4, progress: { turn: 4, status: "running", said: "Reading.", tools: 1, at: "t" },
      turns: [...clone(BASE.turns), { n: 4, action: "why", text: "Why now?", lang: "en", status: "running", provider: "codex", model: "gpt-6", answer: "", head: H }] };
    const { ctx, p } = await open(1440, () => now);
    const vr = await p.$eval("[data-board-vp]", (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top }; });
    await p.mouse.move(vr.x + 500, vr.y + 120); await p.mouse.down(); await p.mouse.move(vr.x + 300, vr.y + 420, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(150);
    const c0 = await cam(p);
    now = { ...now, running: null, progress: null, turns: now.turns.map((t) => (t.n === 4 ? { ...t, status: "done", answer: "y", claims: [cl("Because now.")] } : t)) };
    const chip = await p.waitForSelector("[data-board] [data-answer-ready]", { timeout: 15000 }).then(() => true, () => false), c1 = await cam(p);
    ok(chip && c0 && c1 && Math.abs(c0.x - c1.x) < 1 && Math.abs(c0.y - c1.y) < 1, "the captain dragged the board while a turn ran: the finished answer waits behind its chip, the camera stays where the captain left it", JSON.stringify({ chip, c0, c1 }));
    await ctx.close(); }
  { const room = { ...clone(BASE), turns: [...clone(BASE.turns), { n: 4, action: "teach", text: "Teach me this change.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "y", head: H, claims: [cl("x")],
      scenes: [{ n: 1, chapter: "what", title: "A percent helper", picture: "", points: [cl("It adds percent."), cl("Rounded to the cent."), cl("Halves go up.")] }, { n: 2, chapter: "watch", title: "What to watch", picture: "", points: [cl("Halves round up."), cl("Old rows keep fractions.")] }] }],
      lesson: { threads: [], visited: ["t4", "t4-2", "end"] } };
    const { ctx, p } = await open(1440, room);
    await tap(p, '[data-outline="t4"]'); await p.waitForTimeout(200); await tap(p, "[data-playbar] [data-play]"); const playing = await p.$eval("[data-playbar] [data-play]", (e) => e.getAttribute("aria-pressed")).catch(() => null);
    await tap(p, '[data-outline="end"]'); await p.waitForTimeout(250);
    const after = await p.evaluate(() => ({ cur: document.querySelector("[data-board]")?.dataset.scene, bar: !!document.querySelector("[data-playbar]"), playing: document.querySelector("[data-playbar] [data-play]")?.getAttribute("aria-pressed") ?? null }));
    ok(playing === "true" && after.cur === "end" && !after.bar && after.playing === null, "flying to “Your questions” while a chapter plays stops it; the play bar does not show there", JSON.stringify({ playing, after }));
    await ctx.close();
    // a board narrowed by the questions panel at 1280: every control of the play bar stays inside it
    const { ctx: c2, p: p2 } = await open(1280, room);
    await tap(p2, '[data-outline="t1"]'); await p2.waitForTimeout(250);
    const fit = await p2.evaluate(() => { const bar = document.querySelector("[data-playbar]"); if (!bar) return null; const b = bar.getBoundingClientRect(), notes = !!document.querySelector("[data-board-notes]");
      const els = [...bar.querySelectorAll(".rr-ibtn, .rr-mini, select")], rs = els.map((e) => e.getBoundingClientRect()), name = (e) => (e.dataset.voice != null ? "voice" : Object.keys(e.dataset)[0] || e.className);
      // each control whole, inside the bar, wide enough to use (the voice list at least 120px), none over another
      const out = els.filter((e, k) => { const r = rs[k]; return r.right > b.right + 1 || r.left < b.left - 1 || r.bottom > b.bottom + 1 || (e.tagName === "SELECT" && r.width < 120)
        || rs.some((o, m) => m !== k && r.left < o.right - 1 && r.right > o.left + 1 && r.top < o.bottom - 1 && r.bottom > o.top + 1); }).map(name);
      return { notes, out, w: Math.round(b.width) }; });
    ok(fit && fit.notes && !fit.out.length, "at 1280 with the questions panel open, every play bar control fits inside the bar, whole and apart (none cut off or squeezed)", JSON.stringify(fit));
    await c2.close(); }
  { const room = { ...clone(BASE), turns: [...clone(BASE.turns), { n: 4, action: "why", text: "Why now?", lang: "en", status: "failed", error: "the tutor ended without an answer", provider: "codex", model: "gpt-6", answer: "", head: H }, { n: 5, action: "how", text: "And the tests?", lang: "en", status: "interrupted", provider: "codex", model: "gpt-6", answer: "", head: H }] };
    const { ctx, p } = await open(1440, room);
    const f = await inRegion(p, "t4", "[data-turn-failed]"), i = await inRegion(p, "t5", "[data-turn-failed]");
    ok(/Failed: the tutor ended without an answer/.test(f?.[0] || "") && /Interrupted: Studio stopped during this turn/.test(i?.[0] || ""), "a failed or interrupted turn says so in its region", JSON.stringify({ f, i }));
    await ctx.close(); }

  // ---------- a language not translated yet; a phone; full screen on an answer's scene ----------
  { // the latest answer is in Chinese, so the room reads in Chinese; the English one before it has no translation yet
    const room = { ...clone(BASE), turns: BASE.turns.map((t) => (t.n === 3 ? { ...t, lang: "zh-TW", claims: [cl("再說一次：整數分 [diff:src/percent.ts]。", [ok1("diff:src/percent.ts")])] } : t)), translations: {} };
    const { ctx, p } = await open(1440, room);
    const note = await inRegion(p, "t1", ".rr-kicker");
    ok(/Not in this language yet: shown as written/.test(note?.[0] || ""), "an answer not in the room's language yet says so on its region", JSON.stringify(note));
    await ctx.close(); }
  { const { ctx, p } = await open(390, clone(BASE));
    const ph = await p.evaluate(() => ({ board: !!document.querySelector('[data-board]'), stage: !!document.querySelector(".rr-stage, [data-stage]"), bar: !!document.querySelector("[data-playbar] [data-play]"), transcript: !!document.querySelector("[data-transcript-toggle]")?.getClientRects().length, wide: document.documentElement.scrollWidth - innerWidth }));
    ok(ph.board && !ph.stage && ph.bar && ph.transcript && ph.wide <= 0, "a phone reads the same board: the play bar on it, the transcript a tap away, nothing wider than the screen", JSON.stringify(ph));
    await ctx.close(); }
  { const { ctx, p } = await open(1440, clone(BASE)); await tap(p, '[data-outline="t1"]'); await p.waitForTimeout(250);
    await tap(p, "[data-fs-toggle]"); await p.waitForTimeout(350);
    const f = await p.evaluate(() => { const b = document.querySelector('[data-board]')?.getBoundingClientRect() || { width: 0, height: 0 }, bar = document.querySelector("[data-playbar]"); return { on: document.body.classList.contains("rr-fs"), w: Math.round(b.width), h: Math.round(b.height), W: innerWidth, H: innerHeight, bar: !!bar && bar.getClientRects().length > 0, rail: !!document.querySelector("[data-board-rail]")?.getClientRects().length, cur: document.querySelector('[data-board]')?.dataset.scene ?? null }; });
    await tap(p, "[data-playbar] [data-scene-next]"); await p.waitForTimeout(250); const nx = await board(p);
    await p.keyboard.press("Escape"); await p.waitForTimeout(250); const out = await p.evaluate(() => document.body.classList.contains("rr-fs"));
    ok(f.on && f.w >= f.W - 2 && f.h >= f.H - 2 && f.bar && !f.rail && f.cur === "t1" && nx.cur === "t3" && !out, "full screen works on an answer's scene: only the board, its play bar on it, scene navigation inside, Esc returns", JSON.stringify({ f, nx, out }));
    await ctx.close(); }
} catch (e) { fail++; console.log(`  FAIL  the suite crashed: ${e.stack || e}`); }
ok(!errors.length, "no page errors", errors.join(" | "));
await browser.close(); app.kill();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(appLog.slice(-1500)); process.exit(1); }
process.exit(0);
