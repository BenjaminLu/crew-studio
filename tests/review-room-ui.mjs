import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room on the page (public/review-room.js, public/scard.js; docs/units/review-room.md): the merge card's "Open review
// room" entry and summary; the room's routes; the way back (the sidebar, the room list, the crumb); focus mode; a room from before
// with its whiteboard (one line, its record as a file, no board drawn); the pull request box (baton starts on opening, nothing
// else is sent); the real routes. The skill's page and its Q&A are tests/review-room-explain-ui.mjs. Nothing paid runs.
//        node tests/review-room-ui.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-room-ui-")), data = join(tmp, "data"); mkdirSync(data);
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
const shots = process.env.ROOM_SHOTS || join(root, "tests/out/review-room"); mkdirSync(shots, { recursive: true });
const H = "a".repeat(40), B = "b".repeat(40);
const summary = { href: "#/room/SC-50", opened: true, versions: 3, questions: 2, usd: 1.234, running: false, latest: { n: 3, at: "2026-11-01T10:03:00Z", skill: "baton (built in)" } };
const card = (kind, extra = {}) => ({ id: kind === "merge" ? "SC-50" : "SC-49", run: "R-050", node: kind === "merge" ? "merge-card" : "dispatch", workflow: "code-firstmate", kind, status: "open", title: { en: `${kind} card`, "zh-TW": `${kind} 卡` }, body: "", sections: { en: { why: "w" }, "zh-TW": { why: "w" } },
  options: [{ id: "merge", label: "Merge", labelZh: "合併", primary: true }, { id: "close", label: "Close without merging", labelZh: "不合併，關閉", hold: true }], createdAt: "2026-10-28T10:00:00Z", answer: null, ...extra });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const cl = (text, cites = [], basis = cites.some((c) => c.ok) ? "cited" : "inference") => ({ text, kind: "claim", basis, cites });
