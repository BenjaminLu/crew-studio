import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room's tutor chat keeps the captain's place while the room redraws (public/review-explain.js refresh, patchMsgs,
// applyKeep): a run being active polls the room every 2.5 s, and a poll redraws the chat only where it changed, never the
// messages already read. Scrolled up to read, the chat stays exactly where it is across polls and a whole-page redraw; a new
// answer then shows "↓ New messages" instead of moving it. Sitting at the end, it stays at the end as an answer comes in. The
// version menu's list and a phone's one-column room keep their place the same way. Invented data; nothing paid runs.
//        node tests/review-room-chat-scroll-ui.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-chat-scroll-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-chat-scroll-ui-")), data = join(tmp, "data"); mkdirSync(data);
const port = await freePort();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const REPO = "sample-org/money-kit", ID = `PR-${sha(REPO).slice(0, 12)}-7`, H = "a".repeat(40), B = "b".repeat(40);
const prDir = join(data, "review-room", "pr"), xdir = join(prDir, `${ID}-explain`); mkdirSync(join(xdir, "v1"), { recursive: true });
writeFileSync(join(prDir, `${ID}.json`), JSON.stringify({ schema: 1, run: "", card: ID, node: "", head: H, base: B, turns: [], board: [], sources: [], check: { questions: [] },
  subject: { kind: "pr", room: ID, url: `https://github.com/${REPO}/pull/7`, repository: REPO, number: 7, project: null, task: null },
  pr: { title: "Add percent", body: "", state: "open", merged: false, mergedAt: null, closedAt: null, draft: false, author: "someone", headRef: "percent", headRepo: REPO, baseRef: "main", head: H, base: B, files: [], notes: [], checkedAt: "2026-11-01T10:00:00Z", truncated: false } }));
const page = "<!doctype html><html><head><meta charset=\"utf-8\"><title>percent</title></head><body><h1>How percent works</h1></body></html>";
writeFileSync(join(xdir, "v1", "index.html"), page);
const v1 = { n: 1, run: 1, skill: { id: "walkthrough", v: 1, name: "walkthrough" }, at: "2026-11-01T10:01:00Z", entry: "index.html", kind: "html", files: [{ path: "index.html", bytes: Buffer.byteLength(page), sha256: sha(page) }], summary: "One page: percent", from: null };
// older outputs by another skill (the menu lists them; the stage keeps showing v1, the selected skill's newest)
const others = Array.from({ length: 30 }, (_, i) => ({ ...v1, n: i + 2, run: 1, skill: { id: "other", v: 1, name: "other" }, summary: `Another explanation, number ${i + 2}`, at: "2026-11-01T11:00:00Z" }));
writeFileSync(join(xdir, "state.json"), JSON.stringify({ schema: 1, selected: { id: "walkthrough", v: 1 }, runs: [], versions: [v1] }));
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_REVIEW_EXPLAIN_DEFAULT_SKILL: "", CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const ROOM = { card: { id: ID, run: "R-050", node: "review", title: { en: "Pull request #7: Add percent", "zh-TW": "Pull request #7：Add percent" }, status: "open" }, task: { id: "R-050", title: "Add percent" }, pr: { id: "7", url: `https://github.com/${REPO}/pull/7` }, summary: null,
  subject: { kind: "pr", room: ID, url: `https://github.com/${REPO}/pull/7`, repository: REPO, number: 7 }, head: H, base: B, open: true, running: null, diffstat: { files: [{ path: "src/percent.ts", added: 4, removed: 0 }], total: { files: 1, added: 4, removed: 0 }, from: "git" },
  offer: null, oldBoard: null, tutors: [], prState: { state: "open", draft: false, approved: false, checkedAt: "2026-11-01T10:00:00Z", headRepo: REPO, verdicts: [] } };
const ANSWER = "Rounding happens once, at the end: percent() multiplies the part by 100 first and only then divides by the total, so no intermediate value is truncated.\n\n- ratio() no longer rounds\n- format() rounds once\n\nThe old code rounded twice, once inside ratio() and once in format(), and the two could disagree by one.";
const run = (n, kind, extra = {}) => ({ n, kind, skill: { id: "walkthrough", v: 1, name: "walkthrough", sha256: "x" }, status: "done", by: "captain", at: "2026-11-01T10:00:00Z", ended: "2026-11-01T10:04:00Z", provider: "claude", model: "claude-opus-5", effort: null, confirm: "c", limitMin: 120, rounds: [], cost: { usd: 0.42 }, error: null, progress: [], from: 1, version: null, ...extra });
const ask = (n, extra = {}) => run(n, "ask", { question: `Why does 2.5 round up here (${n})?`, answer: ANSWER, cites: ["src/percent.ts:L3-L9"], ...extra });
const ASK_OFFER = { kind: "ask", skill: { id: "walkthrough", v: 1, name: "walkthrough" }, provider: "claude", model: "claude-opus-5", effort: null, paid: true, hash: "c0ffee0000000002", limitMin: 120 };
let polls = 0;
/** the room's explainer state the page reads: `asks` answered questions, then (optionally) one being answered, or a new version being made */
const S = { asks: 14, live: null, gen: false, menu: false };
const X = () => { polls++;
  const runs = [run(1, "generate", { version: 1, from: null }), ...Array.from({ length: S.asks }, (_, i) => ask(i + 2))];
  if (S.live) runs.push(ask(S.live.n, S.live.done ? {} : { status: "running", ended: null, answer: null, cost: null, progress: [{ text: `Reading the diff (poll ${polls})` }] }));
  if (S.gen) runs.push(run(90, "generate", { status: "running", ended: null, version: null, from: null, progress: [{ text: `round ${polls}` }] }));
  const running = S.gen ? 90 : S.live && !S.live.done ? S.live.n : null;
  return { selected: { id: "walkthrough", v: 1 }, skills: [{ id: "walkthrough", name: "walkthrough", description: "x", v: 1, own: true }], versions: S.menu ? [v1, ...others] : [v1], running, consent: null, log: [], settings: { limitMin: 120 }, busy: false, runs }; };

async function open(width) {
  const phone = width < 600, ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); sessionStorage.setItem("seeded", "1"); } } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed"));
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak: () => {}, cancel: () => {} } }); window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/api\/remote\/me$/, (r) => r.fulfill({ json: { kind: phone ? "phone" : "desktop", device: null } }));
  await ctx.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
  await ctx.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
  await ctx.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: X() }));
  // a question asked: the paid confirmation comes back (nothing runs)
  await ctx.route(new RegExp(`/api/review-room/${ID}/explain/ask$`), (r) => r.fulfill({ status: 409, json: { error: "confirm", code: "confirm_required", offer: ASK_OFFER } }));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e.message}`));
  await p.goto(`${base}/#/room/${ID}`);
  await p.waitForSelector("[data-x-msgs] [data-explain-answer]", { timeout: 15000 }); await p.waitForTimeout(500);
  return { ctx, p };
}
const MSGS = "[data-x-msgs]";
const pos = (p, sel = MSGS) => p.$eval(sel, (e) => ({ top: Math.round(e.scrollTop), gap: Math.round(e.scrollHeight - e.scrollTop - e.clientHeight), h: e.scrollHeight, c: e.clientHeight }));
const scrollTo = async (p, top, sel = MSGS) => { await p.$eval(sel, (e, t) => { e.scrollTop = t === "end" ? e.scrollHeight : t; }, top); await p.waitForTimeout(150); };
const pollsPast = async (p, n) => { const from = polls; const t0 = Date.now(); while (polls < from + n && Date.now() - t0 < 20000) await p.waitForTimeout(200); await p.waitForTimeout(300); return polls - from; };