const ok1 = (ref) => ({ ref, ok: true });
const ROOM = { card: { id: "SC-50", run: "R-050", node: "merge-card", title: { en: "Merge: Add percent", "zh-TW": "合併：新增 percent" }, status: "open" }, task: { id: "R-050", title: "Add percent" }, pr: { id: 7, url: null }, head: H, base: B, open: true, running: null,
  offer: { provider: "codex", model: "gpt-6", effort: "high", paid: true, independence: { level: "same", adaptive: true, en: "Same model as the author: a fresh context, not an independent opinion. Only one model is usable on this machine (codex gpt-6).", zh: "和作者同一個模型：是新的脈絡，不是獨立意見。這台機器只有一個可用的模型（codex gpt-6）。" }, hash: "feedc0ffee123456", voice: { vendor: "openai", model: "gpt-4o-mini-tts", voice: "alloy" } },
  actions: [["how", "How does this change work?", "這個改動是怎麼運作的？"], ["why", "Why?", "為什麼？"], ["teach", "Teach me", "教我"], ["merge-check", "Check", "檢查"], ["quiz", "Quiz", "考我"]].map(([id, en, zh]) => ({ id, en, zh })),
  board: [
    { id: "B0-1", turn: 0, type: "image", kind: "illustration", title: "This change at a glance", status: "pending", src: null, basis: "illustration", cites: [] },
    { id: "B1-1", turn: 1, type: "mermaid", title: "The flow", group: "flow", step: 1, code: "flowchart LR\n  A[amount in cents] --> B[percent]", basis: "cited", cites: [ok1("diff:src/percent.ts")] },
    { id: "B1-2", turn: 1, type: "mermaid", title: "The flow", group: "flow", step: 2, code: "flowchart LR\n  A[amount in cents] --> B[percent]\n  B -->|Math.round| C[cents]", basis: "cited", cites: [ok1("diff:src/percent.ts:L2-3")] },
    { id: "B1-3", turn: 1, type: "code", title: "The function", path: "src/percent.ts", commit: H, start: 1, end: 4, total: 5, lines: ["// A percent", "export function percent(amount: number, pct: number): number {", "  return Math.round((amount * pct) / 100);", "}"], highlight: [3], basis: "cited", cites: [] },
    { id: "B1-7", turn: 1, type: "screenshot", kind: "screenshot", title: "Checkout, before and after", pages: [{ label: "Checkout", before: "/api/wruns/R-050/captures/x/before/index.html.png", after: "/api/wruns/R-050/captures/x/after/index.html.png", changed: { removed: ["$19.99"], added: ["$20.00"] } }], basis: "cited", cites: [] },
    { id: "B1-8", turn: 1, type: "chart", kind: "chart", mode: "diffstat", from: "git", title: "Lines changed", unit: "lines", rows: [{ label: "src/percent.ts", added: 4, removed: 0 }, { label: "test/percent.test.ts", added: 3, removed: 1 }], basis: "cited", cites: [ok1("diff:src/percent.ts")] },
    { id: "B1-9", turn: 1, type: "image", kind: "illustration", status: "ready", title: "Rounding, sketched", src: "/api/review-room/SC-50/image/B1-9.png", provider: "codex", model: "img-1", basis: "illustration", cites: [] }],
  turns: [
    { n: 1, action: "teach", text: "Teach me this change.", lang: "en", status: "done", provider: "codex", model: "gpt-6", cost: { usd: 0.04 }, answer: "x",
      claims: [{ text: "## How percent works", kind: "heading", basis: null, cites: [] }, cl("An amount in cents goes into `percent` [board:B1-1].", [ok1("board:B1-1")]),
        cl("It is rounded to whole cents [board:B1-2] [diff:src/percent.ts:L2-3].", [ok1("board:B1-2"), ok1("diff:src/percent.ts:L2-3")]),
        cl('It was probably added for invoices <img src=x onerror="window.__pwned=1">.'), cl("On the page the total moves by a cent [board:B1-7].", [ok1("board:B1-7")]), { text: "Want me to go deeper?", kind: "aside", basis: null, cites: [] }] },
    { n: 2, action: "ask", text: "1: 300. 2: not sure.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "y", claims: [cl("Halves round up [source:1].", [ok1("source:1")]), cl("An old commit explains it [commit:deadbeef].", [{ ref: "commit:deadbeef", ok: false }]), cl("Another page says so [source:4].", [ok1("source:4")])] }],
  sources: [{ n: 1, turn: 1, kind: "fetch", url: "https://developer.mozilla.org/x", ok: true, status: 200, at: "t" }, { n: 2, turn: 1, kind: "search", query: "rounding in src/percent.ts", ok: false, refused: "it names a file of this repository", at: "t" },
    { n: 3, turn: 2, kind: "fetch", text: "javascript:alert(document.cookie)", ok: false, refused: "only http and https addresses", at: "t" },
    // defence in depth: even a stored record that claims an ok javascript: address must never become a link
    { n: 4, turn: 2, kind: "fetch", url: "javascript:alert(2)", ok: true, status: 200, at: "t" }],
  oldBoard: { turns: 2, items: 9 },
  diffstat: { files: [{ path: "src/percent.ts", added: 4, removed: 0 }, { path: "test/percent.test.ts", added: 3, removed: 1 }], total: { files: 2, added: 7, removed: 1 }, from: "git" },
  check: { questions: [{ n: 1, q: "What does percent(1999, 15) return?", turn: 1, at: "t", result: { correct: true, note: "300", turn: 2 } }, { n: 2, q: "Where could rounding go wrong?", turn: 1, at: "t", result: { correct: false, note: "halves", turn: 2 } }] }, summary };

// speech, stubbed: a browser with voices and an audio player that record any use (the room must use neither); on-device recognition
const stubs = ([mic]) => {
  window.__spoken = []; const mac = (name, uri, lang = "en-US") => ({ name, lang, localService: true, voiceURI: uri });
  // this Mac's voices as Chrome and Safari list them: novelty and legacy (MacinTalk, Eloquence) voices among the good ones
  const voices = [mac("Samantha", "com.apple.voice.compact.en-US.Samantha"), mac("Fred", "fred"), mac("Ava (Premium)", "ava"), { name: "Google US English", lang: "en-US", localService: false, voiceURI: "google" }, mac("Mei-Jia (Premium)", "mj", "zh-TW"),
    mac("Zarvox", "com.apple.speech.synthesis.voice.Zarvox"), mac("Bad News", "com.apple.speech.synthesis.voice.BadNews"), mac("Good News", "good-news"), mac("Bubbles", "bubbles"), mac("Whisper", "com.apple.speech.synthesis.voice.Whisper"),
    mac("Eddy (English (US))", "com.apple.eloquence.en-US.Eddy"), mac("Grandma (English (UK))", "com.apple.eloquence.en-GB.Grandma", "en-GB"), mac("Kathy", "kathy"), mac("Zoe", "com.apple.voice.enhanced.en-US.Zoe"),
    mac("Eddy (Chinese (Taiwan))", "com.apple.eloquence.zh-TW.Eddy", "zh-TW"), mac("Flo (Chinese (Taiwan))", "com.apple.eloquence.zh-TW.Flo", "zh-TW")];
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => window.__voices || voices, speak: (u) => { window.__spoken.push([u.text, u.voice?.voiceURI]); setTimeout(() => window.__speakFails ? u.onerror && u.onerror({ error: "not-allowed" }) : u.onend && u.onend(), 5); }, cancel: () => { window.__cancels = (window.__cancels || 0) + 1; } } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  class Rec { static async available(o) { window.__micAsked = o; return mic; } start() { window.__rec = this; window.__recStarted = { lang: this.lang, local: this.processLocally }; setTimeout(() => this.onresult && this.onresult({ results: [[{ transcript: "why do halves round up" }]] }), 10); } stop() { window.__recStopped = true; this.onend && this.onend(); } }
  window.SpeechRecognition = Rec;
  // the reading-pace timers (2.6 s or more): which were set and which cleared, so a test can tell playback stopped
  window.__paceSet = []; window.__paceCleared = []; const st = window.setTimeout, ct = window.clearTimeout;
  window.setTimeout = function (fn, ms, ...a) { const id = st.call(window, fn, ms, ...a); if (ms >= 2600) window.__paceSet.push(id); return id; };
  window.clearTimeout = function (id) { if (window.__paceSet.includes(id)) window.__paceCleared.push(id); return ct.call(window, id); };
  window.__audios = []; window.Audio = function (src) { const a = { src, currentTime: 0, duration: 10, ontimeupdate: null, onended: null, play: async () => { window.__audio = a; }, pause() {} }; window.__audios.push(src); return a; };
};
async function open(width, lang, mic = "available") {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 } });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [lang]);
  await ctx.addInitScript(stubs, [mic]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const posts = [], cites = [], speech = []; let hold = null, roomNow = ROOM;
  await ctx.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: roomNow }));
  await ctx.route(/\/api\/review-room\/SC-50\/image\/B1-9\.png$/, (r) => r.fulfill({ body: PNG, contentType: "image/png" }));
  await ctx.route(/\/api\/wruns\/R-050\/captures\//, (r) => r.fulfill({ body: PNG, contentType: "image/png" }));
  await ctx.route(/\/api\/review-room\/SC-50\/cite\?/, (r) => { const ref = new URL(r.request().url()).searchParams.get("ref"); cites.push(ref); if (ref === "source:4") return r.fulfill({ json: { kind: "source", n: 4, ok: true, url: "javascript:alert(2)" } }); r.fulfill({ json: { kind: "diff", path: "src/percent.ts", from: 2, to: 3, head: H, text: "@@ -0,0 +1,4 @@\n+  return Math.round((amount * pct) / 100);" } }); });
  await ctx.route(/\/api\/review-room\/SC-50\/turn$/, async (r) => { posts.push(JSON.parse(r.request().postData() || "{}")); await new Promise((res) => (hold = res));
    roomNow = { ...ROOM, running: 3, turns: [...ROOM.turns, { n: 3, action: "ask", text: "why do halves round up", lang, status: "running", provider: "codex", model: "gpt-6", answer: "" }] }; r.fulfill({ json: roomNow }); });
  // the room's explainer: baton, nothing made yet, Studio's start for this head already tried (the page does not start it again)
  await ctx.route(/\/api\/review-room\/SC-50\/explain$/, (r) => r.fulfill({ json: XEMPTY }));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  // any request for a voice (Studio's old voice routes, a room's speech, clip or audio): the room must make none
  p.on("request", (q) => { if (/\/api\/voice\/|\/api\/review-room\/[^/?]+\/(speech|voice|audio)\b/.test(q.url())) speech.push(q.url()); });
  return { ctx, p, posts, cites, speech, release: () => hold?.() };
}
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const XEMPTY = { selected: { id: "studio-baton", v: 1 }, tutor: false, skills: [{ id: "studio-baton", name: "baton (built in)", description: "", v: 1, source: "builtin", own: false }], versions: [], runs: [], running: null, consent: null, log: [], settings: { limitMin: 120, defaultSkill: "studio-baton", autoRun: true }, busy: false,
  auto: { on: true, skill: "studio-baton", head: "a".repeat(40), due: false, why: "done", tried: { head: "a".repeat(40), skill: "studio-baton", at: "t", run: 1 } } };
try {

  // ---------- the merge card's entry ----------
  { const { ctx, p } = await open(1440, "en");
    await p.goto(`${base}/#/board`); await p.waitForFunction(() => window.crewCard?.mountCard);
    const r = await p.evaluate(([m, d]) => { const a = document.createElement("div"), b = document.createElement("div"); document.body.append(a, b); window.crewCard.mountCard(a, m); window.crewCard.mountCard(b, d);
      return { link: a.querySelector("[data-review-room-open]")?.getAttribute("href"), text: a.querySelector("[data-review-room-open]")?.textContent, summary: a.querySelector("[data-review-room-summary]")?.textContent, merge: !!a.querySelector('[data-option="merge"]'), other: !!b.querySelector("[data-review-room]") }; },
      [card("merge", { reviewRoom: summary }), card("dispatch")]);
    ok(r.link === "#/room/SC-50" && r.text === "Open review room" && r.merge, "a merge card shows Open review room beside its own options", JSON.stringify(r));
    ok(/^3 versions of the page · US\$1\.23\. /.test(r.summary) && /never answers this card or changes whether it can merge/.test(r.summary) && !/question|check|source/.test(r.summary), "the card shows the room's summary: baton's versions and what they cost; display only", r.summary);
    ok(!r.other, "a card that is not a merge card has no review room");
    // each state reads as one sentence: no page yet (being made or not), pages (with one more being made or not)
    const says = await p.evaluate((list) => list.map((rr) => { const a = document.createElement("div"); document.body.append(a); window.crewCard.mountCard(a, rr); return a.querySelector("[data-review-room-summary]")?.textContent.split(" (")[0]; }),
      [{ versions: 0, usd: 0, running: false }, { versions: 0, usd: 0, running: true, generating: true }, { versions: 1, usd: 1.6, running: true, generating: true }, { versions: 1, usd: 1.6, running: false },
        { versions: 1, usd: 1.6, running: true, generating: false }, { versions: 0, usd: 0.42, running: false }, { versions: 0, usd: 0.42, running: true, generating: false }].map((o) => card("merge", { reviewRoom: { ...summary, ...o } })));
    ok(JSON.stringify(says) === JSON.stringify(["Read a page on how and why this change works before you merge.", "A page on how and why this change works is being made.", "1 version of the page · US$1.60 · a new one is being made.", "1 version of the page · US$1.60.",
      "1 version of the page · US$1.60.", "No page yet · US$0.42 spent.", "No page yet · US$0.42 spent."]),
      "the merge card's line reads naturally in each state: nothing yet, the first page being made, a new version being made, pages made; the tutor answering a question changes nothing; money spent with no page says so", JSON.stringify(says));
    // and in 繁體中文: money spent with no page reads as one sentence, the amount after 已花費
    { const z = await open(1440, "zh-TW"); await z.p.goto(`${base}/#/board`); await z.p.waitForFunction(() => window.crewCard?.mountCard);
      const zh = await z.p.evaluate((rr) => { const a = document.createElement("div"); document.body.append(a); window.crewCard.mountCard(a, rr); return a.querySelector("[data-review-room-summary]")?.textContent.split("（")[0].trim(); },
        card("merge", { reviewRoom: { ...summary, versions: 0, usd: 0.42, running: false } }));
      ok(zh === "還沒有頁面 · 已花費 US$0.42。", "in 繁體中文, money spent with no page: 還沒有頁面 · 已花費 US$0.42。", JSON.stringify(zh)); await z.ctx.close(); }
    await ctx.close(); }

  // ---------- two routes, two pages: #/review is the Library's artifact review, #/room the review room ----------
  { const { ctx, p } = await open(1440, "en");
    await p.goto(`${base}/#/review/ART-404/1`); await p.waitForFunction(() => S.route?.name === "review", null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(800);
    const lib = await p.evaluate(() => ({ route: S.route?.name, room: !!document.querySelector(".rr-page"), err: document.querySelector("[data-room-error]")?.textContent ?? null }));
    ok(lib.route === "review" && !lib.room && lib.err === null, "#/review/<artifact>/<n> stays the Library's review page, never the review room", JSON.stringify(lib));
    await p.goto(`${base}/#/room`); await p.waitForSelector(".rr-page", { timeout: 15000 }).catch(() => {});
    const home = await p.evaluate(() => ({ route: S.route?.name, h1: document.querySelector(".rr-page h1")?.textContent ?? null }));
    ok(home.route === "room" && home.h1 === "Review room", "#/room is the review room's home", JSON.stringify(home));
    await ctx.close(); }


  // ---------- a room from before: the board is gone from the page; the room says so in one line and offers its record ----------
  { const { ctx, p } = await open(1440, "en"); const asked = [];
    await p.route(/\/api\/review-room\/SC-50\/arrive$/, (r) => { asked.push("arrive"); r.fulfill({ json: {} }); });
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-old-board]", { timeout: 15000 });
    const o = await p.evaluate(() => ({ n: document.querySelector("[data-old-board]").dataset.oldBoard, text: document.querySelector("[data-old-board]").textContent, href: document.querySelector("[data-old-board-download]").getAttribute("href"),
      board: !!document.querySelector("[data-board], [data-playbar], .rb-view, [data-prompt-bar], [data-transcript]"), tools: [...document.querySelectorAll(".rr-head button, .rr-head a")].map((e) => e.textContent.trim()).filter(Boolean),
      fonts: [...document.styleSheets].some((s) => /hand\.css|review-board\.css/.test(s.href || "")), scripts: [...document.scripts].some((s) => /review-board\.js/.test(s.src)), html: document.body.innerHTML.includes("onerror") }));
    ok(o.n === "2" && /2 whiteboard turns from before/.test(o.text) && o.href === "/api/review-room/SC-50/export" && !o.board, "the merge card's room with an old lesson: one line, its record as a file, no board, no play bar, no prompt bar, no transcript", JSON.stringify(o));
    ok(!o.fonts && !o.scripts && !o.tools.some((t) => /Save to Library|Teach me|Check me|EN繁简/.test(t)), "the board's code, styles and handwriting fonts are not loaded; no Save to Library, Teach me or language switch in the header", JSON.stringify(o.tools));
    ok(!asked.length && !(await p.evaluate(() => window.__pwned)) && !o.html, "nothing is asked of the old lesson on arrival; its text is never put on the page", JSON.stringify(asked));
    await ctx.close(); }

  // ---------- the pull request box: opening the room starts baton; nothing else is sent ----------
  { const { ctx, p } = await open(1440, "en"); const opened = [];
    await p.route(/\/api\/review-room$/, (r) => r.fulfill({ json: { rooms: [], settings: { tutor: null }, tutors: [], providers: [] } }));
    await p.route(/\/api\/review-room\/paste-offer/, (r) => { opened.push("offer"); r.fulfill({ json: {} }); });
    await p.route(/\/api\/review-room\/open-pr$/, (r) => { opened.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ json: { id: "SC-50", href: "#/room/SC-50", room: ROOM } }); });
    await p.goto(`${base}/#/room`); await p.waitForSelector('[data-pr-box="home"]', { timeout: 15000 });
    const line = await p.$eval('[data-pr-box="home"] [data-paste-offer]', (e) => e.textContent);
    ok(/Opening the room starts baton by itself: one paid run on the room's tutor model, once per head/.test(line) && !(await p.$("[data-auto-global]")), "the paste box says what opening the room starts (baton, once per head); no auto-teach switch", line);
    await p.fill('[data-pr-url="home"]', "https://github.com/fixture/project/pull/7"); await p.click('[data-pr-open="home"]'); await p.waitForFunction(() => location.hash === "#/room/SC-50", null, { timeout: 5000 });
    ok(opened.length === 1 && opened[0].url === "https://github.com/fixture/project/pull/7" && !("auto" in opened[0]) && !("plan" in opened[0]), "Open sends the address only (no lesson plan, no paste offer asked); the room opens", JSON.stringify(opened));
    await ctx.close(); }


  // ---------- getting back: the sidebar's Review room, its list of rooms, the room's crumb, external links in a new window ----------
  { const { ctx, p } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 });
    await p.addInitScript(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push([u, t, f]); return null; }; });
    let sc50Versions = 2;
    await p.route(/\/api\/review-room$/, (r) => r.fulfill({ json: { rooms: [{ id: "SC-50", kind: "merge", title: "Merge: Add percent", titleZh: "合併：新增 percent", open: true, running: false, versions: sc50Versions, questions: 1, usd: 0.5, oldBoard: null, repository: null, zone: "waiting", updatedAt: "2026-10-28T10:00:00Z" }, { id: "PR-0123456789ab-7", kind: "pr", title: "Pull request #7: Shout", open: false, running: false, versions: 0, questions: 0, usd: 0, oldBoard: { turns: 2, items: 3 }, repository: "fixture/project", zone: "concluded", updatedAt: "2026-10-28T12:00:00Z" }] } }));
    await p.goto(`${base}/#/board`); await p.waitForFunction(() => S.route?.name === "board");
    const navItem = await p.evaluate(() => { const b = document.querySelector('.nav-item[data-view="room"]'); return b && { inLabs: !!b.closest(".nav-labs"), hidden: b.hidden, text: b.textContent }; });
    ok(navItem && !navItem.inLabs && !navItem.hidden && /Review room/.test(navItem.text), "the sidebar has a Review room item of its own (on the rail too when it is folded)", JSON.stringify(navItem));
    await p.click('.nav-item[data-view="room"]'); await p.waitForSelector("[data-room-link]", { timeout: 15000 });
    const list = await p.$$eval("[data-room-link]", (els) => els.map((e) => [e.dataset.roomLink, e.getAttribute("href")]));
    ok(JSON.stringify(list) === JSON.stringify([["SC-50", "#/room/SC-50"], ["PR-0123456789ab-7", "#/room/PR-0123456789ab-7"]]) && /open/.test(await p.textContent('[data-room-list]')), "the Review room's home lists the rooms on this machine, open ones first, each a link back into it", JSON.stringify(list));
    await p.click('[data-room-link="SC-50"]'); await p.waitForSelector("[data-explain-room]", { timeout: 15000 });
    ok(await p.$eval("[data-room-home]", (e) => e.getAttribute("href")).catch(() => null) === "#/room" && /Review room/.test(await p.$eval(".rr-crumb", (e) => e.textContent).catch(() => "")), "the room's header says where you are: Review room › the room, the first a link to the list");
    const inRoom = await p.evaluate(() => ({ focus: document.body.dataset.focus ?? null, crumb: !!document.querySelector("[data-room-home]")?.getClientRects().length }));
    ok(inRoom.focus === "room" && inRoom.crumb, "a loaded room is a focus page (body[data-focus=room]) and its way back to the list stays in view", JSON.stringify(inRoom));
    // restoring is not arriving: the view it returns would start an analysis the captain was never shown; nothing starts by itself
    { const arrives = []; let next = { archived: true, zone: "archived", view: { ...ROOM, archived: true, arrive: null } }; await p.route(/\/api\/review-room\/SC-50\/arrive$/, (r) => { arrives.push(1); r.fulfill({ json: {} }); }); await p.route(/\/api\/review-room\/SC-50\/archive$/, (r) => r.fulfill({ json: next }));
      await p.click('[data-room-archive="SC-50"]'); await p.waitForSelector("[data-room-archived]"); next = { archived: false, zone: "waiting", view: { ...ROOM, archived: false, arrive: { plan: "plan-1", auto: true, provider: "codex", model: "gpt-6", paid: true } } };
      // the room's own live read lands before the answer to the restore: that view's plan starts nothing either
      let release = () => {}; const held = new Promise((r) => { release = r; }), planned = /\/api\/review-room\/SC-50(\?open=1)?$/; await p.unroute(/\/api\/review-room\/SC-50\/archive$/);
      await p.route(/\/api\/review-room\/SC-50\/archive$/, async (r) => { await held; await r.fulfill({ json: next }); }); await p.route(planned, (r) => r.fulfill({ json: next.view }));
      await p.click('[data-room-restore="SC-50"]'); await p.waitForTimeout(100); await p.evaluate(() => dispatchEvent(new Event("hashchange"))); await p.waitForTimeout(300); release(); await p.waitForSelector('[data-room-archive="SC-50"]'); await p.waitForTimeout(400);
      ok(!arrives.length, "restoring in a room's header starts no paid analysis", JSON.stringify(arrives)); await p.unroute(planned); await p.unroute(/\/api\/review-room\/SC-50\/arrive$/); await p.unroute(/\/api\/review-room\/SC-50\/archive$/); }
    sc50Versions = 3; await p.goBack(); await p.waitForFunction(() => S.route?.name === "room" && !S.route.arg); const onList = await p.evaluate(() => document.body.dataset.focus ?? null);
    const fresh = await p.waitForFunction(() => /3 versions · 1 question/.test(document.querySelector("[data-room-list]")?.textContent || ""), null, { timeout: 5000 }).then(() => true, () => false);
    ok(fresh, "coming back to the room list reads it again: a room's new page versions show", await p.$eval("[data-room-list]", (e) => e.textContent).catch(() => ""));
    const rows = await p.$$eval("[data-room-counts]", (els) => els.map((e) => e.textContent));
    ok(rows.length === 2 && /0 versions · old whiteboard \(2 turns\)/.test(rows[1]) && !rows.some((t) => /undefined|NaN/.test(t)), "each row reads the list's own fields (versions, questions, an old whiteboard): never undefined", JSON.stringify(rows));
    await p.goBack(); await p.waitForFunction(() => S.route?.name === "board"); const onBoard = await p.evaluate(() => document.body.dataset.focus ?? null);
    ok(onList === null && onBoard === null, "the browser's back walks Studio's own pages: room → the room list → the board, and focus ends with the room", JSON.stringify({ onList, onBoard }));
    await p.evaluate(() => { location.hash = "#/room/SC-50"; }); await p.waitForSelector("[data-explain-room]");
    const ext = await p.evaluate(() => { const a = document.createElement("a"); a.href = "https://example.org/docs"; a.textContent = "x"; document.querySelector("#view").append(a); const before = location.href; a.click(); return { opened: window.__opened, same: location.href === before }; });
    ok(ext.same && ext.opened.length === 1 && ext.opened[0][0] === "https://example.org/docs" && ext.opened[0][1] === "_blank" && /noopener/.test(ext.opened[0][2]), "a link that leaves Studio opens in a new window, never in Studio's own (an app window has no back button)", JSON.stringify(ext));
    const inApp = await p.evaluate(() => { window.__opened = []; const a = document.createElement("a"); a.href = "#/board"; document.querySelector("#view").append(a); a.click(); return window.__opened.length; });
    await p.waitForFunction(() => S.route?.name === "board");
    ok(inApp === 0, "Studio's own pages still open in place");
    const own = await p.evaluate(() => { window.__opened = []; const mk = (href, take) => { const a = document.createElement("a"); a.href = href; if (take) a.addEventListener("click", (e) => e.preventDefault()); document.querySelector("#view").append(a); a.click(); };
      mk("https://example.org/handled", true); mk("mailto:someone@example.org", true); return window.__opened.length; });
    ok(own === 0, "a link whose own handler takes the click, or that is not http(s), is left to that handler: Studio opens no window for it");
    await ctx.close(); }


  // ---------- focus mode: the room takes the screen and gives it back as it was ----------
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); localStorage.setItem("crew.side", "open"); localStorage.setItem("crew.chatOpen", "1"); } } catch {} });
    await ctx.addInitScript(stubs, ["unavailable"]); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: ROOM })); await ctx.route(/\/api\/review-room\/SC-50\/explain$/, (r) => r.fulfill({ json: XEMPTY }));
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    const shell = () => p.evaluate(() => ({ focus: document.body.dataset.focus === "room", side: document.body.classList.contains("side-collapsed"), chat: !document.body.classList.contains("chat-closed"), sideW: Math.round(document.querySelector(".side").getBoundingClientRect().width), store: [localStorage.getItem("crew.side"), localStorage.getItem("crew.chatOpen")] }));
    await p.goto(`${base}/#/board`); await p.waitForFunction(() => S.route?.name === "board"); await p.waitForTimeout(300);
    const before = await shell();
    await p.evaluate(() => { location.hash = "#/room/SC-50"; }); await p.waitForSelector("[data-explain-room]", { timeout: 15000 }); await p.waitForTimeout(300);
    const inRoom = await shell();
    ok(before.side === false && before.chat === true && inRoom.focus && inRoom.side && !inRoom.chat && inRoom.sideW <= 64 && JSON.stringify(inRoom.store) === JSON.stringify(["open", "1"]), "in a room the sidebar folds to its 64px rail and Firstmate closes, without changing the saved preferences", JSON.stringify({ before, inRoom }));
    await p.click("[data-room-firstmate]"); const sheet = await p.evaluate(() => { const c = document.querySelector("#chat").getBoundingClientRect(), st = document.querySelector(".rx-body").getBoundingClientRect(); return { open: !document.body.classList.contains("chat-closed"), fixed: getComputedStyle(document.querySelector("#chat")).position, stageW: Math.round(st.width) }; });
    await p.click("#chatClose"); const after = await shell();
    ok(sheet.open && sheet.fixed === "fixed" && sheet.stageW > 1100 && !after.chat && JSON.stringify(after.store) === JSON.stringify(["open", "1"]), "the header's Firstmate opens it as a sheet over the room (the room keeps its width); closing it saves nothing", JSON.stringify({ sheet, after }));
    await p.evaluate(() => { location.hash = "#/board"; }); await p.waitForFunction(() => S.route?.name === "board"); await p.waitForTimeout(200);
    const left = await shell();
    ok(!left.focus && left.side === false && left.chat === true && JSON.stringify(left.store) === JSON.stringify(["open", "1"]), "leaving the room gives the sidebar and Firstmate back as they were", JSON.stringify(left));
    await ctx.close(); }


  // ---------- a document: the home takes a file or pasted text; the real route keeps it and opens its room ----------
  { const { ctx, p } = await open(1440, "en"); const sent = [];
    await p.route(/\/api\/review-room$/, (r) => r.fulfill({ json: { rooms: [], settings: { tutor: null }, tutors: [], providers: [] } }));
    await p.route(/\/api\/review-room\/open-doc$/, (r) => { sent.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 400, json: { error: "Only a document opens a room: .md, .markdown, .txt, .text, .html, .htm, .pdf", code: "bad_type" } }); });
    await p.goto(`${base}/#/room`); await p.waitForSelector("[data-doc-box]", { timeout: 15000 });
    const home = await p.evaluate(() => ({ line: document.querySelector('[data-paste-offer="doc"]')?.textContent || "", h: document.querySelector("[data-doc-box] h2")?.textContent, open: document.querySelector("[data-doc-open]")?.textContent, accept: document.querySelector("[data-doc-file]")?.getAttribute("accept"), seg: !!document.querySelector("[data-doc-box] .seg [data-doc-mode=file][aria-pressed=true]"), own: !document.querySelector("[data-doc-section] [data-pr-box]") }));
    await p.click("[data-doc-open]"); const none = await p.textContent("[data-doc-error]").catch(() => "");
    ok(/one paid run on the room's tutor model\. A new version runs it again/.test(home.line) && home.h === "Learn a proposal document" && home.open === "Open the document's room" && home.own && home.accept === ".md,.markdown,.txt,.text,.html,.htm,.pdf" && home.seg && /Choose a file first/.test(none) && !sent.length,
      "the Review room's home takes a document in a card of its own: a file of a document's type (or pasted text), saying what opening its room and a new version start; Open with nothing chosen says why and sends nothing", JSON.stringify({ home, none }));
    const bytes = Buffer.from("# A proposal\n\nBuild a reading list.\n");
    await p.setInputFiles("[data-doc-file]", { name: "proposal.md", mimeType: "text/markdown", buffer: bytes }); await p.waitForSelector("[data-doc-chosen]");
    ok(/^proposal\.md · 1 KB$/.test(await p.textContent("[data-doc-chosen]")), "the chosen file is named beside Studio's own Choose button");
    await p.click("[data-doc-open]"); await p.waitForSelector("[data-doc-error]", { timeout: 5000 });
    ok(sent.length === 1 && sent[0].name === "proposal.md" && Buffer.from(sent[0].base64, "base64").equals(bytes) && Object.keys(sent[0]).sort().join() === "base64,name" && /Only a document opens a room/.test(await p.textContent("[data-doc-error]")),
      "a file goes as its name and its bytes, nothing else; a refusal stays on the form with why", JSON.stringify(sent.map((x) => x.name)));
    await p.click("[data-doc-mode=paste]"); await p.fill("[data-doc-title]", "Reading list"); await p.fill("[data-doc-text]", "# Reading list\n\nA plan."); await p.click("[data-doc-open]");
    await p.waitForFunction(() => document.querySelector("[data-doc-error]"), null, { timeout: 5000 });
    ok(sent.length === 2 && sent[1].title === "Reading list" && sent[1].text === "# Reading list\n\nA plan." && !("base64" in sent[1]), "pasted text goes as its title and its text", JSON.stringify(sent[1]));
    await p.unroute(/\/api\/review-room\/open-doc$/); await p.unroute(/\/api\/review-room$/);
    // the real route: kept, its room opened; refused types and an oversize body said so
    const real = await p.evaluate(async () => { const post = async (b) => { const r = await fetch("/api/review-room/open-doc", { method: "POST", headers: { "content-type": "application/json" }, body: typeof b === "string" ? b : JSON.stringify(b) }); let j = {}; try { j = await r.json(); } catch {} return [r.status, j.code ?? null, j.id ?? null]; };
      return [await post({ name: "Reading list.md", base64: btoa("# Reading list\n\nA small service for a team's reading list.\n") }), await post({ name: "tool.exe", base64: btoa("MZ") }), await post("x".repeat(6 * 1024 * 1024 + 300000))]; });
    ok(real[0][0] === 200 && /^DOC-[0-9a-f]{12}$/.test(real[0][2]) && real[1][0] === 400 && real[1][1] === "bad_type" && real[2][0] === 413 && real[2][1] === "too_large", "the real route keeps a document and opens its room; another type is refused; a body past the size limit is not read", JSON.stringify(real));
    const dl = await p.evaluate(async (id) => { const r = await fetch(`/api/review-room/${id}/page/1/download`); let j = {}; try { j = await r.json(); } catch {} return [r.status, j.code ?? null]; }, real[0][2]);
    ok(dl[0] === 404 && dl[1] === "not_found", "a document room's page download route is a real route (no page yet: not found, said by the room, not an unknown route)", JSON.stringify(dl));
    await p.goto(`${base}/#/room/${real[0][2]}`); await p.waitForSelector("[data-doc-version]", { timeout: 15000 });
    const head = await p.evaluate(() => ({ kind: document.querySelector("[data-room-subject]")?.getAttribute("data-room-subject"), pill: document.querySelector("[data-doc-version]")?.textContent || "", title: document.querySelector(".rr-htitle b")?.textContent || "", gh: !!document.querySelector("[data-room-github]"), check: !!document.querySelector("[data-room-check]") }));
    ok(head.kind === "doc" && /^Version 1 of 1 · Markdown · 1 KB/.test(head.pill) && head.title === "Document Reading list" && !head.gh && !head.check, "a document's room: its header names the document and its version, with no GitHub link and no Check for new commits", JSON.stringify(head));
    for (const scheme of ["light", "dark"]) { await p.emulateMedia({ colorScheme: scheme }); await p.screenshot({ path: join(shots, `doc-room-1440-${scheme}.png`) }); }
    await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${base}/#/room`); await p.waitForSelector("[data-doc-box]");
    ok(await noScroll(p), "390 px: the home's document box never scrolls sideways"); await p.screenshot({ path: join(shots, "doc-home-390.png"), fullPage: true });
    await ctx.close(); }

  // ---------- the real routes: a card that does not exist, a write needs the desktop session ----------
  { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(`${base}/#/board`);
    const r = await p.evaluate(async () => { const a = await fetch("/api/review-room/SC-999"); const b = await fetch("/api/review-room/SC-999/archive", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); return [a.status, b.status, (await b.json()).code]; });
    ok(r[0] === 404 && r[1] === 404 && r[2] === "not_found", "the real routes answer: no room, and no archive, for a card that does not exist", JSON.stringify(r));
    // Studio has no voice route any more: the voice status, Doctor's test phrase, a room's speech, clip or audio
    const gone = await p.evaluate(async () => { const at = async (u, post) => { const x = await fetch(u, post ? { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } : {}); let j = null; try { j = await x.json(); } catch {} return [u, x.status, j?.code ?? null]; };
      return [await at("/api/voice/status"), await at("/api/voice/test", true), await at("/api/review-room/SC-999/speech", true), await at("/api/review-room/SC-999/voice", true), await at("/api/review-room/SC-999/audio/voice-t1-0123456789ab.mp3"), await at("/api/review-room/SC-999/voice/kvoice-0123456789abcdef.wav")]; });
    ok(gone.every(([, st, code]) => st === 404 && code !== "not_found"), "no voice route is left: the voice status, the test phrase and a room's speech, clip and audio routes are unknown to Studio", JSON.stringify(gone));
    // nor any whiteboard route: a turn, the check, a translation, pictures, the lesson tools, starting over, auto-teach, arrival
    const board = await p.evaluate(async () => { const at = async (u, post) => { const x = await fetch(u, post ? { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } : {}); let j = null; try { j = await x.json(); } catch {} return [u, x.status, j?.code ?? null]; };
      const w = ["turn", "check-answer", "translate", "images", "lesson", "reset", "auto", "arrive"].map((x) => at(`/api/review-room/SC-999/${x}`, true));
      const r0 = ["cite?ref=diff:x", "findings", "image/B1-1.png"].map((x) => at(`/api/review-room/SC-999/${x}`));
      return [...await Promise.all(w), ...await Promise.all(r0), await at("/api/review-room/paste-offer?url=https://github.com/a/b/pull/1")]; });
    ok(board.every(([, st, code]) => (st === 404 || st === 405) && code !== "not_found"), "no whiteboard route is left: turn, check, translate, pictures, lesson, start over, auto-teach, arrival, citations, findings and the paste offer are unknown to Studio", JSON.stringify(board));
    const raw = await fetch(`${base}/api/review-room/SC-999/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    ok(raw.status === 401 || raw.status === 403, "a write without Studio's session is refused", String(raw.status));
    const lb = await p.evaluate(async () => { const a = await fetch("/api/review-room/library/room-sc-999"), b = await fetch("/api/review-room/library/room-sc-999", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), c = await fetch("/api/artifacts/room-sc-999/v/1/approve", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), d = await fetch("/api/review-room/SC-999/save", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const e = await fetch("/api/artifacts/room-sc-999", { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" });
      return [a.status, b.status, c.status, (await c.json()).code, d.status, e.status, (await e.json()).error]; });
    ok(lb[0] === 404 && lb[1] === 405 && lb[2] === 403 && lb[3] === "room-snapshot-read-only" && lb[4] === 404 && lb[5] === 404 && /no such saved room/.test(lb[6] ?? ""), "a saved room's route reads only; the Library refuses any write to a saved room but its deletion; Save to Library is a real route", JSON.stringify(lb));
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\nreview-room-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);