try {
  // ---------- 1440: scrolled up to read while a question is being answered ----------
  S.asks = 14; S.live = { n: 16, done: false };
  const { ctx, p } = await open(1440);
  const first = await pos(p);
  ok(first.h > first.c + 600, "the conversation is long enough to scroll", JSON.stringify(first));
  ok(first.gap <= 4, "a room opened with a long conversation shows its newest message", JSON.stringify(first));
  await scrollTo(p, 400);
  await p.$eval('[data-explain-answer="4"]', (e) => { e.__seen = true; });
  const n1 = await pollsPast(p, 3);
  const a1 = await pos(p);
  ok(n1 >= 3 && Math.abs(a1.top - 400) <= 1, "scrolled up mid-run, the chat stays where the captain is reading across polls", JSON.stringify({ polls: n1, ...a1 }));
  ok(await p.$eval('[data-explain-answer="4"]', (e) => e.__seen === true), "a poll leaves the messages already read as they are (not drawn again)");
  ok(await p.$eval("[data-x-msgs]", (m) => /poll \d+/.test(m.querySelector('[data-explain-answer="16"]').textContent)), "the answer being worked on still shows its live progress");
  ok(await p.$eval("[data-explain-new]", (e) => e.hidden), "progress on the answer being made is not announced as a new message");
  // a whole-page redraw (a live update of the room) keeps the place too
  await p.evaluate(() => render()); await p.waitForTimeout(200);
  const a2 = await pos(p);
  ok(Math.abs(a2.top - 400) <= 1, "a whole-page redraw keeps the chat where the captain is reading", JSON.stringify(a2));

  // ---------- at the end: the answer comes in and the chat stays at the end ----------
  await scrollTo(p, "end");
  S.live = { n: 16, done: true };
  await pollsPast(p, 1);
  await p.waitForSelector('[data-explain-answer="16"][data-status="done"]', { timeout: 6000 });
  const b1 = await pos(p);
  ok(b1.gap <= 4, "sitting at the end, the chat stays pinned to the end as the answer arrives", JSON.stringify(b1));

  // ---------- scrolled up, a new answer arrives: no jump, a "new messages" affordance ----------
  S.asks = 15; S.live = { n: 17, done: false };
  await p.evaluate((id) => window.crewRoomExplain.load(id), ID); await p.waitForSelector('[data-explain-answer="17"][data-status="running"]');
  await p.waitForTimeout(300);
  await scrollTo(p, 300);
  S.live = { n: 17, done: true };
  await pollsPast(p, 1); await p.waitForSelector('[data-explain-answer="17"][data-status="done"]', { timeout: 6000 }); await p.waitForTimeout(200);
  const c1 = await pos(p);
  const newBtn = await p.$eval("[data-explain-new]", (e) => ({ hidden: e.hidden, r: e.getBoundingClientRect().toJSON(), m: document.querySelector("[data-x-msgs]").getBoundingClientRect().toJSON() }));
  ok(Math.abs(c1.top - 300) <= 1, "scrolled up, a new answer does not move the chat", JSON.stringify(c1));
  ok(!newBtn.hidden && newBtn.r.bottom <= newBtn.m.bottom + 1 && newBtn.r.top >= newBtn.m.top, "a new answer while scrolled up shows the new-messages button in view", JSON.stringify(newBtn));
  await p.click("[data-explain-new]"); await p.waitForTimeout(300);
  const c2 = await pos(p);
  ok(c2.gap <= 4 && await p.$eval("[data-explain-new]", (e) => e.hidden), "the new-messages button goes to the end and goes away", JSON.stringify(c2));
  const foc = await p.evaluate(() => { const a = document.activeElement, m = document.querySelector("[data-x-msgs]"), last = [...m.children].reverse().find((c) => c.dataset.k !== "new"); return { tag: a?.tagName, isLast: a === last, k: a?.dataset?.k }; });
  ok(foc.isLast && foc.k === "a17", "pressing it moves the focus to the newest message, not <body>", JSON.stringify(foc));
  ok(await p.$eval("[data-explain-announce]", (e) => e.getAttribute("aria-live") === "polite" && /New message/.test(e.textContent)), "a polite live region said the new message");
  await pollsPast(p, 0); await p.evaluate((id) => window.crewRoomExplain.load(id), ID); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.activeElement?.dataset?.k === "a17"), "the next redraw keeps the focus on that same message");

  // ---------- scrolled up, the captain asks: their own question and its confirmation come into view, not "New messages" ----------
  await scrollTo(p, 300);
  await p.fill("[data-explain-q]", "And what about negative numbers?");
  await p.click("[data-explain-send]");
  await p.waitForSelector("[data-explain-askconfirm]", { timeout: 6000 }); await p.waitForTimeout(250);
  const own = await p.evaluate(() => { const m = document.querySelector("[data-x-msgs]"), c = document.querySelector("[data-explain-askconfirm]").getBoundingClientRect(), r = m.getBoundingClientRect();
    return { inView: c.top >= r.top - 1 && c.bottom <= r.bottom + 1, top: m.scrollTop, news: !document.querySelector("[data-explain-new]").hidden, pending: !!document.querySelector("[data-explain-pending]") }; });
  ok(own.inView && own.top > 300 && own.pending, "the captain's own question and its confirmation are scrolled into view", JSON.stringify(own));
  ok(!own.news, "the captain's own messages are not announced as new messages", JSON.stringify(own));

  // ---------- the version menu's list keeps its place across polls ----------
  S.menu = true; S.gen = true; S.live = null;
  await p.evaluate((id) => window.crewRoomExplain.load(id), ID); await p.waitForSelector("[data-explain-genstrip]");
  await p.click("[data-explain-versions]"); await p.waitForSelector("[data-explain-vermenu]");
  const vm = await pos(p, "[data-explain-vermenu]");
  ok(vm.h > vm.c + 300, "the version menu's list scrolls", JSON.stringify(vm));
  await scrollTo(p, 250, "[data-explain-vermenu]");
  const n2 = await pollsPast(p, 2);
  const vm2 = await pos(p, "[data-explain-vermenu]");
  ok(n2 >= 2 && Math.abs(vm2.top - 250) <= 1, "the version menu's list stays where it was across polls", JSON.stringify({ polls: n2, ...vm2 }));
  S.gen = false; S.menu = false;
  await ctx.close();

  // ---------- a phone: the room scrolls as one column; it keeps its place across polls and a redraw ----------
  S.asks = 14; S.live = { n: 16, done: false };
  const ph = await open(390);
  const BODY = ".rx-body";
  const pb = await pos(ph.p, BODY);
  ok(pb.top === 0, "a phone opens the room at the output (top), not the chat's end", JSON.stringify(pb));
  const mid = Math.round((pb.h - pb.c) * 0.6);
  await scrollTo(ph.p, mid, BODY);
  const n3 = await pollsPast(ph.p, 2);
  const pb2 = await pos(ph.p, BODY);
  ok(n3 >= 2 && Math.abs(pb2.top - mid) <= 1, "390: scrolled into the chat, the room stays where it was across polls", JSON.stringify({ polls: n3, mid, ...pb2 }));
  await ph.p.evaluate(() => render()); await ph.p.waitForTimeout(200);
  const pb3 = await pos(ph.p, BODY);
  ok(Math.abs(pb3.top - mid) <= 1, "390: a whole-page redraw keeps the place", JSON.stringify({ mid, ...pb3 }));
  ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390: no sideways scroll");
  await ph.ctx.close();
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-2000)); }
finally { await browser.close().catch(() => {}); app.kill(); }
console.log(`review-room-chat-scroll-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
