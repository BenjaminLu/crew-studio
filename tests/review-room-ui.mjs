import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room on the page (public/review-room.js, public/scard.js; docs/units/review-room.md): the merge card's
// "Open review room" entry and summary (a merge card only, the same on every merge card); the room's board (a flowchart
// built up step by step, code at the head, the diff, before / after), the chat with each claim's basis (a citation opens
// what it rests on; an uncited claim reads Inference), sources and the understanding check; a turn asks for the paid
// round's confirmation and the controls wait while it runs. Model text stays text. At 1440 (en) and 390 (zh-TW).
// The room's routes are answered by the test: nothing paid runs.        node tests/review-room-ui.mjs
import { spawn } from "node:child_process";
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
const summary = { href: "#/room/SC-50", opened: true, turns: 2, questions: 2, running: false, check: { asked: 2, graded: 2, correct: 1 }, sources: { consulted: 1, refused: 1 } };
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
  diffstat: { files: [{ path: "src/percent.ts", added: 4, removed: 0 }, { path: "test/percent.test.ts", added: 3, removed: 1 }], total: { files: 2, added: 7, removed: 1 }, from: "git" },
  check: { questions: [{ n: 1, q: "What does percent(1999, 15) return?", turn: 1, at: "t", result: { correct: true, note: "300", turn: 2 } }, { n: 2, q: "Where could rounding go wrong?", turn: 1, at: "t", result: { correct: false, note: "halves", turn: 2 } }] }, summary };

// speech, stubbed: two on-device voices and one the browser would send to a server; on-device recognition; an audio player
const stubs = ([mic]) => {
  window.__spoken = []; const mac = (name, uri, lang = "en-US") => ({ name, lang, localService: true, voiceURI: uri });
  // this Mac's voices as Chrome and Safari list them: novelty and legacy (MacinTalk, Eloquence) voices among the good ones
  const voices = [mac("Samantha", "com.apple.voice.compact.en-US.Samantha"), mac("Fred", "fred"), mac("Ava (Premium)", "ava"), { name: "Google US English", lang: "en-US", localService: false, voiceURI: "google" }, mac("Mei-Jia (Premium)", "mj", "zh-TW"),
    mac("Zarvox", "com.apple.speech.synthesis.voice.Zarvox"), mac("Bad News", "com.apple.speech.synthesis.voice.BadNews"), mac("Good News", "good-news"), mac("Bubbles", "bubbles"), mac("Whisper", "com.apple.speech.synthesis.voice.Whisper"),
    mac("Eddy (English (US))", "com.apple.eloquence.en-US.Eddy"), mac("Grandma (English (UK))", "com.apple.eloquence.en-GB.Grandma", "en-GB"), mac("Kathy", "kathy"), mac("Zoe", "com.apple.voice.enhanced.en-US.Zoe")];
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => window.__voices || voices, speak: (u) => { window.__spoken.push([u.text, u.voice?.voiceURI]); setTimeout(() => u.onend && u.onend(), 5); }, cancel: () => { window.__cancels = (window.__cancels || 0) + 1; } } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  class Rec { static async available(o) { window.__micAsked = o; return mic; } start() { window.__rec = this; window.__recStarted = { lang: this.lang, local: this.processLocally }; setTimeout(() => this.onresult && this.onresult({ results: [[{ transcript: "why do halves round up" }]] }), 10); } stop() { window.__recStopped = true; this.onend && this.onend(); } }
  window.SpeechRecognition = Rec;
  window.Audio = function (src) { const a = { src, currentTime: 0, duration: 10, ontimeupdate: null, onended: null, play: async () => { window.__audio = a; }, pause() {} }; return a; };
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
  await ctx.route(/\/api\/review-room\/SC-50\/speech$/, (r) => { speech.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ json: { src: "/api/review-room/SC-50/audio/voice-t1-0123456789ab.mp3", cached: false, vendor: "openai", model: "gpt-4o-mini-tts" } }); });
  await ctx.route(/\/api\/review-room\/SC-50\/cite\?/, (r) => { const ref = new URL(r.request().url()).searchParams.get("ref"); cites.push(ref); if (ref === "source:4") return r.fulfill({ json: { kind: "source", n: 4, ok: true, url: "javascript:alert(2)" } }); r.fulfill({ json: { kind: "diff", path: "src/percent.ts", from: 2, to: 3, head: H, text: "@@ -0,0 +1,4 @@\n+  return Math.round((amount * pct) / 100);" } }); });
  await ctx.route(/\/api\/review-room\/SC-50\/turn$/, async (r) => { posts.push(JSON.parse(r.request().postData() || "{}")); await new Promise((res) => (hold = res));
    roomNow = { ...ROOM, running: 3, turns: [...ROOM.turns, { n: 3, action: "ask", text: "why do halves round up", lang, status: "running", provider: "codex", model: "gpt-6", answer: "" }] }; r.fulfill({ json: roomNow }); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  return { ctx, p, posts, cites, speech, release: () => hold?.() };
}
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const stage = (p) => p.$eval("[data-stage]", (e) => ({ scene: e.dataset.scene, pos: e.querySelector("[data-scene-pos]")?.dataset.scenePos, title: e.querySelector("[data-scene-title]")?.textContent, points: e.querySelectorAll(".rr-point").length, at: e.querySelector("[data-point-pos]")?.dataset.pointPos,
  visual: e.querySelector("[data-visual]")?.dataset.visual, caption: e.querySelector("[data-caption]")?.textContent, nodes: [...e.querySelectorAll("[data-node]")].map((n) => n.dataset.node + (n.classList.contains("rr-new") ? "*" : "")) }));
try {
  // ---------- the merge card's entry ----------
  { const { ctx, p } = await open(1440, "en");
    await p.goto(`${base}/#/board`); await p.waitForFunction(() => window.crewCard?.mountCard);
    const r = await p.evaluate(([m, d]) => { const a = document.createElement("div"), b = document.createElement("div"); document.body.append(a, b); window.crewCard.mountCard(a, m); window.crewCard.mountCard(b, d);
      return { link: a.querySelector("[data-review-room-open]")?.getAttribute("href"), text: a.querySelector("[data-review-room-open]")?.textContent, summary: a.querySelector("[data-review-room-summary]")?.textContent, merge: !!a.querySelector('[data-option="merge"]'), other: !!b.querySelector("[data-review-room]") }; },
      [card("merge", { reviewRoom: summary }), card("dispatch")]);
    ok(r.link === "#/room/SC-50" && r.text === "Open review room" && r.merge, "a merge card shows Open review room beside its own options", JSON.stringify(r));
    ok(/2 questions asked in the room · check 1\/2 correct · 1 source consulted/.test(r.summary) && /never answers this card or changes whether it can merge/.test(r.summary), "the card shows the room's summary: questions, check score, sources; display only", r.summary);
    ok(!r.other, "a card that is not a merge card has no review room");
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

  // ---------- the room at 1440: the board is the stage ----------
  { const { ctx, p, posts, cites, speech, release } = await open(1440, "en");
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    let s = await stage(p);
    ok(s.scene === "t2" && s.pos === "3/3" && s.points === 3, "the stage opens on the latest scene, whole (scenes already there are not replayed)", JSON.stringify(s));
    ok(!!(await p.$('[data-cite-invalid="commit:deadbeef"]')) && !(await p.$('button[data-cite="commit:deadbeef"]')), "a citation Studio could not verify is plain text: nothing to click");
    await p.click('[data-cite="source:4"]'); await p.waitForSelector('[data-cite-panel="source:4"]');
    ok(!(await p.$('[data-cite-panel] a')) && /javascript:alert\(2\)/.test(await p.textContent('[data-cite-panel] [data-source-text]')), "a source whose address is not http(s) shows as text in the citation panel, never a link");
    await p.click('[data-cite-panel] .btn');
    const layout = await p.evaluate(() => { const st = document.querySelector("[data-stage]").getBoundingClientRect(), bar = document.querySelector("[data-chat]").getBoundingClientRect(), d = document.querySelector("[data-transcript]");
      return { stageH: st.height, barH: bar.height, below: bar.top >= st.bottom - 1, drawerOpen: d.dataset.open === "true" }; });
    ok(layout.stageH > layout.barH * 2 && layout.below && layout.drawerOpen === false, "the board takes most of the screen; a slim prompt bar sits under it; the transcript drawer starts closed", JSON.stringify(layout));
    await p.click("[data-transcript-toggle]"); const jumps = await p.$$eval("[data-jump]", (els) => els.map((e) => [e.dataset.jump, e.textContent]));
    const links = await p.evaluate(() => ({ js: document.querySelectorAll('a[href^="javascript:" i]').length, src: [...document.querySelectorAll("[data-source]")].map((e) => [e.dataset.source, !!e.querySelector("a"), e.querySelector("[data-source-text]")?.textContent ?? null]) }));
    ok(links.js === 0 && JSON.stringify(links.src) === JSON.stringify([["1", true, null], ["2", false, null], ["3", false, "javascript:alert(document.cookie)"], ["4", false, "javascript:alert(2)"]]), "only a fetched http(s) page is a link; a refused or non-http address is plain text, never an anchor", JSON.stringify(links));
    ok(jumps.length === 3 && /This room is only about pull request #7/.test(jumps[0][1]) && /Teach me this change\. → How percent works/.test(jumps[1][1]), "the transcript lists each question and its scene's title", JSON.stringify(jumps));
    await p.click('[data-jump="t1"]'); s = await stage(p);
    ok(s.scene === "t1" && s.pos === "2/3" && s.title === "How percent works" && s.at === "5/5" && s.points === 1 && s.visual === "B1-7" && await p.$eval("[data-transcript]", (e) => e.dataset.open === "false"), "a click in the transcript jumps to its scene and closes the transcript; the visual is the one the last point cites; past four points the next ones are the next page", JSON.stringify(s));
    await p.keyboard.press("ArrowLeft"); s = await stage(p);
    ok(s.at === "4/5" && s.points === 4 && s.visual === "B1-7", "← goes back a point: the first page again, at most four points on it", JSON.stringify(s));
    ok(await p.$eval('[data-claim="inference"]', (e) => /Inference/.test(e.textContent)) && await p.evaluate(() => !window.__pwned && !document.querySelector(".rr-point img")), "an uncited point reads Inference; model text with markup stays text");
    // screenshots: before / after toggle
    ok(await p.$eval("[data-visual] [data-shot-side]", (e) => e.dataset.shotSide) === "after" && /screenshot · base and head/.test(await p.textContent('[data-visual] [data-kind="screenshot"]')), "the screenshot is labelled with its kind and shows the head first");
    await p.click('[data-shot-toggle="before"]');
    ok(await p.$eval("[data-visual] [data-shot-img]", (e) => e.dataset.shotImg + " " + e.getAttribute("src")) === "before /api/wruns/R-050/captures/x/before/index.html.png", "Before shows the base's screenshot");
    // play: points appear one at a time, the visual follows the point, the caption reads it
    await p.click("[data-replay]"); s = await stage(p);
    ok(s.points === 1 && s.visual === "B1-1" && /An amount in cents goes into percent/.test(s.caption) && s.nodes.join() === "A,B", "Play starts the scene again: the first point, its picture (the flow's first step) and its caption", JSON.stringify(s));
    await p.click("[data-play]"); await p.click("[data-point-next]"); s = await stage(p);
    ok(s.points === 2 && s.visual === "B1-2" && s.nodes.join() === "A,B,C*" && /rounded to whole cents/.test(s.caption), "the next point brings the next step of the diagram, the part it adds marked new", JSON.stringify(s));
    await p.click('[data-claim="cited"] [data-cite="diff:src/percent.ts:L2-3"]'); await p.waitForSelector("[data-cite-panel] .rr-diff");
    ok(cites.at(-1) === "diff:src/percent.ts:L2-3" && /Math\.round/.test(await p.textContent("[data-cite-panel]")), "a citation opens the diff hunk it rests on", JSON.stringify(cites));
    // the scene's other pictures: the chart from git numbers and the generated illustration, labelled, enlarged on click
    { const chip = await p.$eval('[data-visual-pick="B1-7"]', (e) => [e.textContent, e.title]);
      ok(/ Checkout, before and…$/.test(chip[0]) && chip[1] === "Checkout, before and after", "a long picture title in the strip is cut at a word, with an ellipsis, and reads whole on hover", JSON.stringify(chip)); }
    await p.click('[data-visual-pick="B1-8"]');
    ok(await p.$eval("[data-visual] [data-chart]", (e) => e.dataset.chart + " " + e.querySelectorAll("rect").length) === "diffstat 4" && /counted by git/.test(await p.textContent("[data-visual] [data-kind]")), "a chart is drawn by Studio from git's numbers, labelled so");
    await p.click('[data-visual-pick="B1-9"]');
    ok(/illustration · generated/.test(await p.textContent('[data-visual] [data-kind="illustration"]')) && /Not evidence/.test(await p.textContent('[data-visual] [data-basis="illustration"]')), "a generated illustration is labelled as one and as not evidence");
    await p.click("[data-visual] [data-illustration]"); await p.waitForSelector("[data-zoom] img");
    ok((await p.getAttribute("[data-zoom] img", "src")) === "/api/review-room/SC-50/image/B1-9.png", "a click enlarges the picture");
    await p.click("[data-zoom] button"); ok(!(await p.$("[data-zoom]")), "and Close puts it back");
    await p.click('[data-jump="t0"]').catch(async () => { await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t0"]'); });
    await p.click('[data-visual-pick="B0-1"]');
    ok(!!(await p.$("[data-visual] [data-illustration-pending]")) && /paid generated image, made once/.test(await p.textContent("[data-visual] [data-paid-image]")), "the opening picture still being drawn shows a placeholder, labelled as a paid generated image made once");
    // voice: off by default; on-device voices only, the best first; the vendor's own voice for the whole scene
    await p.click('[data-jump="t1"]').catch(() => {});
    const voices = await p.$$eval("[data-voice] option", (els) => els.map((e) => e.value));
    ok(JSON.stringify(voices) === JSON.stringify(["off", "vendor", "local:ava", "local:com.apple.voice.enhanced.en-US.Zoe", "local:com.apple.voice.compact.en-US.Samantha"]) && (await p.$eval("[data-voice]", (e) => e.value)) === "off", "voice is off by default; the choices are the tutor vendor's own voice and this Mac's on-device voices, the best first (none a browser would send away, no novelty or robotic legacy voice)", JSON.stringify(voices));
    // a voice picked before it was dropped (a robotic one) is not kept as silence: the best voice there is takes its place
    await p.evaluate(() => localStorage.setItem("crew.room.voice", "local:fred")); await p.click("[data-point-next]").catch(() => {}); await p.click('[data-jump="t1"]').catch(async () => { await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); });
    ok((await p.$eval("[data-voice]", (e) => e.value)) === "local:ava", "a saved voice no longer offered falls back to the best one on this Mac", await p.$eval("[data-voice]", (e) => e.value));
    await p.selectOption("[data-voice]", "off");
    // an older macOS: Safari gives every voice, the good ones too, a com.apple.speech.synthesis.voice. address
    const voicesWith = async (list) => { await p.evaluate((l) => { window.__voices = l; }, list); await p.click("[data-point-next]").catch(() => {}); await p.click('[data-jump="t1"]').catch(async () => { await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); }); return p.$$eval("[data-voice] option", (els) => els.map((e) => e.value)); };
    const old = (n) => ({ name: n, lang: "en-US", localService: true, voiceURI: `com.apple.speech.synthesis.voice.${n.replace(/ /g, "")}` });
    let vs = await voicesWith(["Samantha", "Zarvox", "Alex", "Fred", "Bad News"].map(old));
    ok(JSON.stringify(vs) === JSON.stringify(["off", "vendor", "local:com.apple.speech.synthesis.voice.Samantha", "local:com.apple.speech.synthesis.voice.Alex"]), "on an older macOS the good voices are offered though they share the legacy address; novelty and legacy voices are still left out", JSON.stringify(vs));
    vs = await voicesWith(["Fred", "Zarvox", "Ralph", "Bubbles"].map(old));
    ok(JSON.stringify(vs) === JSON.stringify(["off", "vendor", "local:com.apple.speech.synthesis.voice.Fred", "local:com.apple.speech.synthesis.voice.Ralph"]), "when this Mac has only legacy voices, they are offered rather than none; a novelty voice never is", JSON.stringify(vs));
    await voicesWith(null);
    await p.selectOption("[data-voice]", "local:ava"); await p.click("[data-replay]"); await p.waitForFunction(() => window.__spoken.length >= 2);
    ok(await p.evaluate(() => window.__spoken[0][0] === "An amount in cents goes into percent ." || /^An amount in cents goes into percent/.test(window.__spoken[0][0])) && await p.evaluate(() => window.__spoken[0][1] === "ava"), "with this Mac's voice each point is spoken as it appears", JSON.stringify(await p.evaluate(() => window.__spoken)));
    await p.click("[data-play]").catch(() => {}); await p.evaluate(() => { window.__spoken = []; });
    await p.selectOption("[data-voice]", "vendor"); await p.click("[data-play]"); await p.waitForFunction(() => !!window.__audio);
    ok(speech.length === 1 && speech[0].scene === "t1" && (await p.evaluate(() => window.__audio.src)) === "/api/review-room/SC-50/audio/voice-t1-0123456789ab.mp3", "the vendor's voice is asked for the whole scene once and played", JSON.stringify(speech));
    await p.evaluate(() => { const a = window.__audio; a.currentTime = 6; a.ontimeupdate(); }); s = await stage(p);
    ok(s.points >= 3 && s.points < 5, "the points appear as the narration reaches them", JSON.stringify(s));
    await p.evaluate(() => window.__audio.onended()); s = await stage(p);
    ok(s.at === "5/5" && (await p.evaluate(() => window.__spoken.length)) === 0, "when it ends every point is shown; no browser voice spoke over it", JSON.stringify(s));
    await p.selectOption("[data-voice]", "off");
    // a spoken question: on-device recognition, push to talk, the transcript shown before it is sent
    ok(await p.evaluate(() => JSON.stringify(window.__micAsked)) === JSON.stringify({ langs: ["en"], processLocally: true }), "the mic is offered only after the browser says it recognises speech on this device");
    await p.dispatchEvent("[data-mic]", "pointerdown"); await p.waitForSelector("[data-heard]");
    ok((await p.inputValue("[data-room-text]")) === "why do halves round up" && await p.evaluate(() => window.__recStarted.local === true) && !posts.length, "holding the mic fills the question with what it heard, recognised on this device; nothing is sent yet");
    await p.dispatchEvent("[data-mic]", "pointerup");
    await p.click("[data-room-send]"); await p.waitForSelector('[data-room-confirm="ask"]');
    ok(await p.getAttribute("[data-independence]", "data-independence") === "same" && /Tutor: codex · gpt-6 — Same model as the author: a fresh context, not an independent opinion\. Only one model is usable/.test(await p.textContent("[data-independence]")), "the room labels the tutor and its independence from the author");
    ok(/paid model round on codex · gpt-6 \(high\)/.test(await p.textContent("[data-room-confirm]")) && !/generated pictures, each a paid image job/.test(await p.textContent("[data-room-confirm] p")) && (await p.$eval("[data-images-toggle]", (e) => e.checked)) === false && /nothing is sent to GitHub/.test(await p.textContent("[data-room-confirm]")) && !posts.length, "Ask first asks to confirm the paid round on its provider and model; generated pictures are off unless the captain ticks them here");
    await p.click("[data-room-start]"); await p.waitForFunction(() => document.querySelector('[data-room-action="why"]')?.disabled);
    ok(posts.length === 1 && posts[0].action === "ask" && posts[0].text === "why do halves round up" && posts[0].confirm === "feedc0ffee123456" && posts[0].lang === "en", "Start sends the spoken question with the confirmation and the captain's language", JSON.stringify(posts));
    ok(await p.$eval("[data-room-start]", (e) => e.disabled) && await p.$eval("[data-room-send]", (e) => e.disabled) && await p.$eval("[data-mic]", (e) => e.disabled), "while the turn is being sent every control waits");
    release(); await p.waitForSelector("[data-turn-running]");
    s = await stage(p);
    ok(s.scene === "t3" && /The tutor is working/.test(s.caption) && await p.$eval('[data-room-action="teach"]', (e) => e.disabled), "the new turn opens its scene at once, working; one turn at a time", JSON.stringify(s));
    ok(await noScroll(p), "no sideways scroll at 1440");
    await p.screenshot({ path: join(shots, "room-1440.png") });
    // leaving the room (a turn still running, a scene playing) leaves its page alone: neither the turn's poll nor the
    // playback redraws the page now on screen, so nothing replaces the button the captain is pressing there
    await p.click('[data-jump="t1"]').catch(async () => { await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); });
    await p.click("[data-play]"); await p.evaluate(() => { location.hash = "#/room"; }); await p.waitForSelector('[data-pr-box="home"]'); await p.waitForSelector("[data-room-list]:not([data-room-list-loading])"); await p.waitForTimeout(300);
    await p.evaluate(() => { window.__redraws = 0; new MutationObserver(() => window.__redraws++).observe(document.querySelector("#view"), { childList: true }); document.querySelector('[data-pr-url="home"]').dataset.mark = "1"; });
    await p.waitForTimeout(4000);
    ok(await p.evaluate(() => window.__redraws === 0 && document.querySelector('[data-pr-url="home"]').dataset.mark === "1"), "once the captain leaves a room, its poll and its playback no longer redraw the page on screen", String(await p.evaluate(() => window.__redraws)));
    await ctx.close(); }

  // ---------- one viewport: at 1440×900 the page never scrolls and the picture stays in view at every point ----------
  { const { ctx, p } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t0"]');
    const seen = []; let bad = null;
    for (let i = 0; i < 30; i++) {
      const m = await p.evaluate(() => { const v = document.querySelector("[data-visual]").getBoundingClientRect(), main = document.querySelector("#main"), pts = document.querySelector(".rr-points").getBoundingClientRect(), board = document.querySelector(".rr-board").getBoundingClientRect();
        return { doc: document.documentElement.scrollHeight - innerHeight, main: main.scrollHeight - main.clientHeight, top: Math.round(v.top), bottom: Math.round(v.bottom), left: v.left, right: v.right, w: innerWidth, h: innerHeight, vh: Math.round(v.height), points: document.querySelectorAll("[data-stage] .rr-point").length, ptsIn: pts.bottom <= board.bottom + 1,
          scene: document.querySelector("[data-stage]").dataset.scene, at: document.querySelector("[data-point-pos]")?.dataset.pointPos ?? null, y: scrollY + main.scrollTop }; });
      seen.push(`${m.scene}:${m.at}`);
      if (m.doc > 0 || m.main > 0 || m.top < 0 || m.bottom > m.h || m.left < 0 || m.right > m.w || m.vh < 200 || m.points > 4 || !m.ptsIn || m.y) { bad = m; break; }
      if (await p.$eval("[data-point-next]", (e) => e.disabled)) break;
      await p.keyboard.press("ArrowRight");
    }
    ok(!bad && seen.length >= 8 && seen.at(-1) === "t2:3/3" && seen.includes("t1:5/5"), "at 1440×900 the page never scrolls and the picture stays fully in view at every point of every scene (→ walks them all), at most four points shown", JSON.stringify({ bad, seen }));
    await p.keyboard.press(" "); const playing = await p.$eval("[data-play]", (e) => e.getAttribute("aria-pressed"));
    await p.keyboard.press(" "); const paused = await p.$eval("[data-play]", (e) => e.getAttribute("aria-pressed"));
    ok(playing === "true" && paused === "false", "Space plays and pauses", JSON.stringify([playing, paused]));
    // an answer that drew no picture gets Studio's own, free: a key card of the files it is about, never "no picture"
    let s = await stage(p); const key = await p.evaluate(() => ({ type: document.querySelector("[data-visual] [data-item-type]")?.dataset.itemType, notes: [...document.querySelectorAll("[data-visual] .rr-sticky-name")].map((e) => e.textContent), none: /no picture/i.test(document.querySelector("[data-stage]").textContent) }));
    ok(s.scene === "t2" && s.visual === "t2-key" && key.type === "keycard" && key.notes.includes("percent.ts") && !key.none && !(await p.$(".rr-novisual")), "an answer with no picture shows Studio's key card (its title, the change's files as notes), never “No picture”", JSON.stringify({ s, key }));
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: { ...ROOM, turns: ROOM.turns.map((t) => t.n === 2 ? { ...t, claims: [...t.claims, cl("The test pins it [diff:test/percent.test.ts].", [ok1("diff:test/percent.test.ts")])] } : t) } }));
    await p.reload(); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    s = await stage(p); const chart = await p.evaluate(() => ({ chart: document.querySelector("[data-visual] [data-chart]")?.dataset.chart, rows: [...document.querySelectorAll("[data-visual] .rr-chart-l")].map((e) => e.textContent), kind: document.querySelector("[data-visual] [data-kind]")?.textContent }));
    ok(s.visual === "t2-files" && chart.chart === "diffstat" && JSON.stringify(chart.rows) === JSON.stringify(["test/percent.test.ts"]) && /counted by git/.test(chart.kind), "an answer that cites files but drew nothing gets those files' line counts, counted by git", JSON.stringify({ s, chart }));
    await ctx.close(); }

  // ---------- short on the board: the tutor's scenes, an older long answer split, labels in the captain's language ----------
  { const LONG = "第一句說明 percent 怎麼算 [diff:src/percent.ts:L2-3]。第二句講四捨五入的規則，負數也一樣處理。第三句提醒呼叫端都要傳入以分為單位的整數。第四句說測試涵蓋了邊界情況 [diff:test/percent.test.ts]。第五句是一個比較長的補充說明，描述這個改動和發票的關係以及為什麼現在要做。";
    const R2 = { ...ROOM, turns: [...ROOM.turns,
      { n: 3, action: "how", text: "這個改動是怎麼運作的？", lang: "zh-TW", status: "done", provider: "codex", model: "gpt-6", answer: "## 很長的完整說明\n\n第一段落，內容只在紀錄裡看得到 [diff:src/percent.ts]。\n\n第二段落。", claims: [cl("第一段落 [diff:src/percent.ts]。", [ok1("diff:src/percent.ts")])],
        scenes: [{ n: 1, title: "四捨五入到整數分", picture: "B1-2", points: [cl("金額先進 percent [board:B1-1]。", [ok1("board:B1-1")]), cl("結果取整到分 [board:B1-2]。", [ok1("board:B1-2")]), cl("我推測是為了發票 [inference]。")] }] },
      { n: 4, action: "why", text: "為什麼要這樣做？", lang: "zh-TW", status: "done", provider: "codex", model: "gpt-6", answer: "z", claims: [cl(LONG, [ok1("diff:src/percent.ts:L2-3"), ok1("diff:test/percent.test.ts")]),
        { text: "| 金額 | 15% |\n|---|---|\n| 1999 | 300 |", kind: "table", basis: null, cites: [] }, cl("表格之後的一點 [inference]。")] }] };
    const { ctx, p } = await open(1440, "zh-TW"); await p.setViewportSize({ width: 1440, height: 900 });
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: R2 }));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t3"]');
    let s = await stage(p); const kick = await p.evaluate(() => ({ kicker: document.querySelector(".rr-kicker")?.textContent, badges: document.querySelectorAll('[data-stage] .rr-point [data-basis="inference"]').length, tiers: document.querySelectorAll("[data-stage] .rr-tier").length }));
    ok(s.title === "四捨五入到整數分" && s.visual === "B1-2" && s.points === 3 && kick.badges === 1 && kick.tiers === 0 && !/提問：|Question/.test(kick.kicker), "a scene the tutor showed: its own short title, its picture, its points; one inference badge, the [inference] tag not shown again; no “Question: …” title", JSON.stringify({ s, kick }));
    await p.click("[data-transcript-toggle]");
    const full = await p.evaluate(() => { const d = document.querySelector('[data-answer="3"]'); return d && d.textContent; });
    ok(/導師的完整回答/.test(full || "") && /內容只在紀錄裡看得到/.test(full || "") && !/內容只在紀錄裡看得到/.test(await p.textContent("[data-stage]")), "the tutor's full answer is in the transcript, not on the board", full);
    await p.click('[data-jump="t4"]'); await p.click("[data-replay]"); await p.click("[data-play]");
    const lens = []; let sawTable = false, maxShown = 0;
    for (let i = 0; i < 12; i++) { const m = await p.evaluate(() => ({ cur: document.querySelector('[data-stage] .rr-point[aria-current="true"] .rr-ptext')?.textContent || "", type: document.querySelector("[data-visual] [data-item-type]")?.dataset.itemType, shown: document.querySelectorAll("[data-stage] .rr-point").length, at: document.querySelector("[data-point-pos]")?.dataset.pointPos, scene: document.querySelector("[data-stage]").dataset.scene }));
      if (m.scene !== "t4") break; lens.push(m.cur.replace(/\s*(diff|白板)\s[^\s]+/g, "").length); if (m.type === "table") sawTable = true; maxShown = Math.max(maxShown, m.shown);
      if (m.at && m.at.split("/")[0] === m.at.split("/")[1]) break; await p.keyboard.press("ArrowRight"); }
    ok(lens.length >= 3 && lens.every((n) => n <= 62) && maxShown <= 4 && sawTable, "an older long answer is split by sentence into short points (≤ 60 CJK characters), at most four a page; its markdown table becomes a table picture", JSON.stringify({ lens, maxShown, sawTable }));
    ok(await p.evaluate(() => document.querySelector("[data-visual] [data-table] th")?.textContent === "金額" && !document.querySelector("[data-visual] [data-table] script")), "the table is drawn by Studio as text cells");
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t0"]');
    await p.click('[data-visual-pick="B0-1"]');
    const zh = await p.evaluate(() => ({ title: document.querySelector("[data-scene-title]")?.textContent, foot: document.querySelector("[data-visual] .rr-item-h")?.textContent, stage: document.querySelector("[data-stage]").textContent }));
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); await p.click("[data-replay]"); await p.click("[data-play]"); const flow = await p.evaluate(() => document.querySelector("[data-visual] .rr-item-h")?.textContent || "");
    ok(zh.title === "這間審查室只講 #7 這一個 PR" && /一眼看懂這個改動/.test(zh.foot) && !/This change at a glance|mermaid/.test(zh.stage + flow) && /流程圖/.test(flow), "a Chinese room has no English titles or badges: Studio's titles and every picture's kind read in Chinese", JSON.stringify({ zh, flow }));
    await ctx.close(); }

  // ---------- paper, handwriting and motion: only what is new is drawn; reduced motion shows the final picture ----------
  { const { ctx, p } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); const asked = [];
    p.on("request", (q) => asked.push(q.url()));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); await p.click("[data-replay]");
    const pen = () => p.evaluate(() => ({ nodes: [...document.querySelectorAll("[data-visual] [data-node]")].map((n) => n.dataset.node + (n.querySelector(".rr-pen") ? "~" : "") + (n.querySelector(".rr-write") ? "w" : "")), edges: [...document.querySelectorAll("[data-visual] [data-edge]")].map((e) => e.dataset.edge + (e.classList.contains("rr-pen") ? "~" : "")) }));
    const s1 = await pen(); await p.click("[data-play]"); await p.click("[data-point-next]"); const s2 = await pen(); await p.evaluate(() => render()); const s3 = await pen();
    ok(JSON.stringify(s1) === JSON.stringify({ nodes: ["A~w", "B~w"], edges: ["A>B~"] }) && JSON.stringify(s2) === JSON.stringify({ nodes: ["A", "B", "C~w"], edges: ["A>B", "B>C~"] }) && JSON.stringify(s3.nodes) === JSON.stringify(["A", "B", "C"]),
      "the pen draws only what is new: the first step's nodes, edges and labels; the next step only the part it adds; a redraw draws nothing again", JSON.stringify({ s1, s2, s3 }));
    const look = await p.evaluate(() => { const b = getComputedStyle(document.querySelector(".rr-board")), t = getComputedStyle(document.querySelector("[data-scene-title]")), c = getComputedStyle(document.querySelector(".rr-caption")), f = getComputedStyle(document.querySelector("[data-visual] [data-node] text"));
      return { paper: b.backgroundColor, title: t.fontFamily, label: f.fontFamily, caption: c.backgroundColor, body: getComputedStyle(document.querySelector(".rr-ptext")).fontFamily }; });
    const css = await p.evaluate(async () => { const r = await fetch("/fonts/hand.css"); const t = await r.text(); return { ok: r.ok, faces: (t.match(/@font-face/g) || []).length, ranges: (t.match(/unicode-range:/g) || []).length, google: /googleapis|gstatic/.test(t), files: [...new Set([...t.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]))].length }; });
    const font = await p.evaluate(async () => { const r = await fetch((await (await fetch("/fonts/hand.css")).text()).match(/url\("([^"]+wenkai-latin\.woff2)"\)/)[1]); return [r.ok, r.headers.get("content-type")]; });
    ok(look.paper === "rgb(255, 252, 244)" && /Caveat/.test(look.title) && /Caveat|WenKai/.test(look.label) && !/Caveat|WenKai/.test(look.body) && look.caption === "rgb(255, 247, 224)", "the board is paper (#fffcf4) with a paper caption strip; titles and picture labels are handwritten, the points stay in the UI font", JSON.stringify(look));
    ok(css.ok && css.faces > 100 && css.faces === css.ranges && css.files === css.faces && !css.google && font[0] && /font\/woff2|application\/octet-stream|font/.test(font[1] || "") && !asked.some((u) => /googleapis|gstatic/.test(u)), "the handwriting is Studio's own: one woff2 slice per unicode-range, nothing asked of Google Fonts", JSON.stringify({ css, font }));
    await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", colorScheme: "dark" });
    await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
    await ctx.addInitScript(stubs, ["unavailable"]); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: ROOM }));
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); await p.click("[data-replay]");
    const rm = await p.evaluate(() => ({ moving: document.querySelectorAll("[data-stage] .rr-pen, [data-stage] .rr-write, [data-stage] .rr-grow, [data-stage] .rr-enter, [data-stage] .rr-hl.rr-anim").length, anim: [...document.querySelectorAll("[data-stage] *")].filter((e) => getComputedStyle(e).animationName !== "none").length, nodes: document.querySelectorAll("[data-visual] [data-node]").length }));
    ok(rm.moving === 0 && rm.anim === 0 && rm.nodes === 2, "with reduced motion the picture shows its final state at once: nothing is drawn or written in", JSON.stringify(rm));
    await p.keyboard.press("ArrowRight"); await p.keyboard.press("ArrowRight");
    const dark = await p.evaluate(() => { const lum = (c) => { const v = c.match(/[\d.]+/g).map(Number); const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]); };
      const mix = (fg, bg) => { const a = fg.match(/[\d.]+/g).map(Number), b = bg.match(/[\d.]+/g).map(Number), al = a[3] ?? 1; return `rgb(${[0, 1, 2].map((i) => a[i] * al + b[i] * (1 - al)).join(",")})`; };
      const badge = document.querySelector('[data-stage] [data-basis="inference"]'), li = badge.closest(".rr-point"), board = getComputedStyle(document.querySelector(".rr-board")).backgroundColor;
      const under = mix(getComputedStyle(li).backgroundColor, board), bg = mix(getComputedStyle(badge).backgroundColor, under), fg = getComputedStyle(badge).color, L1 = lum(fg), L2 = lum(bg);
      return { paper: board, ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100, img: getComputedStyle(document.querySelector(".rr-fig img") || document.body).backgroundColor }; });
    ok(dark.paper === "rgb(27, 31, 39)" && dark.ratio >= 4.5, "dark: the paper is #1b1f27 and the inference badge reads at 4.5:1 or more", JSON.stringify(dark));
    await ctx.close(); }
  // ---------- the welcome scene: Studio's own, free, with the lesson one confirmed click away ----------
  { const { ctx, p, posts } = await open(1440, "zh-TW"); await p.setViewportSize({ width: 1440, height: 900 });
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: { ...ROOM, turns: [], board: [], check: { questions: [] } } }));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    const w = await p.evaluate(() => ({ scene: document.querySelector("[data-stage]").dataset.scene, title: document.querySelector("[data-scene-title]")?.textContent, kicker: document.querySelector(".rr-kicker")?.textContent, chart: document.querySelector("[data-visual] [data-chart]")?.dataset.chart, rows: document.querySelectorAll("[data-visual] .rr-chart-l").length, points: document.querySelectorAll("[data-stage] .rr-point").length, cta: document.querySelector("[data-welcome-teach]")?.textContent, empty: !!document.querySelector("[data-board-empty]") }));
    ok(w.scene === "t0" && w.title === "這間審查室只講 #7 這一個 PR" && /Studio 做的，免費/.test(w.kicker) && w.chart === "diffstat" && w.rows === 2 && w.points === 3 && /教我這個 PR/.test(w.cta) && !w.empty, "a new room opens on Studio's welcome scene: what it is about, its files' line counts, three points and “教我這個 PR”", JSON.stringify(w));
    await p.click("[data-welcome-teach]"); await p.waitForSelector('[data-room-confirm="teach"]');
    ok(!posts.length && /付費/.test(await p.textContent("[data-room-confirm]")), "the welcome scene's lesson still asks to confirm the paid round first");
    await ctx.close(); }

  // ---------- the check as multiple choice: option buttons on the board, Studio grades the pick, a miss can be re-explained ----------
  { const MC = [{ n: 3, q: "What does percent(1999, 15) return?", turn: 3, at: "t", options: ["300", "299", "299.85"] }, { n: 4, q: "Where could rounding surprise a user?", turn: 3, at: "t", options: ["Negative amounts", "Halves of a cent"] }];
    const R3 = { ...ROOM, turns: [...ROOM.turns, { n: 3, action: "quiz", text: "Check my understanding: ask me a few questions.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "Two questions are on the board.", claims: [cl("Two questions are on the board.")] }], check: { questions: [...ROOM.check.questions, ...MC] } };
    const { ctx, p, posts } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); const picks = [];
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: R3 }));
    await p.route(/\/api\/review-room\/SC-50\/check-answer$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); picks.push(b);
      const qs = R3.check.questions.map((q) => q.n === b.n ? { ...q, choice: b.choice, answer: 0, why: "Math.round rounds 299.85 up to 300", cites: [ok1("diff:src/percent.ts:L2-3")], result: { correct: b.choice === 0, note: "Math.round rounds 299.85 up to 300", turn: 3, choice: b.choice, by: "studio" } } : q);
      r.fulfill({ json: { n: b.n, correct: b.choice === 0, room: { ...R3, check: { questions: qs } } } }); });
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    let s = await stage(p);
    const before = await p.evaluate(() => ({ opts: [...document.querySelectorAll("[data-visual] [data-quiz-option]")].map((e) => [e.dataset.quizOption, e.disabled, e.textContent]), marks: document.querySelectorAll("[data-visual] .rr-mk").length, q: document.querySelector(".rr-quiz-q")?.textContent, play: document.querySelector("[data-play]").disabled }));
    ok(s.scene === "t3-quiz" && before.q === MC[0].q && JSON.stringify(before.opts.map((o) => o[0])) === JSON.stringify(["3:0", "3:1", "3:2"]) && before.opts.every((o) => !o[1]) && !before.marks && before.play, "the check is a scene of option buttons, one question at a time; nothing is marked before the captain picks, and playback never runs through it", JSON.stringify({ s, before }));
    await p.click('[data-quiz-option="3:1"]'); await p.waitForSelector("[data-quiz-verdict]");
    const after = await p.evaluate(() => ({ verdict: document.querySelector("[data-quiz-verdict]")?.dataset.quizVerdict, text: document.querySelector("[data-quiz-verdict]")?.textContent, right: document.querySelector('[data-quiz-option="3:0"]').className, wrong: document.querySelector('[data-quiz-option="3:1"]').className, marks: document.querySelectorAll("[data-visual] .rr-mk").length, disabled: [...document.querySelectorAll("[data-quiz-option]")].every((e) => e.disabled), cite: !!document.querySelector('[data-quiz-verdict] [data-cite="diff:src/percent.ts:L2-3"]') }));
    ok(JSON.stringify(picks) === JSON.stringify([{ n: 3, choice: 1 }]) && after.verdict === "missed" && /299\.85 up to 300/.test(after.text) && /right/.test(after.right) && /wrong/.test(after.wrong) && after.marks === 2 && after.disabled && after.cite && !posts.length, "a pick is sent as {n, choice} and graded by Studio: the right option and the wrong pick are marked, why is shown with its citation; nothing paid ran", JSON.stringify({ picks, after }));
    await p.click("[data-quiz-reteach]"); await p.waitForSelector('[data-room-confirm="ask"]');
    ok(/paid model round/.test(await p.textContent("[data-room-confirm]")) && !posts.length, "a missed question offers “re-explain with the board”, a normal paid turn that asks to confirm first");
    await p.click("[data-room-start]"); await p.waitForFunction(() => document.querySelector("[data-room-busy]"));
    ok(posts.length === 1 && posts[0].action === "ask" && /question 3/.test(posts[0].text) && /picked B/.test(posts[0].text), "the re-explanation asks about that question, saying what the captain picked", JSON.stringify(posts));
    // a double click (A, then B while A is being sent) sends one answer and shows no error
    { const p2 = await ctx.newPage(); const sent = []; p2.on("pageerror", (e) => errors.push(e.message));
      await p2.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: R3 }));
      await p2.route(/\/api\/review-room\/SC-50\/check-answer$/, async (r) => { const b = JSON.parse(r.request().postData() || "{}"); sent.push(b); await new Promise((res) => setTimeout(res, 300));
        if (sent.length > 1) return r.fulfill({ status: 400, json: { error: "This question is answered already", code: "answered" } });
        r.fulfill({ json: { n: b.n, correct: b.choice === 0, room: { ...R3, check: { questions: R3.check.questions.map((q) => q.n === b.n ? { ...q, choice: b.choice, answer: 0, why: "w", cites: [], result: { correct: b.choice === 0, note: "w", turn: 3, choice: b.choice, by: "studio" } } : q) } } } }); });
      await p2.goto(`${base}/#/room/SC-50`); await p2.waitForSelector('[data-quiz-option="3:0"]', { timeout: 15000 });
      await p2.evaluate(() => { const a = document.querySelector('[data-quiz-option="3:0"]'), b = document.querySelector('[data-quiz-option="3:1"]'); a.click(); b.click(); });
      await p2.waitForSelector("[data-quiz-verdict]", { timeout: 5000 }).catch(() => {}); await p2.waitForTimeout(500);
      ok(sent.length === 1 && sent[0].choice === 0 && !(await p2.$("[data-room-error]")) && await p2.evaluate(() => document.querySelector("[data-quiz-verdict]")?.dataset.quizVerdict) === "correct", "a double click on two options sends one answer (the first) and shows no error", JSON.stringify(sent)); }
    await ctx.close(); }

  // ---------- the explanation's language, switched live: a kept translation at once, a missing one after one confirmation ----------
  { const TR = { "1": { scenes: [], claims: ["## 百分比怎麼算", "以分為單位的金額進入 `percent` [board:B1-1]。", "結果取整到分 [board:B1-2] [diff:src/percent.ts:L2-3]。", "我推測這是為了發票 <img src=x onerror=\"window.__pwned=1\">。", "頁面上的總額差了一分錢 [board:B1-7]。", "要我講深一點嗎？"], answer: "譯文", provider: "codex", model: "gpt-6", at: "t" } };
    const R6 = { ...ROOM, translations: { "zh-TW": TR }, translate: { estimate: 0.02, confirmed: false, pending: { en: [], "zh-TW": [2] } } };
    const { ctx, p, posts } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); const trs = [];
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: R6 }));
    await p.route(/\/api\/review-room\/SC-50\/translate$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); trs.push(b);
      if (b.confirm !== "tr0123456789abcd") return r.fulfill({ status: 409, json: { error: "confirm", code: "confirm_required", offer: { ...ROOM.offer, translate: { hash: "tr0123456789abcd", estimate: 0.02, lang: b.lang } } } });
      r.fulfill({ json: { ...R6, running: -2, translating: { lang: b.lang, status: "running" }, translate: { ...R6.translate, confirmed: true } } }); });
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); await p.click("[data-replay]"); await p.click("[data-play]");
    const before = (await stage(p)).caption; await p.click('[data-lang-pick="zh-TW"]');
    let s6 = await stage(p);
    ok(/An amount in cents goes into percent/.test(before) && s6.title === "百分比怎麼算" && /以分為單位的金額進入/.test(s6.caption) && !trs.length && !posts.length && await p.$eval("[data-room-lang]", (e) => e.dataset.roomLang) === "zh-TW", "a kept translation shows at once: the title, the points and the caption switch language, nothing is asked or paid", JSON.stringify({ before, s6 }));
    ok(await p.evaluate(() => !window.__pwned && !document.querySelector(".rr-point img")) && s6.visual === "B1-1", "a translation is text: markup in it stays text, and the board's pictures are the original's", JSON.stringify(s6));
    const voices = await p.$$eval("[data-voice] option", (els) => els.map((e) => e.value));
    ok(voices.includes("local:mj") && !voices.includes("local:ava"), "the voice follows the language shown: this Mac's Chinese voice now", JSON.stringify(voices));
    await p.click('[data-lang-pick="zh-CN"]'); s6 = await stage(p);
    ok(s6.title === "百分比怎么算" && !trs.length, "简体 comes from the 繁體 text through OpenCC: nothing paid", JSON.stringify(s6));
    await p.click('[data-lang-pick="en"]'); await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t2"]');
    await p.click('[data-lang-pick="zh-TW"]'); await p.waitForSelector("[data-translate-confirm]");
    ok(/US\$0\.02/.test(await p.textContent("[data-translate-confirm]")) && !trs.length, "a language not kept yet asks to confirm the translation once, with its cost", await p.textContent("[data-translate-confirm]"));
    await p.click("[data-translate-start]"); await p.waitForFunction(() => document.querySelector('[data-room-busy="translate"]'));
    ok(trs.length === 2 && trs[0].lang === "zh-TW" && trs[1].confirm === "tr0123456789abcd" && !posts.length, "confirmed, the translation is sent with the room's confirmation; the dock says it is translating", JSON.stringify(trs));
    await ctx.close(); }

  // ---------- regenerate with another model: both answers kept, the latest shown, a held model not pickable ----------
  { const R7 = { ...ROOM, turns: [...ROOM.turns, { n: 3, action: "ask", text: "1: 300. 2: not sure.", regenOf: 2, picked: { provider: "claude", model: "opus-x", effort: null }, lang: "en", status: "done", provider: "claude", model: "opus-x", answer: "z", claims: [cl("Halves round away from zero, said again [source:1].", [ok1("source:1")])] }],
      tutors: [{ provider: "codex", model: "gpt-6", effort: "high", runnable: true, held: null, level: "same", current: true }, { provider: "claude", model: "opus-x", effort: null, runnable: true, held: null, level: "vendor", current: false }, { provider: "codex", model: "gpt-5", effort: "medium", runnable: true, held: null, level: "model", current: false }, { provider: "cursor", model: "c-9", effort: null, runnable: false, held: "out of quota", level: "vendor", current: false }] };
    const { ctx, p, posts } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); const turns = [];
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: R7 }));
    await p.route(/\/api\/review-room\/SC-50\/turn$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); turns.push(b);
      if (!b.confirm) return r.fulfill({ status: 409, json: { error: "confirm", code: "confirm_required", offer: { ...ROOM.offer, provider: b.pick.provider, model: b.pick.model, hash: "re0123456789abcd" } } });
      r.fulfill({ json: { ...R7, running: 4 } }); });
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    let s7 = await stage(p); const vers = await p.$$eval("[data-version-pick]", (els) => els.map((e) => [e.dataset.versionPick, e.getAttribute("aria-pressed"), e.textContent]));
    ok(s7.scene === "t3" && /said again/.test(await p.textContent("[data-stage] .rr-pointlist")) && JSON.stringify(vers) === JSON.stringify([["2", "false", "codex gpt-6"], ["3", "true", "claude opus-x"]]), "a regenerated answer is kept beside the first: the scene shows the latest, with a switcher naming each model", JSON.stringify({ s7, vers }));
    await p.click('[data-version-pick="2"]'); s7 = await stage(p);
    ok(s7.scene === "t2" && /Halves round up/.test(await p.textContent("[data-stage] .rr-pointlist")), "the switcher shows the first answer again", JSON.stringify(s7));
    await p.click("[data-regen]"); const list = await p.$$eval("[data-regen-pick]", (els) => els.map((e) => [e.dataset.regenPick, e.disabled, e.textContent]));
    ok(list.length === 4 && list[0][2].includes("current") && list[2][2].includes("same vendor as the author") && list[3][1] === true && /out of quota/.test(list[3][2]) && list.slice(0, 3).every((x) => !x[1]), "“Regenerate with…” lists this machine's models: the current one marked, the author's vendor said, a held one not pickable", JSON.stringify(list));
    await p.click('[data-regen-pick="claude|opus-x"]'); await p.waitForSelector('[data-room-confirm]');
    ok(turns.length === 1 && turns[0].regenerate === 2 && turns[0].pick.provider === "claude" && !turns[0].confirm && /claude · opus-x/.test(await p.textContent("[data-room-confirm]")), "picking a model asks to confirm a paid round on that model first", JSON.stringify(turns));
    await p.click("[data-room-start]"); await p.waitForFunction(() => document.querySelector("[data-room-busy]"));
    ok(turns.length === 2 && turns[1].confirm === "re0123456789abcd" && turns[1].regenerate === 2 && !posts.length, "confirmed, the same question is asked again on the picked model", JSON.stringify(turns));
    await ctx.close(); }

  // ---------- a room saved in the Library: replayed in the room, read-only, offline, no paid control ----------
  { const MCQ = { n: 3, q: "What does percent(1999, 15) return?", turn: 1, at: "t", options: ["300", "299"], answer: 0, choice: 1, why: "Math.round", cites: [], result: { correct: false, note: "Math.round", turn: 1, choice: 1, by: "studio" } };
    const SNAP = { schema: 1, kind: "review-room-snapshot", room: "SC-50", savedAt: "2026-10-28T13:00:00Z", reason: "The merge card was answered", subject: { kind: "merge", head: H, base: B }, tutors: [{ provider: "codex", model: "gpt-6" }], cost: { usd: 0.04 },
      view: { ...ROOM, autoTeach: { on: true, skipped: "No tutor can run on this Mac now" }, board: ROOM.board.map((b) => b.id === "B1-9" ? { ...b, src: "/api/review-room/library/room-sc-50/2/asset/B1-9.png" } : b), open: false, offer: null, running: null, tutors: [], translate: null, closed: { en: "Saved", zh: "已存" }, check: { questions: [...ROOM.check.questions, MCQ] },
        translations: { "zh-TW": { "1": { scenes: [], claims: ["## 百分比怎麼算", "a", "b", "c", "d", "e"], answer: "譯", provider: "codex", model: "gpt-6", at: "t" } } } },
      cites: { "diff:src/percent.ts:L2-3": { kind: "diff", path: "src/percent.ts", from: 2, to: 3, head: H, text: "@@ -0,0 +1 @@\n+  return Math.round((amount * pct) / 100);" } }, artifact: "room-sc-50", n: 2, versions: [{ n: 1, at: "t", summary: "Saved by captain" }, { n: 2, at: "t", summary: "The merge card was answered" }] };
    const { ctx, p, posts, cites, speech } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); const live = [];
    await p.route(/\/api\/review-room\/library\/room-sc-50(\?v=\d+)?$/, (r) => r.fulfill({ json: SNAP }));
    await p.route(/\/api\/review-room\/library\/room-sc-50\/2\/asset\/B1-9\.png$/, (r) => r.fulfill({ body: PNG, contentType: "image/png" }));
    p.on("request", (q) => { if (/\/api\/review-room\/SC-50/.test(q.url())) live.push(q.url()); });
    await p.goto(`${base}/#/room/lib:room-sc-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    const ro = await p.evaluate(() => ({ note: document.querySelector("[data-room-readonly]")?.textContent, paid: ["[data-room-action]", "[data-room-text]", "[data-room-send]", "[data-mic]", "[data-welcome-teach]", "[data-regen]", "[data-room-save]", "[data-room-check]", "[data-translate-start]"].filter((q) => document.querySelector(q)),
      snap: document.querySelector("[data-room-snapshot]")?.dataset.roomSnapshot, vers: [...document.querySelectorAll("[data-snapshot-version]")].map((e) => e.dataset.snapshotVersion), focus: document.body.dataset.focus === "room", voice: !!document.querySelector("[data-voice]"), vendor: !!document.querySelector('[data-voice] option[value="vendor"]') }));
    for (let k = 0; k < 30 && await p.$("[data-scene-prev]:not([disabled])"); k++) { await p.click("[data-scene-prev]"); await p.waitForTimeout(30); }
    const wel = await p.evaluate(() => { return { welcome: !!document.querySelector('[data-stage]') && /This room is only about/.test(document.querySelector("[data-stage]").textContent), skipped: !!document.querySelector("[data-auto-skipped]") }; });
    ok(wel.welcome && !wel.skipped, "a saved room's welcome never shows an auto-teach notice, even from a snapshot that still carries one", JSON.stringify(wel));
    ok(/read-only replay/.test(ro.note || "") && !ro.paid.length && ro.snap === "room-sc-50@2" && JSON.stringify(ro.vers) === JSON.stringify(["1", "2"]) && ro.focus && ro.voice && !ro.vendor, "a saved room opens from the Library in the room itself, read-only: no prompt, no paid control, its versions listed, this Mac's voice still there", JSON.stringify(ro));
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); await p.click("[data-replay]"); await p.click("[data-play]"); await p.click("[data-point-next]"); await p.click('[data-stage] [data-cite="diff:src/percent.ts:L2-3"]');
    await p.waitForSelector("[data-cite-panel] .rr-diff");
    ok(/Math\.round/.test(await p.textContent("[data-cite-panel]")) && !cites.length && !live.length, "a citation opens from the snapshot itself: nothing asked of the live room or the cache", JSON.stringify({ cites, live }));
    await p.click("[data-cite-panel] .btn");
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); await p.click("[data-replay]"); const cap = (await stage(p)).caption;
    ok(/An amount in cents goes into percent/.test(cap) && await p.$eval("[data-play]", (e) => !e.disabled), "captions and playback still work", cap);
    await p.click("[data-play]"); await p.click('[data-lang-pick="zh-TW"]'); const zh = await stage(p);
    ok(zh.title === "百分比怎麼算" && await p.$eval('[data-lang-pick="en"]', (e) => !e.disabled), "the language switch uses the languages saved with it", JSON.stringify(zh));
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1-quiz"]');
    const quiz = await p.evaluate(() => ({ disabled: [...document.querySelectorAll("[data-quiz-option]")].every((e) => e.disabled), verdict: document.querySelector("[data-quiz-verdict]")?.dataset.quizVerdict, reteach: !!document.querySelector("[data-quiz-reteach]") }));
    ok(quiz.disabled && quiz.verdict === "missed" && !quiz.reteach && !posts.length && !speech.length, "the check shows the captain's answers and results, nothing to pick and nothing to pay", JSON.stringify(quiz));
    // the Library's page of a saved room: replay it (each version), never review, approve or compare it
    const ver = (n) => ({ n, status: "draft", createdAt: "2026-10-28T13:00:00Z", createdBy: { kind: "host" }, approvedBy: null, approvedAt: null, primary: "room.json", sha256: null, parent: n > 1 ? n - 1 : null, annotations: [], cost: { usd: 0.04 }, render: null, url: null, notes: 0, fileCount: 2, summary: "saved", files: [{ path: "room.json" }] });
    await p.route(/\/api\/artifacts\/room-sc-50$/, (r) => r.fulfill({ json: { artifact: { id: "room-sc-50", title: "Review room · Merge: Add percent", type: "doc", project: "studio", source: "room", created: "2026-10-28T13:00:00Z", note: null, entry: null }, versions: [ver(1), ver(2)], runs: [] } }));
    await p.evaluate(() => { location.hash = "#/artifact/room-sc-50"; }); await p.waitForSelector("[data-replay-room]", { timeout: 15000 });
    const libPage = await p.evaluate(() => ({ replay: document.querySelector("[data-replay-room]")?.getAttribute("href"), versions: [...document.querySelectorAll("[data-replay-version]")].map((e) => e.closest("a").getAttribute("href")), review: !!document.querySelector('a[href^="#/review/room-sc-50"]'), compare: !!document.querySelector('a[href^="#/compare/room-sc-50"]'), focus: document.body.dataset.focus === "room" }));
    ok(libPage.replay === "#/room/lib:room-sc-50@2" && libPage.versions.length === 2 && !libPage.review && !libPage.compare && !libPage.focus, "the Library shows a saved room with “Replay in the review room” for each version, and no review, approval or compare", JSON.stringify(libPage));
    await ctx.close(); }

  // ---------- getting back: the sidebar's Review room, its list of rooms, the room's crumb, external links in a new window ----------
  { const { ctx, p } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 });
    await p.addInitScript(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push([u, t, f]); return null; }; });
    let sc50Turns = 2;
    await p.route(/\/api\/review-room$/, (r) => r.fulfill({ json: { rooms: [{ id: "SC-50", kind: "merge", title: "Merge: Add percent", titleZh: "合併：新增 percent", open: true, running: false, turns: sc50Turns, repository: null, updatedAt: "2026-10-28T10:00:00Z" }, { id: "PR-0123456789ab-7", kind: "pr", title: "Pull request #7: Shout", open: false, running: false, turns: 1, repository: "fixture/project", updatedAt: "2026-10-28T12:00:00Z" }] } }));
    await p.goto(`${base}/#/board`); await p.waitForFunction(() => S.route?.name === "board");
    const navItem = await p.evaluate(() => { const b = document.querySelector('.nav-item[data-view="room"]'); return b && { inLabs: !!b.closest(".nav-labs"), hidden: b.hidden, text: b.textContent }; });
    ok(navItem && !navItem.inLabs && !navItem.hidden && /Review room/.test(navItem.text), "the sidebar has a Review room item of its own (on the rail too when it is folded)", JSON.stringify(navItem));
    await p.click('.nav-item[data-view="room"]'); await p.waitForSelector("[data-room-link]", { timeout: 15000 });
    const list = await p.$$eval("[data-room-link]", (els) => els.map((e) => [e.dataset.roomLink, e.getAttribute("href")]));
    ok(JSON.stringify(list) === JSON.stringify([["SC-50", "#/room/SC-50"], ["PR-0123456789ab-7", "#/room/PR-0123456789ab-7"]]) && /open/.test(await p.textContent('[data-room-list]')), "the Review room's home lists the rooms on this machine, open ones first, each a link back into it", JSON.stringify(list));
    await p.click('[data-room-link="SC-50"]'); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    ok(await p.$eval("[data-room-home]", (e) => e.getAttribute("href")).catch(() => null) === "#/room" && /Review room/.test(await p.$eval(".rr-crumb", (e) => e.textContent).catch(() => "")), "the room's header says where you are: Review room › the room, the first a link to the list");
    const inRoom = await p.evaluate(() => ({ focus: document.body.dataset.focus ?? null, crumb: !!document.querySelector("[data-room-home]")?.getClientRects().length }));
    ok(inRoom.focus === "room" && inRoom.crumb, "a loaded room is a focus page (body[data-focus=room]) and its way back to the list stays in view", JSON.stringify(inRoom));
    sc50Turns = 3; await p.goBack(); await p.waitForFunction(() => S.route?.name === "room" && !S.route.arg); const onList = await p.evaluate(() => document.body.dataset.focus ?? null);
    const fresh = await p.waitForFunction(() => /3 answers/.test(document.querySelector("[data-room-list]")?.textContent || ""), null, { timeout: 5000 }).then(() => true, () => false);
    ok(fresh, "coming back to the room list reads it again: a room's new answers show", await p.$eval("[data-room-list]", (e) => e.textContent).catch(() => ""));
    await p.goBack(); await p.waitForFunction(() => S.route?.name === "board"); const onBoard = await p.evaluate(() => document.body.dataset.focus ?? null);
    ok(onList === null && onBoard === null, "the browser's back walks Studio's own pages: room → the room list → the board, and focus ends with the room", JSON.stringify({ onList, onBoard }));
    await p.evaluate(() => { location.hash = "#/room/SC-50"; }); await p.waitForSelector("[data-stage]");
    const ext = await p.evaluate(() => { const a = document.createElement("a"); a.href = "https://example.org/docs"; a.textContent = "x"; document.querySelector("#view").append(a); const before = location.href; a.click(); return { opened: window.__opened, same: location.href === before }; });
    ok(ext.same && ext.opened.length === 1 && ext.opened[0][0] === "https://example.org/docs" && ext.opened[0][1] === "_blank" && /noopener/.test(ext.opened[0][2]), "a link that leaves Studio opens in a new window, never in Studio's own (an app window has no back button)", JSON.stringify(ext));
    const inApp = await p.evaluate(() => { window.__opened = []; const a = document.createElement("a"); a.href = "#/board"; document.querySelector("#view").append(a); a.click(); return window.__opened.length; });
    await p.waitForFunction(() => S.route?.name === "board");
    ok(inApp === 0, "Studio's own pages still open in place");
    const own = await p.evaluate(() => { window.__opened = []; const mk = (href, take) => { const a = document.createElement("a"); a.href = href; if (take) a.addEventListener("click", (e) => e.preventDefault()); document.querySelector("#view").append(a); a.click(); };
      mk("https://example.org/handled", true); mk("mailto:someone@example.org", true); return window.__opened.length; });
    ok(own === 0, "a link whose own handler takes the click, or that is not http(s), is left to that handler: Studio opens no window for it");
    await ctx.close(); }

  // ---------- a pull request's reviewers: a short card on the board, their words folded in the transcript ----------
  { const LONG = "the cache key ignores the port and the scheme, so two origins share one approval; ".repeat(10);
    const notes = Array.from({ length: 30 }, (_, i) => ({ id: `c${100 + i}`, kind: i % 3 ? "inline" : "review", author: i % 2 ? "lint-im" : "sage-im", body: `${LONG} (${i})`, at: `2026-10-28T1${i % 10}:00:00Z`, url: null, state: i % 3 ? undefined : "COMMENTED", path: i % 3 ? "a.txt" : null, line: i % 3 ? 2 : null, outdated: i > 20, bot: false }));
    const PRR = { ...ROOM, card: { id: "PR-0123456789ab-8", run: "R-050", node: "review", title: { en: "Pull request #8: Busy", "zh-TW": "Pull request #8：Busy" }, status: "open" }, subject: { kind: "pr", room: "PR-0123456789ab-8", url: "https://github.com/fixture/project/pull/8", repository: "fixture/project", number: 8 }, pr: { id: "8", url: "https://github.com/fixture/project/pull/8" }, summary: null,
      prState: { state: "open", draft: false, approved: false, checkedAt: "2026-10-28T12:00:00Z", headRepo: "fixture/project", verdicts: [] }, notes, board: [],
      actions: [...ROOM.actions, { id: "reviews", en: "Digest", zh: "整理" }],
      turns: [{ n: 1, action: "reviewers", studio: true, title: "What reviewers asked", status: "done", provider: "studio", model: "", text: "", answer: "x", head: H, claims: [cl("30 notes on GitHub from 2 people: 10 reviews, 20 inline comments, 0 comments."), { text: "20 of them are on the current head. Ask “Digest reviews”.", kind: "aside", basis: null, cites: [] }] }], check: { questions: [] } };
    const { ctx, p } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 });
    await p.route(/\/api\/review-room\/PR-0123456789ab-8(\?open=1)?$/, (r) => r.fulfill({ json: PRR }));
    await p.goto(`${base}/#/room/PR-0123456789ab-8`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    const st = await p.evaluate(() => ({ stage: document.querySelector("[data-stage]").textContent, points: document.querySelectorAll("[data-stage] .rr-point").length, digest: !!document.querySelector('[data-room-action="reviews"]') }));
    ok(!/the cache key ignores the port/.test(st.stage) && st.points <= 4 && st.digest, "the board shows Studio's short card of the reviews, none of their words; “Digest reviews” is a quick action", JSON.stringify({ points: st.points, digest: st.digest }));
    await p.click("[data-transcript-toggle]");
    const fold = await p.evaluate(() => { const d = document.querySelector("[data-notes]"); return d && { open: d.open, n: d.querySelectorAll("[data-note]").length, first: d.querySelector("[data-note]")?.dataset.note }; });
    ok(fold && fold.open === false && fold.n === 30, "their notes are in the transcript, folded until the captain opens them", JSON.stringify(fold));
    await ctx.close(); }

  // ---------- coming back while a turn runs; an answer already there; the answer that finished while the captain looked away ----------
  { const RUN = { ...ROOM, running: 3, progress: { turn: 3, status: "running", said: "Reading the diff and the tests first.", tools: 3, at: "t" },
      turns: [...ROOM.turns.map((t) => ({ ...t, head: H })), { n: 3, action: "teach", text: "Teach me this change.", lang: "en", status: "running", provider: "codex", model: "gpt-6", answer: "", head: H }, { n: 4, action: "since", studio: true, title: "What changed", status: "done", provider: "studio", model: "", text: "", answer: "x", head: H, claims: [cl("Nothing new.")] }] };
    const DONE = { ...RUN, running: null, progress: null, turns: RUN.turns.map((t) => t.n === 3 ? { ...t, status: "done", answer: "y", claims: [cl("The finished explanation [board:B1-1].", [ok1("board:B1-1")])] } : t) };
    const { ctx, p, posts } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); let now = RUN;
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: now }));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    let s1 = await stage(p);
    ok(s1.scene === "t3" && /Reading the diff and the tests first/.test(await p.textContent("[data-turn-progress]")) && /3 tool calls/.test(await p.textContent("[data-turn-progress]")), "coming back while a turn runs, the stage shows that turn and what it has said so far (not a later Studio scene)", JSON.stringify(s1));
    now = DONE; const shown = await p.waitForFunction(() => document.querySelector("[data-stage]")?.dataset.scene === "t3" && /finished explanation/.test(document.querySelector("[data-stage] .rr-pointlist")?.textContent || ""), null, { timeout: 15000 }).then(() => true, () => false);
    ok(shown, "when it finishes, the room shows the answer", JSON.stringify(await stage(p)));
    // an explanation for this head is already there: show it, or explain again (paid, still confirmed)
    await p.click('[data-room-action="teach"]'); const offered = await p.waitForSelector("[data-existing-offer]", { timeout: 5000 }).then(() => true, () => false);
    ok(offered && !(await p.$("[data-room-confirm]")) && !posts.length, "asking again what this head already has offers the existing explanation first, nothing paid");
    await p.click("[data-existing-show]"); s1 = await stage(p);
    ok(s1.scene === "t3" && !(await p.$("[data-existing-offer]")), "“Show the existing explanation” goes to it", JSON.stringify(s1));
    await p.click('[data-room-action="teach"]'); await p.click("[data-existing-again]"); await p.waitForSelector('[data-room-confirm="teach"]');
    ok(!posts.length, "“Explain again” is a new paid round: it still asks to confirm");
    await ctx.close(); }
  { const RUN = { ...ROOM, running: 3, progress: { turn: 3, status: "running", said: "Working.", tools: 1, at: "t" }, turns: [...ROOM.turns, { n: 3, action: "how", text: "How does this change work?", lang: "en", status: "running", provider: "codex", model: "gpt-6", answer: "" }] };
    const DONE = { ...RUN, running: null, progress: null, turns: RUN.turns.map((t) => t.n === 3 ? { ...t, status: "done", answer: "y", claims: [cl("It works like this.")] } : t) };
    const { ctx, p } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); let now = RUN;
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: now }));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.keyboard.press("ArrowLeft"); const away = (await stage(p)).scene;
    now = DONE; const chip = await p.waitForSelector("[data-answer-ready]", { timeout: 15000 }).then(() => true, () => false);
    const s2 = await stage(p);
    ok(chip && away !== "t3" && s2.scene === away, "the captain looked elsewhere while it ran: the finished answer does not pull the stage away", JSON.stringify({ away, s2 }));
    await p.click("[data-answer-ready]"); const s3 = await stage(p);
    ok(s3.scene === "t3" && !(await p.$("[data-answer-ready]")), "“The answer is ready — show it” goes to the answer", JSON.stringify(s3));
    await ctx.close(); }

  // ---------- a lesson of several chapters finishes: the stage opens it at its first chapter; leaving and coming back mid-turn keeps following it ----------
  { const RUN = { ...ROOM, running: 3, progress: { turn: 3, status: "running", said: "Reading the diff first.", tools: 1, at: "t" },
      turns: [...ROOM.turns.map((t) => ({ ...t, head: H })), { n: 3, action: "teach", text: "Teach me this change.", lang: "en", status: "running", provider: "codex", model: "gpt-6", answer: "", head: H }] };
    const HALF = { ...RUN, progress: { turn: 3, status: "running", said: "Halfway through the lesson.", tools: 4, at: "t" } };
    const DONE = { ...RUN, running: null, progress: null, turns: RUN.turns.map((t) => t.n === 3 ? { ...t, status: "done", answer: "y", claims: [cl("x")],
      scenes: [{ n: 1, chapter: "what", title: "A percent helper", picture: "B1-1", points: [cl("It adds percent."), cl("Rounded to the cent.")] },
        { n: 2, chapter: "change", title: "Rounding", picture: "B1-1", points: [cl("It rounds."), cl("Halves go up.")] },
        { n: 3, chapter: "watch", title: "What to watch", picture: "B1-1", points: [cl("Halves round up [board:B1-1].", [ok1("board:B1-1")]), cl("The test pins it [board:B1-1].", [ok1("board:B1-1")])] }] } : t) };
    const { ctx, p } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); let now = RUN;
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: now }));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-turn-progress]", { timeout: 15000 });
    // the captain leaves while it runs (the poll stops), the tutor gets further, the captain comes back
    await p.evaluate(() => { location.hash = "#/board"; }); await p.waitForFunction(() => S.route?.name === "board"); await p.waitForTimeout(3200);
    now = HALF; await p.evaluate(() => { location.hash = "#/room/SC-50"; });
    const followed = await p.waitForFunction(() => /Halfway through the lesson/.test(document.querySelector("[data-turn-progress]")?.textContent || ""), null, { timeout: 2000 }).then(() => true, () => false);
    ok(followed, "back in a room whose turn still runs, the room reads it again and shows how far it got (the poll follows it again)", await p.$eval("[data-turn-progress]", (e) => e.textContent).catch(() => ""));
    now = DONE; const done = await p.waitForFunction(() => !!document.querySelector('[data-toc-scene="t3-3"]') && !document.querySelector("[data-turn-progress]"), null, { timeout: 8000 }).then(() => true, () => false);
    await p.waitForTimeout(300);
    const s1 = await stage(p), cur = await p.$eval('[data-toc-scene][aria-current="true"]', (e) => e.dataset.tocScene).catch(() => null);
    const first = await p.evaluate(() => { const r = document.querySelector("[data-report]"), sec = r?.querySelector('[data-report-section="t3"]'); return r && sec ? { top: Math.round(sec.getBoundingClientRect().top - r.getBoundingClientRect().top), title: sec.querySelector("[data-section-title]")?.textContent } : null; });
    ok(done && s1.scene === "t3" && cur === "t3" && first && first.top < 260 && first.title === "A percent helper" && !(await p.$("[data-play][aria-pressed=\"true\"]")), "a lesson of several chapters that finishes opens as its report at its first chapter, not its last, and is not played", JSON.stringify({ done, s1, cur, first }));
    await ctx.close(); }

  // ---------- a quiz is new every time: no "show the existing one" offer ----------
  { const RQ = { ...ROOM, turns: [...ROOM.turns.map((t) => ({ ...t, head: H })), { n: 3, action: "quiz", text: "Check my understanding: ask me a few questions.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "q", head: H, claims: [cl("A question.")] }] };
    const { ctx, p, posts } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 });
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: RQ }));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.click('[data-room-action="quiz"]'); const asked = await p.waitForSelector('[data-room-confirm="quiz"]', { timeout: 3000 }).then(() => true, () => false);
    ok(asked && !(await p.$("[data-existing-offer]")) && !posts.length, "asking for a quiz again goes to its confirmation (a new quiz), never “show the existing one”");
    await ctx.close(); }

  // ---------- a lesson, chapter by chapter: the chapters' rail, per-item figures, a state machine, a sequence ----------
  { const LESSON = { n: 3, action: "teach", text: "Teach me this change.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "z", head: H, claims: [cl("x")],
      scenes: [{ n: 1, chapter: "what", title: "A percent helper", picture: "B1-1", points: [cl("It adds percent [diff:src/percent.ts].", [ok1("diff:src/percent.ts")]), cl("Rounded to the cent.")] },
        { n: 2, chapter: "change", title: "Rounding", picture: "B3-1", points: [cl("It rounds [diff:src/percent.ts:L2-3].", [ok1("diff:src/percent.ts:L2-3")]), cl("Halves go up.")] },
        { n: 3, chapter: "change", title: "Tests", picture: "B3-2", points: [cl("A test pins it [diff:test/percent.test.ts].", [ok1("diff:test/percent.test.ts")]), cl("At 1999.")] },
        { n: 4, chapter: "lifecycle", title: "An invoice", picture: "B3-3", points: [cl("Draft, priced, paid."), cl("Pricing rounds [diff:src/percent.ts:L2-3].", [ok1("diff:src/percent.ts:L2-3")])] },
        { n: 5, chapter: "sequence", title: "Pricing a line", picture: "B3-4", points: [cl("Each line once."), cl("Back to the cart.")] },
        { n: 6, chapter: "watch", title: "What to watch", picture: "B3-1", points: [cl("Halves round up [diff:src/percent.ts:L2-3].", [ok1("diff:src/percent.ts:L2-3")]), cl("The test pins it [diff:test/percent.test.ts].", [ok1("diff:test/percent.test.ts")])] }] };
    const FIGS = [{ id: "B3-1", turn: 3, type: "item", title: "Rounding", name: "percent()", before: "Fractions of a cent kept", after: "Rounded to the cent", mechanism: "Math.round", basis: "cited", cites: [ok1("diff:src/percent.ts:L2-3")] },
      { id: "B3-2", turn: 3, type: "item", title: "Tests", name: "percent.test.ts", before: "No test of rounding", after: "1999 at 15% pinned to 300", mechanism: "", basis: "cited", cites: [] },
      { id: "B3-3", turn: 3, type: "states", title: "An invoice", states: [{ id: "draft", label: "Draft" }, { id: "priced", label: "Priced" }, { id: "paid", label: "Paid" }], transitions: [{ from: "draft", to: "priced", label: "price", cite: ok1("diff:src/percent.ts:L2-3") }, { from: "priced", to: "paid", label: "pay", cite: null }, { from: "priced", to: "paid", label: "pay later", cite: ok1("diff:test/percent.test.ts") }], code: "flowchart LR\n  s_draft[Draft]\n  s_priced[Priced]\n  s_paid[Paid]\n  s_draft -->|price| s_priced\n  s_priced -->|pay| s_paid\n  s_priced -->|pay later| s_paid", basis: "cited", cites: [ok1("diff:src/percent.ts:L2-3")] },
      { id: "B3-4", turn: 3, type: "sequence", title: "Pricing a line", actors: ["Cart", "percent", "Math"], steps: [{ from: "Cart", to: "percent", label: "percent(1999, 15)", kind: "call" }, { from: "percent", to: "Math", label: "round(299.85)", kind: "call", frame: "loop", frameLabel: "each line" }, { from: "Math", to: "percent", label: "300", kind: "return", frame: "loop" }, { from: "percent", to: "Cart", label: "300", kind: "return" }], basis: "cited", cites: [] }];
    const RL = { ...ROOM, board: [...ROOM.board, ...FIGS], turns: [...ROOM.turns, LESSON] };
    const { ctx, p, cites } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 });
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: RL }));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 }); await p.waitForSelector("[data-toc]", { timeout: 3000 }).catch(() => {});
    // a finished lesson reads as a report; "Step through on the board" shows it scene by scene, as before
    await p.click('[data-toc-scene="t3"]').catch(() => {}); await p.click("[data-report-step]").catch(() => {});
    const toc = await p.evaluate(() => ({ items: [...document.querySelectorAll("[data-toc-scene]")].map((e) => [e.dataset.tocScene, e.querySelector("b")?.textContent ?? "", e.getAttribute("aria-current")]) }));
    const lesson = toc.items.filter((x) => /^t3/.test(x[0])).map((x) => x[1]);
    const heads = await p.$$eval("[data-toc-chapter]", (els) => els.map((e) => [e.dataset.tocChapter, e.textContent])), items = await p.$$eval("[data-toc-item]", (els) => els.map((e) => e.textContent));
    ok(JSON.stringify(lesson) === JSON.stringify(["What this is", "", "", "", "One request, in order", "What to watch"]) && JSON.stringify(heads) === JSON.stringify([["change", "The change itself"], ["lifecycle", "Its life, state by state"]]) && JSON.stringify(items) === JSON.stringify(["Rounding", "Tests", "An invoice"]) && toc.items.some((x) => x[0] === "t1") && toc.items.some((x) => x[0] === "t0"),
      "the chapters' rail lists every answer's scenes, the lesson chapter by chapter in order, a chapter of several items once with its items under it (every answer reachable from it)", JSON.stringify(toc));
    await p.click('[data-toc-scene="t3-2"]'); let s = await stage(p);
    const cur = await p.$eval('[data-toc-scene="t3-2"]', (e) => e.getAttribute("aria-current"));
    const fig = await p.evaluate(() => ({ fig: document.querySelector("[data-visual] [data-item-figure]")?.dataset.itemFigure, rows: [...document.querySelectorAll("[data-visual] .rr-ib-row")].map((e) => e.textContent), boxes: document.querySelectorAll("[data-visual] .rr-ib").length, kicker: document.querySelector(".rr-kicker")?.textContent }));
    ok(s.scene === "t3-2" && cur === "true" && fig.fig === "B3-1" && fig.boxes === 4 && JSON.stringify(fig.rows) === JSON.stringify(["Before", "After"]) && /The change itself/.test(fig.kicker), "a click jumps to its chapter, marked current; a changed item is its before → after card", JSON.stringify({ s, cur, fig }));
    await p.click('[data-toc-scene="t3-3"]');
    const geo = await p.evaluate(() => [...document.querySelectorAll("[data-visual] [data-item-figure] .rr-ib path")].map((e) => e.getAttribute("d")).join("|"));
    await p.click('[data-toc-scene="t3-2"]');
    const geo0 = await p.evaluate(() => [...document.querySelectorAll("[data-visual] [data-item-figure] .rr-ib path")].map((e) => e.getAttribute("d")).join("|"));
    ok(geo && geo === geo0, "every changed item is drawn from the same layout (identical geometry), not free-drawn");
    await p.click('[data-toc-scene="t3-4"]'); await p.click('[data-transition-cite="diff:src/percent.ts:L2-3"]'); await p.waitForSelector("[data-cite-panel]");
    ok(cites.at(-1) === "diff:src/percent.ts:L2-3" && await p.$$eval("[data-visual] [data-elabel]", (els) => els.length) === 3, "the state machine draws every transition, and a transition opens the code it rests on", JSON.stringify(cites));
    await p.click("[data-cite-panel] .btn");
    // two transitions between the same states: each label opens its own citation
    const second = await p.$$eval('[data-visual] [data-elabel="priced>paid"]', (els) => els.map((e) => [e.textContent, e.dataset.transitionCite ?? null]));
    await p.click('[data-transition-cite="diff:test/percent.test.ts"]', { timeout: 3000 }).catch(() => {}); await p.waitForSelector("[data-cite-panel]", { timeout: 3000 }).catch(() => {});
    ok(JSON.stringify(second) === JSON.stringify([["② pay", null], ["③ pay later", "diff:test/percent.test.ts"]]) && cites.at(-1) === "diff:test/percent.test.ts", "two transitions between the same states each open their own citation", JSON.stringify({ second, cites }));
    await p.click("[data-cite-panel] .btn"); await p.click('[data-toc-scene="t3-5"]');
    const sq = await p.evaluate(() => ({ actors: document.querySelectorAll("[data-visual] .rr-actor").length, steps: [...document.querySelectorAll("[data-visual] [data-step]")].map((e) => e.className.baseVal), frame: document.querySelector("[data-visual] [data-frame]")?.textContent }));
    ok(sq.actors === 3 && sq.steps.length === 4 && /return/.test(sq.steps[2]) && /loop \[each line\]/.test(sq.frame || ""), "one request in order: its actors, calls and returns, and its loop as a frame", JSON.stringify(sq));
    const lay = await p.evaluate(() => { const v = document.querySelector("[data-visual]").getBoundingClientRect(), t = document.querySelector("[data-toc]").getBoundingClientRect(); return { focus: document.body.dataset.focus ?? null, scroll: document.documentElement.scrollHeight - innerHeight, apart: t.right <= v.left + 1, inView: v.bottom <= innerHeight, railShown: t.width > 100 && t.height > 100 }; });
    ok(lay.focus === "room" && lay.railShown && lay.scroll <= 0 && lay.apart && lay.inView, "the rail sits beside the board: the page still never scrolls and the picture stays in view", JSON.stringify(lay));
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
    const ph = await p.evaluate(() => { const t = document.querySelector("[data-toc]").getBoundingClientRect(), v = document.querySelector("[data-visual]").getBoundingClientRect(); return { top: t.bottom <= v.top + 1, w: Math.round(t.width), scroll: document.documentElement.scrollWidth - innerWidth }; });
    ok(ph.top && ph.scroll <= 0, "on a phone the chapters are a strip above the board", JSON.stringify(ph));
    await ctx.close(); }

  // ---------- the lesson as a report (baton's packet): every section kind, its drawings, its citations, a phone, its languages ----------
  { // an invented lesson (a percent helper on an invented shop): the report's fixture
    const LESSON_OF = (lang, H, ok1, cl, n = 3) => { const zh = lang !== "en", T = (en, tw) => (zh ? tw : en), P = (en, tw, c = []) => cl(T(en, tw), c);
      const figs = [
        { id: `B${n}-1`, turn: n, type: "arch", title: T("Pricing a cart", "購物車計價"), nodes: [
            { id: "cart", label: T("Cart page", "購物車頁"), kind: "actor", mark: null }, { id: "pricing", label: T("Pricing service", "計價服務"), kind: "service", mark: "changed" },
            { id: "percent", label: "percent()", kind: "service", mark: "new" }, { id: "ledger", label: T("Invoice ledger", "發票帳本"), kind: "store", mark: null }, { id: "tax", label: T("Tax table API", "稅率表 API"), kind: "external", mark: null }],
          edges: [{ from: "cart", to: "pricing", label: "POST /price", cite: ok1("diff:src/pricing.ts:L10-14") }, { from: "pricing", to: "percent", label: T("each line", "每一行"), cite: ok1("diff:src/pricing.ts:L20-22") },
            { from: "pricing", to: "tax", label: T("rate lookup", "查稅率"), cite: null }, { from: "pricing", to: "ledger", label: T("writes total", "寫入總額"), cite: ok1("diff:src/ledger.ts:L5-9") }],
          cites: [ok1("diff:src/pricing.ts:L10-14")], inferred: true, basis: "cited" },
        { id: `B${n}-2`, turn: n, type: "decision", title: T("Half cents", "半分錢"), question: T("How does a half cent round?", "半分錢怎麼取整？"), chosen: T("Half up, away from zero", "四捨五入，遠離零"),
          because: T("The invoice rule in the spec says so", "規格裡的發票規則這樣寫"), rejected: [{ option: T("Banker's rounding", "銀行家捨入"), why: T("Dropped after the second review", "第二輪審查後拿掉"), cite: ok1("review:r12") }],
          cites: [ok1("diff:src/percent.ts:L2-3")], basis: "cited" },
        { id: `B${n}-3`, turn: n, type: "item", title: T("Rounding", "取整"), name: "percent()", before: T("Fractions of a cent kept", "保留分以下的零頭"), after: T("Rounded to the cent", "取整到整數分"), mechanism: "Math.round", basis: "cited", cites: [ok1("diff:src/percent.ts:L2-3")] },
        { id: `B${n}-4`, turn: n, type: "item", title: T("The ledger", "帳本"), name: "ledger.write()", before: T("Stored the raw total", "存原始總額"), after: T("Stores whole cents", "存整數分"), mechanism: "Number.isInteger", basis: "cited", cites: [ok1("diff:src/ledger.ts:L5-9")] },
        { id: `B${n}-5`, turn: n, type: "states", title: T("An invoice", "一張發票"), states: [{ id: "draft", label: T("Draft", "草稿") }, { id: "priced", label: T("Priced", "已計價") }, { id: "paid", label: T("Paid", "已付款") }, { id: "void", label: T("Void", "作廢") }],
          transitions: [{ from: "draft", to: "priced", label: T("price", "計價"), detail: "invoices.total ← percent(...) · WHERE status='draft'", cite: ok1("diff:src/pricing.ts:L20-22") },
            { from: "priced", to: "paid", label: T("pay", "付款"), detail: "invoices.status ← 'paid'", cite: ok1("diff:src/ledger.ts:L5-9") },
            { from: "priced", to: "void", label: T("cancel", "取消"), detail: "invoices.status ← 'void'", cite: null }, { from: "priced", to: "draft", label: T("edit", "修改"), detail: "invoices.total ← NULL", cite: null }, { from: "priced", to: "paid", label: T("pay later", "稍後付款"), detail: "invoices.due ← +30d", cite: null }, { from: "priced", to: "priced", label: T("reprice", "重新計價"), detail: "invoices.total ← percent(...)", cite: null }],
          code: "", basis: "cited", cites: [ok1("diff:src/pricing.ts:L20-22")] },
        { id: `B${n}-6`, turn: n, type: "sequence", title: T("One cart", "一台購物車"), actors: ["Cart", "Pricing", "percent", "Ledger"], steps: [
            { from: "Cart", to: "Pricing", label: "POST /price", kind: "call" }, { from: "Pricing", to: "percent", label: "percent(1999, 15)", kind: "call", frame: "loop", frameLabel: T("each line", "每一行") },
            { from: "percent", to: "Pricing", label: "300", kind: "return", frame: "loop" }, { from: "Pricing", to: "Ledger", label: T("write total", "寫入總額"), kind: "async" }, { from: "Pricing", to: "Cart", label: "200 {total}", kind: "return" }], basis: "cited", cites: [] }];
      const scenes = [
        { n: 1, chapter: "what", title: T("A percent helper for invoices", "給發票用的百分比工具"), picture: "", points: [P("It adds `percent()`, which rounds a share of an amount to whole cents [diff:src/percent.ts].", "新增 `percent()`：把金額的百分比取整到整數分 [diff:src/percent.ts]。", [ok1("diff:src/percent.ts")]), P("Pricing now calls it for every line, and the ledger stores whole cents [diff:src/ledger.ts:L5-9].", "計價每一行都改呼叫它，帳本只存整數分 [diff:src/ledger.ts:L5-9]。", [ok1("diff:src/ledger.ts:L5-9")])] },
        { n: 2, chapter: "talks", title: T("Pricing sits between the cart and the ledger", "計價夾在購物車和帳本之間"), picture: `B${n}-1`, points: [P("The cart posts to pricing [diff:src/pricing.ts:L10-14].", "購物車把請求送到計價 [diff:src/pricing.ts:L10-14]。", [ok1("diff:src/pricing.ts:L10-14")]), P("The tax table is outside this change.", "稅率表不在這次改動裡。")] },
        { n: 3, chapter: "decisions", title: T("Half up, not banker's", "四捨五入，不是銀行家捨入"), picture: `B${n}-2`, points: [P("Half cents round away from zero [diff:src/percent.ts:L2-3].", "半分錢遠離零取整 [diff:src/percent.ts:L2-3]。", [ok1("diff:src/percent.ts:L2-3")]), P("Banker's rounding was tried and dropped [review:r12].", "銀行家捨入試過後拿掉了 [review:r12]。", [ok1("review:r12")])] },
        { n: 4, chapter: "change", title: T("Rounding", "取整"), picture: `B${n}-3`, points: [P("It rounds with Math.round [diff:src/percent.ts:L2-3].", "用 Math.round 取整 [diff:src/percent.ts:L2-3]。", [ok1("diff:src/percent.ts:L2-3")]), P("Halves go up.", "0.5 往上進位。")] },
        { n: 5, chapter: "change", title: T("The ledger", "帳本"), picture: `B${n}-4`, points: [P("It refuses a fraction of a cent [diff:src/ledger.ts:L5-9].", "拒絕分以下的零頭 [diff:src/ledger.ts:L5-9]。", [ok1("diff:src/ledger.ts:L5-9")]), P("Older rows are left as they are.", "舊資料維持原樣。")] },
        { n: 6, chapter: "lifecycle", title: T("An invoice's states", "發票的狀態"), picture: `B${n}-5`, points: [P("Pricing writes the rounded total [diff:src/pricing.ts:L20-22].", "計價時寫入取整後的總額 [diff:src/pricing.ts:L20-22]。", [ok1("diff:src/pricing.ts:L20-22")]), P("Paying and voiding are unchanged.", "付款和作廢沒變。")] },
        { n: 7, chapter: "sequence", title: T("Pricing one cart", "計價一台購物車"), picture: `B${n}-6`, points: [P("Each line is rounded once.", "每一行只取整一次。"), P("The ledger write does not hold the reply [diff:src/pricing.ts:L30-34].", "寫帳本不會卡住回應 [diff:src/pricing.ts:L30-34]。", [ok1("diff:src/pricing.ts:L30-34")])] },
        { n: 8, chapter: "roads", title: T("Roads not taken", "沒走的路"), picture: "", points: [P("A decimal library was tried and reverted [commit:1a2b3c4].", "試過 decimal 套件後 revert 了 [commit:1a2b3c4]。", [ok1("commit:1a2b3c4")]), P("Banker's rounding was dropped in review [review:r12].", "銀行家捨入在審查中拿掉 [review:r12]。", [ok1("review:r12")])] },
        { n: 9, chapter: "watch", title: T("What to watch", "要注意的地方"), picture: "", points: [P("A total can move by one cent against the old one [diff:src/percent.ts:L2-3].", "總額可能和舊的差一分錢 [diff:src/percent.ts:L2-3]。", [ok1("diff:src/percent.ts:L2-3")]), P("Old ledger rows keep their fractions [diff:src/ledger.ts:L5-9].", "舊帳本資料保留零頭 [diff:src/ledger.ts:L5-9]。", [ok1("diff:src/ledger.ts:L5-9")])] },
        { n: 10, chapter: "questions", title: T("Open questions", "待解問題"), picture: "", points: [P("Should credit notes round the same way?", "折讓單也要這樣取整嗎？"), P("Not recorded here: whether this is deployed.", "這裡沒有紀錄：是否已部署。")] }];
      const turn = { n, action: "teach", text: T("Teach me this change.", "教我這個改動。"), lang, status: "done", provider: "codex", model: "gpt-6", cost: { usd: 0.12 }, answer: "z", head: H, claims: [cl("x")], scenes };
      return { figs, turn }; };
    const own = (it) => it.type === "arch" ? [...it.nodes.map((n) => n.label), ...it.edges.map((e) => e.label || "")] : it.type === "item" ? [it.name, it.before, it.after, it.mechanism || ""] : it.type === "decision" ? [it.question, it.chosen, it.because, ...it.rejected.flatMap((x) => [x.option, x.why])]
      : it.type === "states" ? [...it.states.map((x) => x.label), ...it.transitions.flatMap((t) => [t.label || "", t.detail || ""])] : it.type === "sequence" ? it.steps.flatMap((x) => [x.label, x.frameLabel || ""]) : null;
    const words = (it) => (own(it) ? [it.title || "", ...own(it)] : []);
    const EN = LESSON_OF("en", H, ok1, cl), ZH = LESSON_OF("zh-TW", H, ok1, cl);
    const TRZ = { scenes: ZH.turn.scenes.map((x) => ({ title: x.title, points: x.points.map((q) => q.text) })), claims: ["x"], answer: "z", figures: Object.fromEntries(ZH.figs.map((f) => [f.id, words(f)])), provider: "codex", model: "gpt-6", at: "t" };
    const RP = { ...ROOM, subject: { kind: "merge", repository: "example/shop" }, head: H, board: [...ROOM.board, ...EN.figs], turns: [...ROOM.turns, EN.turn], translations: { "zh-TW": { "3": TRZ } } };
    const { ctx, p, cites } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: RP }));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.click('[data-toc-scene="t3"]'); await p.waitForSelector("[data-report]", { timeout: 5000 }).catch(() => {});
    const rp = await p.evaluate(() => { const r = document.querySelector("[data-report]"); return r && { chapters: [...r.querySelectorAll("[data-report-section]")].map((x) => x.dataset.chapter), figures: [...r.querySelectorAll("[data-report-figure]")].map((x) => x.dataset.figureType),
      points: [...r.querySelectorAll("[data-points-chapter]")].map((x) => [x.dataset.pointsChapter, x.querySelectorAll("li").length]), lead: !!r.querySelector('[data-chapter="what"] .rp-prose p.lead'), title: r.querySelector(".rp-title")?.textContent, eyebrow: r.querySelector(".rp-eyebrow")?.textContent,
      scroll: document.documentElement.scrollHeight - innerHeight, own: r.scrollHeight > r.clientHeight, cites: r.querySelectorAll("[data-cite]").length, stage: !!document.querySelector("[data-visual]") }; });
    ok(rp && JSON.stringify(rp.chapters) === JSON.stringify(["what", "talks", "decisions", "change", "change", "lifecycle", "sequence", "roads", "watch", "questions"])
      && JSON.stringify(rp.figures) === JSON.stringify(["arch", "decision", "item", "item", "states", "sequence"]) && JSON.stringify(rp.points) === JSON.stringify([["roads", 2], ["watch", 2], ["questions", 2]]) && rp.lead && !rp.stage,
      "a finished lesson reads as a report: every section in order, prose for what it is, Studio's drawings (architecture, a decision, each changed item, the state map, the sequence) and the roads, risks and questions as points", JSON.stringify(rp));
    ok(rp && rp.scroll <= 0 && rp.own && /example\/shop/.test(rp.eyebrow) && rp.cites >= 10, "the report scrolls inside the room (the page never does); its eyebrow names the subject; its points keep Studio's citations", JSON.stringify(rp));
    // the rail jumps to a section and marks it; the state map: every transition numbered, each opens its own code and shows what it writes
    await p.click('[data-toc-scene="t3-6"]'); await p.waitForTimeout(400);
    const jump = await p.evaluate(() => { const r = document.querySelector("[data-report]"), sec = r.querySelector('[data-report-section="t3-6"]'); return { top: Math.round(sec.getBoundingClientRect().top - r.getBoundingClientRect().top), cur: document.querySelector('[data-toc-scene="t3-6"]').getAttribute("aria-current"), labels: [...sec.querySelectorAll("[data-elabel]")].map((e) => e.textContent), rows: sec.querySelectorAll("[data-transition]").length }; });
    ok(Math.abs(jump.top) < 40 && jump.cur === "true" && JSON.stringify(jump.labels) === JSON.stringify(["① price", "② pay", "③ cancel", "④ edit", "⑤ pay later", "⑥ reprice"]) && jump.rows === 6,
      "a chapter picked in the rail scrolls the report to it, marked current; the state map draws every transition, numbered, each a row of its own", JSON.stringify(jump));
    const geo2 = await p.evaluate(() => { const sec = document.querySelector('[data-report-section="t3-6"]'), arch = document.querySelector("[data-arch]");
      const rect = (e) => { const b = e.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, over = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      const clash = (root) => { const els = [...root.querySelectorAll("[data-elabel]")], ls = els.map(rect), ns = [...root.querySelectorAll("[data-node] .rr-box")].map(rect), out = [];
        ls.forEach((l, i) => { ns.forEach((n) => { if (over(l, n)) out.push(["box", i]); }); ls.forEach((m, j) => { if (j > i && over(l, m)) out.push(["label", i, j]); });
          for (const path of root.querySelectorAll("path.rr-edge")) { if (path.dataset.edgeN === els[i].dataset.edgeN) continue; const len = path.getTotalLength(); for (let k = 1; k < 24; k++) { const q = path.getPointAtLength((len * k) / 24); if (q.x > l.x + 2 && q.x < l.x + l.w - 2 && q.y > l.y + 2 && q.y < l.y + l.h - 2) { out.push(["line", i]); break; } } } }); return out; };
      const twins = [...sec.querySelectorAll('path.rr-edge[data-edge="priced>paid"]')].map((e) => e.getAttribute("d")), self = sec.querySelector('path.rr-edge[data-edge="priced>priced"]');
      return { twins, selfLen: self ? Math.round(self.getTotalLength()) : 0, states: clash(sec), arch: clash(arch) }; });
    ok(geo2.twins.length === 2 && geo2.twins[0] !== geo2.twins[1] && geo2.selfLen > 70 && !geo2.states.length && !geo2.arch.length,
      "two transitions the same way between two states are drawn apart, a state's way back to itself is a loop, and no chip sits on a box, another connector or another chip", JSON.stringify(geo2));
    await p.click('[data-transition-pick="1"]'); await p.waitForSelector("[data-cite-panel]", { timeout: 3000 }).catch(() => {});
    const t1 = { cite: cites.at(-1), on: await p.$eval('[data-transition="1"]', (e) => e.getAttribute("aria-current")).catch(() => null), detail: await p.$eval('[data-transition="1"] .rp-td', (e) => getComputedStyle(e).display !== "none" ? e.textContent : null).catch(() => null) };
    await p.click("[data-cite-panel] .btn").catch(() => {});
    ok(t1.cite === "diff:src/ledger.ts:L5-9" && t1.on === "true" && /invoices\.status/.test(t1.detail || ""), "a transition opens the code it rests on and shows what it writes", JSON.stringify(t1));
    // what talks to what: the change marked on its nodes, inferred said so, a connection opens what shows it
    await p.click('[data-toc-scene="t3-2"]'); await p.waitForTimeout(300); await p.click('[data-edge-cite="diff:src/pricing.ts:L10-14"]'); await p.waitForSelector("[data-cite-panel]", { timeout: 3000 }).catch(() => {});
    const ar = await p.evaluate(() => ({ marks: [...document.querySelectorAll("[data-arch] [data-mark]")].map((e) => e.dataset.mark), basis: document.querySelector("[data-arch-basis]")?.dataset.archBasis }));
    ok(cites.at(-1) === "diff:src/pricing.ts:L10-14" && JSON.stringify(ar.marks) === JSON.stringify(["changed", "new"]) && ar.basis === "inferred", "the architecture marks the change on its nodes, says it is inferred, and a connection opens its code", JSON.stringify({ ar, cite: cites.at(-1) }));
    await p.click("[data-cite-panel] .btn").catch(() => {});
    // every changed item from one layout; a decision's rejected option set apart
    const geo = await p.evaluate(() => [...document.querySelectorAll("[data-report-figure] [data-item-figure]")].map((f) => [...f.querySelectorAll(".rr-ib path")].map((e) => e.getAttribute("d")).join("|")));
    const dec = await p.evaluate(() => ({ boxes: document.querySelectorAll("[data-decision] .rr-ib").length, gone: document.querySelectorAll("[data-decision] .rr-ib.gone").length }));
    const rej = await p.evaluate(() => [...document.querySelectorAll("[data-rejected-option]")].map((e) => [e.textContent.slice(0, 20), e.querySelector("[data-cite]")?.dataset.cite ?? null]));
    ok(JSON.stringify(rej.map((x) => x[1])) === JSON.stringify(["review:r12"]), "a decision's turned-down option is listed with the record that shows it (its citation opens)", JSON.stringify(rej));
    ok(geo.length === 2 && geo[0] && geo[0] === geo[1] && dec.boxes === 3 && dec.gone === 1, "each changed item is drawn from the same layout; a decision shows the option taken and the one turned down, apart", JSON.stringify({ geo: geo.length, dec }));
    // step through it on the board, and back to the report
    await p.click("[data-report-step]"); await p.waitForSelector("[data-visual]", { timeout: 3000 }).catch(() => {});
    const stepped = await p.evaluate(() => ({ visual: !!document.querySelector("[data-visual]"), report: !!document.querySelector("[data-report]") }));
    await p.click("[data-report-back]").catch(() => {}); await p.waitForSelector("[data-report]", { timeout: 3000 }).catch(() => {});
    ok(stepped.visual && !stepped.report && !!(await p.$("[data-report]")), "the lesson can still be stepped through on the board, and read as a report again", JSON.stringify(stepped));
    // its languages: the translation kept for it covers the sections and the drawings' words; 简体 through OpenCC
    await p.click('[data-lang-pick="zh-TW"]'); await p.waitForTimeout(300);
    const zh = await p.evaluate(() => ({ title: document.querySelector('[data-report-section="t3"] [data-section-title]')?.textContent, node: [...document.querySelectorAll("[data-arch] text")].map((t) => t.textContent).join("|"), head: document.querySelector('[data-report-section="t3"] h3')?.textContent }));
    await p.click('[data-lang-pick="zh-CN"]'); await p.waitForTimeout(300);
    const cn = await p.evaluate(() => [...document.querySelectorAll("[data-arch] text")].map((t) => t.textContent).join("|"));
    ok(zh.title === "給發票用的百分比工具" && /計價服務/.test(zh.node) && /這是什麼/.test(zh.head || "") && /计价服务/.test(cn), "the report's text and its drawings' words switch language: 繁體 from the kept translation, 简体 from it through OpenCC", JSON.stringify({ zh, cn }));
    await p.click('[data-lang-pick="en"]');
    // a phone: the report reads top to bottom under the chapters' strip, nothing wider than the screen
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
    const ph = await p.evaluate(() => { const r = document.querySelector("[data-report]")?.getBoundingClientRect(), t = document.querySelector("[data-toc]")?.getBoundingClientRect(); return { report: !!r, under: r && t ? t.bottom <= r.top + 1 : false, wide: document.documentElement.scrollWidth - innerWidth, scroll: document.documentElement.scrollHeight - innerHeight }; });
    ok(ph.report && ph.under && ph.wide <= 0 && ph.scroll <= 0, "on a phone the report reads under the chapters' strip, never wider than the screen", JSON.stringify(ph));
    ok(!errs.length, "the report draws with no page error", errs.join(" | "));
    await ctx.close();
    // replayed from the Library: the same report, offline, read-only, no reviewer notes
    const SN = { schema: 1, kind: "review-room-snapshot", room: "SC-50", savedAt: "t", reason: "Saved by captain", subject: { kind: "merge", head: H, base: B }, tutors: [], cost: { usd: 0.12 }, view: { ...RP, open: false, offer: null, running: null, tutors: [], translate: null, closed: { en: "Saved", zh: "已存" } }, cites: {}, artifact: "room-sc-50", n: 1, versions: [{ n: 1, at: "t", summary: "Saved by captain" }] };
    const o2 = await open(1440, "en"); await o2.p.setViewportSize({ width: 1440, height: 900 }); const live = [];
    await o2.p.route(/\/api\/review-room\/library\/room-sc-50(\?v=\d+)?$/, (r) => r.fulfill({ json: SN })); o2.p.on("request", (q) => { if (/\/api\/review-room\/SC-50/.test(q.url())) live.push(q.url()); });
    await o2.p.goto(`${base}/#/room/lib:room-sc-50`); await o2.p.waitForSelector("[data-stage]", { timeout: 15000 }); await o2.p.click('[data-toc-scene="t3"]'); await o2.p.waitForSelector("[data-report]", { timeout: 3000 }).catch(() => {});
    const lib = await o2.p.evaluate(() => ({ secs: document.querySelectorAll("[data-report-section]").length, figs: document.querySelectorAll("[data-report-figure]").length, prompt: !!document.querySelector("[data-room-ask]"), notes: !!document.querySelector("[data-notes]") }));
    ok(lib.secs === 10 && lib.figs === 6 && !live.length && !lib.notes, "a room saved in the Library replays its lesson as the same report, offline (nothing read from the live room), no reviewer notes", JSON.stringify({ lib, live }));
    await o2.ctx.close(); }

  // ---------- a lesson made out of order reads in the chapters' order; pictures apply only with a confirmed round ----------
  { const scenesOut = [{ n: 1, chapter: "watch", title: "Risks", picture: "", points: [cl("Halves round up [diff:src/percent.ts:L2-3].", [ok1("diff:src/percent.ts:L2-3")]), cl("Pinned [diff:test/percent.test.ts].", [ok1("diff:test/percent.test.ts")])] },
      { n: 2, chapter: "change", title: "Rounding", picture: "B1-1", points: [cl("It rounds."), cl("Halves up.")] }, { n: 3, chapter: "what", title: "A percent helper", picture: "", points: [cl("It adds percent."), cl("To the cent.")] }];
    const RO = { ...ROOM, turns: [...ROOM.turns, { n: 3, action: "teach", text: "Teach me this change.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "z", head: H, claims: [cl("x")], scenes: scenesOut }] };
    const { ctx, p, posts } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); const imgs = [];
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: RO })); p.on("request", (q) => { if (/\/images$/.test(q.url())) imgs.push(q.url()); });
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 }); await p.click('[data-toc-scene="t3-3"]').catch(() => {}); await p.waitForSelector("[data-report]", { timeout: 3000 }).catch(() => {});
    const order = await p.$$eval("[data-report-section]", (els) => els.map((e) => e.dataset.chapter));
    ok(JSON.stringify(order) === JSON.stringify(["what", "change", "watch"]), "a lesson whose chapters came out of order reads in the chapters' order", JSON.stringify(order));
    await p.click('[data-room-action="how"]'); await p.waitForSelector("[data-room-confirm]");
    const copy = await p.textContent(".rr-imgopt"); await p.check("[data-images-toggle]"); await p.click("[data-room-cancel]");
    await p.click('[data-room-action="how"]'); await p.waitForSelector("[data-room-confirm]"); const after = await p.$eval("[data-images-toggle]", (e) => e.checked);
    await p.check("[data-images-toggle]"); await p.click("[data-room-start]"); await p.waitForTimeout(400);
    ok(/up to two a turn/.test(copy || "") && /an opening picture/.test(copy || "") && /only when you start this round/.test(copy || "") && after === false && !imgs.length && posts.at(-1)?.images === true,
      "the pictures tick box names every picture it may make, sends nothing on its own (cancel drops it) and goes with the confirmed round only", JSON.stringify({ copy, after, imgs, last: posts.at(-1) }));
    await ctx.close(); }

  // ---------- start this room over: confirmed first (what goes, what stays), cancel leaves it, then the welcome scene of a fresh room ----------
  { const { ctx, p } = await open(1440, "en"); await p.setViewportSize({ width: 1440, height: 900 }); const resets = []; let now = ROOM;
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: now }));
    await p.route(/\/api\/review-room\/SC-50\/reset$/, (r) => { resets.push(r.request().method()); now = { ...ROOM, turns: [], board: [], check: { questions: [] }, translations: {} }; r.fulfill({ json: { reset: true, moved: ["room"], view: now } }); });
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 }); await p.click('[data-toc-scene="t1"]').catch(() => {});
    await p.click("[data-transcript-toggle]"); await p.click("[data-room-reset]");
    const ask = await p.$eval("[data-reset-confirm-box]", (e) => e.textContent).catch(() => "");
    await p.click("[data-reset-cancel]", { timeout: 3000 }).catch(() => {}); const cancelled = { box: !!(await p.$("[data-reset-confirm-box]")), resets: resets.length };
    ok(/answers, its board, its translations and its generated pictures go/.test(ask) && /archive folder/.test(ask) && /goes if the Task is deleted/.test(ask) && /Library's saved snapshots and the Task's ledger stay/.test(ask) && !cancelled.box && cancelled.resets === 0,
      "starting a room over asks first, saying what goes (answers, board, translations, pictures: archived) and what stays (the Library's snapshots, the ledger); cancel changes nothing", JSON.stringify({ ask, cancelled }));
    await p.click("[data-room-reset]", { timeout: 3000 }).catch(() => {}); await p.click("[data-reset-confirm]", { timeout: 3000 }).catch(() => {}); await p.waitForFunction(() => document.querySelector("[data-stage]")?.dataset.scene === "t0", null, { timeout: 5000 }).catch(() => {});
    const after = await p.evaluate(() => ({ scene: document.querySelector("[data-stage]")?.dataset.scene, toc: document.querySelectorAll("[data-toc-scene]").length, box: !!document.querySelector("[data-reset-confirm-box]"), drawer: document.querySelector("[data-transcript]")?.dataset.open }));
    ok(JSON.stringify(resets) === '["POST"]' && after.scene === "t0" && !after.box && after.drawer === "false", "confirmed, the room is started over and the page forgets what it kept for it (its drawer closed) and opens it fresh on its welcome scene", JSON.stringify({ resets, after }));
    await ctx.close(); }

  // ---------- figures: a fictional payment change (two lifecycles of 7+ states and 12 transitions with ways back, a 7-node
  //            architecture, a 16-step sequence, every call, a figure the tutor drew): nothing crosses, nothing overlaps ----------
  {
    const PAY_OF = (lang, H, ok1, cl, n = 3) => { const zh = lang !== "en", T = (en, tw) => (zh ? tw : en), P = (en, tw, c = []) => cl(T(en, tw), c), C = (ref) => ok1(ref);
      const tx = (table, op, fields, guard = "", outside = []) => ({ tables: [{ table, op, guard, fields: fields.map(([k, was, now]) => ({ k, was, now })) }], outside: outside.map(([kind, what]) => ({ kind, what })) });
      const order = { id: `B${n}-3`, turn: n, type: "states", title: T("An order", "一張訂單"), entity: "orders.status",
        states: [["created", T("Created", "已建立")], ["awaiting", T("Awaiting payment", "等待付款")], ["authorized", T("Authorized", "已授權")], ["captured", T("Captured", "已扣款")], ["settled", T("Settled", "已結算")], ["refunded", T("Refunded", "已退款")], ["failed", T("Failed", "失敗")], ["cancelled", T("Cancelled", "已取消")]].map(([id, label]) => ({ id, label, ...(id === "authorized" ? { mark: "changed" } : {}) })),
        transitions: [
          { from: "created", to: "awaiting", label: T("checkout", "結帳"), cite: C("diff:src/orders.ts:L20-28"), tx: tx("orders", "UPDATE", [["status", "created", "awaiting"], ["expires_at", null, "now()+15m"]], "WHERE status='created'") },
          { from: "awaiting", to: "authorized", label: T("authorize", "授權"), cite: C("diff:src/pay.ts:L40-58"), tx: tx("orders", "UPDATE", [["status", "awaiting", "authorized"], ["auth_id", null, "psp id"]], "WHERE status='awaiting' AND version=:v", [["call", "PSP authorize, before the write"]]) },
          { from: "awaiting", to: "failed", label: T("declined", "被拒"), cite: C("diff:src/pay.ts:L60-66"), tx: tx("orders", "UPDATE", [["status", "awaiting", "failed"], ["reason", null, "psp code"]], "WHERE status='awaiting'") },
          { from: "awaiting", to: "cancelled", label: T("expire", "逾時"), cite: C("diff:src/sweeper.ts:L10-22"), tx: tx("orders", "UPDATE", [["status", "awaiting", "cancelled"]], "WHERE expires_at < now()") },
          { from: "failed", to: "awaiting", label: T("retry", "重試"), cite: C("diff:src/pay.ts:L70-80"), tx: tx("orders", "UPDATE", [["status", "failed", "awaiting"], ["attempts", "n", "n+1"]], "WHERE attempts < 3") },
          { from: "authorized", to: "captured", label: T("capture", "扣款"), cite: C("diff:src/pay.ts:L90-112"), tx: tx("orders", "UPDATE", [["status", "authorized", "captured"], ["captured_at", null, "now()"]], "WHERE status='authorized'", [["call", "PSP capture"], ["event", "order.captured"]]) },
          { from: "authorized", to: "cancelled", label: T("void", "撤銷"), cite: C("diff:src/pay.ts:L114-120"), tx: tx("orders", "UPDATE", [["status", "authorized", "cancelled"]], "WHERE status='authorized'", [["call", "PSP void"]]) },
          { from: "authorized", to: "awaiting", label: T("re-auth", "重新授權"), cite: C("diff:src/pay.ts:L122-130"), tx: tx("orders", "UPDATE", [["status", "authorized", "awaiting"], ["auth_id", "old", "NULL"]], "WHERE auth expired") },
          { from: "captured", to: "settled", label: T("settle", "結算"), cite: C("diff:src/settle.ts:L8-30"), tx: tx("orders", "UPDATE", [["status", "captured", "settled"]], "WHERE status='captured'", [["file", "settlement report row"]]) },
          { from: "captured", to: "refunded", label: T("refund", "退款"), cite: C("diff:src/refund.ts:L12-40"), tx: tx("refunds", "INSERT", [["order_id", null, ":id"], ["amount", null, ":amt"]], "UNIQUE(order_id)") },
          { from: "settled", to: "refunded", label: T("late refund", "結算後退款"), cite: C("diff:src/refund.ts:L42-60"), tx: tx("refunds", "INSERT", [["order_id", null, ":id"], ["late", null, "true"]], "UNIQUE(order_id)") },
          { from: "created", to: "cancelled", label: T("abandon", "放棄"), cite: C("diff:src/orders.ts:L30-36"), tx: tx("orders", "UPDATE", [["status", "created", "cancelled"]], "WHERE status='created'") }],
        basis: "cited", cites: [C("diff:src/pay.ts:L40-58")] };
      const auth = { id: `B${n}-4`, turn: n, type: "states", title: T("A card authorization", "一筆卡片授權"), entity: "authorizations.state",
        states: [["requested", T("Requested", "已請求")], ["pending", T("Pending 3-DS", "等 3-DS")], ["approved", T("Approved", "核准")], ["declined", T("Declined", "拒絕")], ["captured", T("Captured", "已扣款")], ["voided", T("Voided", "已撤銷")], ["expired", T("Expired", "已過期")]].map(([id, label]) => ({ id, label })),
        transitions: [
          { from: "requested", to: "pending", label: T("challenge", "驗證"), cite: C("diff:src/auth.ts:L10-20"), tx: tx("authorizations", "INSERT", [["state", null, "pending"]], "UNIQUE(order_id, attempt)") },
          { from: "requested", to: "approved", label: T("frictionless", "免驗證"), cite: C("diff:src/auth.ts:L22-30"), tx: tx("authorizations", "INSERT", [["state", null, "approved"]], "UNIQUE(order_id, attempt)") },
          { from: "requested", to: "declined", label: T("decline", "拒絕"), cite: C("diff:src/auth.ts:L32-38"), tx: tx("authorizations", "INSERT", [["state", null, "declined"]], "UNIQUE(order_id, attempt)") },
          { from: "pending", to: "approved", label: T("3-DS ok", "驗證通過"), cite: C("diff:src/auth.ts:L40-52"), tx: tx("authorizations", "UPDATE", [["state", "pending", "approved"]], "WHERE state='pending'") },
          { from: "pending", to: "declined", label: T("3-DS fail", "驗證失敗"), cite: C("diff:src/auth.ts:L54-60"), tx: tx("authorizations", "UPDATE", [["state", "pending", "declined"]], "WHERE state='pending'") },
          { from: "pending", to: "requested", label: T("resend", "重送"), cite: C("diff:src/auth.ts:L62-70"), tx: tx("authorizations", "UPDATE", [["state", "pending", "requested"], ["tries", "n", "n+1"]], "WHERE tries < 2") },
          { from: "approved", to: "captured", label: T("capture", "扣款"), cite: C("diff:src/pay.ts:L90-112"), tx: tx("authorizations", "UPDATE", [["state", "approved", "captured"]], "WHERE state='approved'", [["call", "PSP capture"]]) },
          { from: "approved", to: "voided", label: T("void", "撤銷"), cite: C("diff:src/pay.ts:L114-120"), tx: tx("authorizations", "UPDATE", [["state", "approved", "voided"]], "WHERE state='approved'") },
          { from: "approved", to: "expired", label: T("7 days", "七天"), cite: C("diff:src/sweeper.ts:L24-36"), tx: tx("authorizations", "UPDATE", [["state", "approved", "expired"]], "WHERE created_at < now()-7d") },
          { from: "declined", to: "requested", label: T("new card", "換卡"), cite: C("diff:src/auth.ts:L72-80"), tx: tx("authorizations", "INSERT", [["attempt", "n", "n+1"]], "UNIQUE(order_id, attempt)") },
          { from: "expired", to: "requested", label: T("re-auth", "重新授權"), cite: C("diff:src/pay.ts:L122-130"), tx: tx("authorizations", "INSERT", [["attempt", "n", "n+1"]], "UNIQUE(order_id, attempt)") },
          { from: "captured", to: "voided", label: T("reversal", "沖正"), cite: C("diff:src/refund.ts:L62-70"), tx: tx("authorizations", "UPDATE", [["state", "captured", "voided"]], "WHERE same day", [["call", "PSP reversal"]]) }],
        basis: "cited", cites: [C("diff:src/auth.ts:L10-20")] };
      const arch = { id: `B${n}-1`, turn: n, type: "arch", title: T("Paying for an order", "替一張訂單付款"), inferred: true, basis: "cited",
        nodes: [{ id: "app", label: T("Shopper app", "購物 App"), kind: "actor", mark: null }, { id: "api", label: T("Payments API", "付款 API"), kind: "service", mark: "changed" }, { id: "orders", label: T("Order service", "訂單服務"), kind: "service", mark: null },
          { id: "worker", label: T("Webhook worker", "Webhook 工作者"), kind: "service", mark: "new" }, { id: "db", label: "Postgres", kind: "store", mark: null }, { id: "psp", label: T("Card gateway", "收單閘道"), kind: "external", mark: null }, { id: "queue", label: T("Event queue", "事件佇列"), kind: "queue", mark: null }],
        edges: [{ from: "app", to: "api", label: "POST /pay", cite: C("diff:src/pay.ts:L40-58") }, { from: "api", to: "orders", label: T("load order", "讀訂單"), cite: null }, { from: "api", to: "psp", label: "authorize", cite: C("diff:src/pay.ts:L40-58") },
          { from: "orders", to: "db", label: T("CAS write", "CAS 寫入"), cite: C("diff:src/orders.ts:L20-28") }, { from: "psp", to: "worker", label: "webhook", cite: C("diff:src/webhook.ts:L5-30") }, { from: "worker", to: "db", label: T("settle", "結算"), cite: null },
          { from: "worker", to: "queue", label: "order.captured", cite: null }, { from: "api", to: "db", label: T("idempotency key", "冪等鍵"), cite: C("diff:src/pay.ts:L30-38") }], cites: [C("diff:src/pay.ts:L40-58")] };
      const seq = { id: `B${n}-5`, turn: n, type: "sequence", title: T("Paying, in order", "付款的順序"), actors: ["App", "API", "DB", "PSP", "Worker"], basis: "cited", cites: [],
        steps: [["App", "API", "POST /pay", "call"], ["API", "DB", T("lock idempotency key", "鎖冪等鍵"), "call"], ["DB", "API", T("new key", "新鍵"), "return"], ["API", "PSP", "authorize", "call", "alt", T("frictionless", "免驗證")], ["PSP", "API", "approved", "return", "alt"],
          ["API", "PSP", "authorize", "call", "else", T("3-DS", "3-DS")], ["PSP", "API", T("challenge", "驗證"), "return", "else"], ["API", "DB", T("CAS awaiting→authorized", "CAS 改為已授權"), "call"], ["DB", "API", "1 row", "return"], ["API", "App", "202 {order}", "return"],
          ["App", "API", "GET /orders/:id", "call", "loop", T("every 2s", "每 2 秒")], ["API", "App", T("status", "狀態"), "return", "loop"], ["PSP", "Worker", "webhook capture", "async"], ["Worker", "DB", T("CAS authorized→captured", "CAS 改為已扣款"), "call"], ["DB", "Worker", "1 row", "return"], ["Worker", "PSP", "200", "return"]]
          .map(([from, to, label, kind, frame, frameLabel]) => ({ from, to, label, kind, ...(frame ? { frame, frameLabel: frameLabel || "" } : {}) })) };
      const calls = { id: `B${n}-6`, turn: n, type: "calls", title: T("Every call", "每個呼叫"), basis: "cited", cites: [],
        calls: [{ name: "/orders/:id/pay", method: "POST", request: [{ k: "idempotency_key", v: "uuid" }, { k: "card_token", v: "tok_…" }], response: [{ k: "status", v: "202" }, { k: "order.status", v: "authorized | awaiting" }], errors: [{ code: "409", when: T("same key, other body", "同一個鍵、不同內容") }, { code: "402", when: T("declined", "被拒") }], tx: tx("orders", "UPDATE", [["status", "awaiting", "authorized"]], "WHERE version=:v", [["call", "PSP authorize"]]), cite: C("diff:src/pay.ts:L40-58") },
          { name: "/orders/:id", method: "GET", request: [{ k: "id", v: "ord_…" }], response: [{ k: "status", v: "awaiting | authorized | captured" }], errors: [{ code: "404", when: T("not yours", "不是你的") }], tx: null, cite: C("diff:src/orders.ts:L40-50") },
          { name: "/webhooks/psp", method: "POST", request: [{ k: "event", v: "capture.succeeded" }, { k: "signature", v: "hmac" }], response: [{ k: "status", v: "200" }], errors: [{ code: "401", when: T("bad signature", "簽章不對") }], tx: tx("orders", "UPDATE", [["status", "authorized", "captured"]], "WHERE status='authorized'", [["event", "order.captured"]]), cite: C("diff:src/webhook.ts:L5-30") }] };
      const t = (x, y, en, tw, cls = "", fs = 13, anchor = "middle") => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${fs}" fill="var(--fig-${cls || "ink"})" data-en="${en}" data-hant="${tw}" data-hans="${tw}">${en}</text>`;
      const svgDecision = { id: `B${n}-2`, turn: n, type: "svg", kind: "decision", title: T("Who decides the state", "誰決定狀態"), basis: "cited", cites: [C("diff:src/orders.ts:L20-28")], transitions: [], nodes: ["q", "cas", "lock"], edges: ["q>cas", "q>lock"],
        tree: null, svg: `<svg viewBox="0 0 640 248" role="img"><defs><marker id="ar" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="var(--fig-muted)"/></marker></defs>
    <path d="M240,76 V112 Q240,120 232,120 H168 Q160,120 160,128 V152" fill="none" stroke="var(--fig-accent)" stroke-width="1.5" marker-end="url(#ar)" data-edge="q>cas"/>
    <path d="M400,76 V112 Q400,120 408,120 H472 Q480,120 480,128 V152" fill="none" stroke="var(--fig-muted)" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#ar)" data-edge="q>lock"/>
    <rect x="160" y="20" width="320" height="56" rx="8" fill="var(--fig-card)" stroke="var(--fig-ink)" data-node="q"/>${t(320, 53, "Two writers race: who wins?", "兩個寫入同時到：誰贏？")}
    <rect x="40" y="156" width="240" height="64" rx="8" fill="var(--fig-accent-tint)" stroke="var(--fig-accent)" stroke-width="1.6" data-node="cas"/>${t(160, 184, "CAS on version (taken)", "用 version 做 CAS（採用）", "accent")}${t(160, 206, "WHERE version = :v", "WHERE version = :v", "muted", 12)}
    <rect x="360" y="156" width="240" height="64" rx="8" fill="var(--fig-card-2)" stroke="var(--fig-soft)" stroke-dasharray="5,4" data-node="lock"/>${t(480, 184, "Row lock (turned down)", "鎖整列（未採用）", "muted")}${t(480, 206, "held across the PSP call", "鎖跨過收單呼叫", "soft", 12)}
    </svg>` };
      const scenes = [
        { n: 1, chapter: "what", title: T("Card payments for orders", "訂單的刷卡付款"), picture: "", points: [P("Orders now take card payments through a gateway [diff:src/pay.ts:L40-58].", "訂單現在經由收單閘道刷卡 [diff:src/pay.ts:L40-58]。", [C("diff:src/pay.ts:L40-58")]), P("Two state machines move together: the order and its authorization.", "兩個狀態機一起走：訂單和它的授權。")] },
        { n: 2, chapter: "talks", title: T("The API in the middle", "API 在中間"), picture: arch.id, points: [P("The API writes the order only after the gateway answers [diff:src/pay.ts:L40-58].", "API 等閘道回覆後才寫訂單 [diff:src/pay.ts:L40-58]。", [C("diff:src/pay.ts:L40-58")]), P("A new worker takes the gateway's webhooks [diff:src/webhook.ts:L5-30].", "新的工作者接收閘道的 webhook [diff:src/webhook.ts:L5-30]。", [C("diff:src/webhook.ts:L5-30")])] },
        { n: 3, chapter: "decisions", title: T("CAS, not a row lock", "CAS，不鎖整列"), picture: svgDecision.id, points: [P("Each write checks the version it read [diff:src/orders.ts:L20-28].", "每次寫入都檢查讀到的 version [diff:src/orders.ts:L20-28]。", [C("diff:src/orders.ts:L20-28")]), P("No lock is held across the gateway call.", "呼叫閘道時不持有鎖。")] },
        { n: 4, chapter: "lifecycle", title: T("The order", "訂單"), picture: order.id, points: [P("Every edge is one guarded UPDATE [diff:src/orders.ts:L20-28].", "每條邊都是一個有條件的 UPDATE [diff:src/orders.ts:L20-28]。", [C("diff:src/orders.ts:L20-28")]), P("A failed payment may retry three times [diff:src/pay.ts:L70-80].", "失敗的付款最多重試三次 [diff:src/pay.ts:L70-80]。", [C("diff:src/pay.ts:L70-80")])] },
        { n: 5, chapter: "lifecycle", title: T("The authorization", "授權"), picture: auth.id, points: [P("Each attempt is its own row [diff:src/auth.ts:L10-20].", "每次嘗試是一列 [diff:src/auth.ts:L10-20]。", [C("diff:src/auth.ts:L10-20")]), P("An approval expires after seven days [diff:src/sweeper.ts:L24-36].", "核准七天後過期 [diff:src/sweeper.ts:L24-36]。", [C("diff:src/sweeper.ts:L24-36")])] },
        { n: 6, chapter: "sequence", title: T("One payment", "一次付款"), picture: seq.id, points: [P("The app polls while the webhook captures.", "App 輪詢，webhook 負責扣款。"), P("The capture is never in the request [diff:src/webhook.ts:L5-30].", "扣款從不在請求裡發生 [diff:src/webhook.ts:L5-30]。", [C("diff:src/webhook.ts:L5-30")])] },
        { n: 7, chapter: "calls", title: T("Three calls", "三個呼叫"), picture: calls.id, points: [P("A replayed key returns the first answer [diff:src/pay.ts:L30-38].", "重送同一個鍵會拿到第一次的回覆 [diff:src/pay.ts:L30-38]。", [C("diff:src/pay.ts:L30-38")]), P("The webhook checks its signature first [diff:src/webhook.ts:L5-30].", "webhook 先檢查簽章 [diff:src/webhook.ts:L5-30]。", [C("diff:src/webhook.ts:L5-30")])] },
        { n: 8, chapter: "watch", title: T("What to watch", "要注意的地方"), picture: "", points: [P("A webhook before the CAS lands is retried by the gateway [diff:src/webhook.ts:L5-30].", "webhook 若比 CAS 早到，閘道會重送 [diff:src/webhook.ts:L5-30]。", [C("diff:src/webhook.ts:L5-30")]), P("Refunds after settlement reach the report a day late [diff:src/refund.ts:L42-60].", "結算後的退款晚一天進報表 [diff:src/refund.ts:L42-60]。", [C("diff:src/refund.ts:L42-60")])] }];
      const turn = { n, action: "teach", text: T("Teach me this change.", "教我這個改動。"), lang, status: "done", provider: "codex", model: "gpt-6", cost: { usd: 0.21 }, answer: "z", head: H, claims: [cl("x")], scenes };
      return { figs: [arch, svgDecision, order, auth, seq, calls], turn };
    };
    const FIG_TREE = {"t": "svg", "a": {"viewBox": "0 0 640 248", "role": "img"}, "c": [{"t": "defs", "a": {}, "c": [{"t": "marker", "a": {"id": "ar", "markerWidth": "8", "markerHeight": "6", "refX": "7", "refY": "3", "orient": "auto"}, "c": [{"t": "polygon", "a": {"points": "0 0, 8 3, 0 6", "fill": "var(--fig-muted)"}, "c": []}]}]}, {"t": "path", "a": {"d": "M240,76 V112 Q240,120 232,120 H168 Q160,120 160,128 V152", "fill": "none", "stroke": "var(--fig-accent)", "stroke-width": "1.5", "marker-end": "url(#ar)", "data-edge": "q>cas"}, "c": []}, {"t": "path", "a": {"d": "M400,76 V112 Q400,120 408,120 H472 Q480,120 480,128 V152", "fill": "none", "stroke": "var(--fig-muted)", "stroke-width": "1.2", "stroke-dasharray": "5,4", "marker-end": "url(#ar)", "data-edge": "q>lock"}, "c": []}, {"t": "rect", "a": {"x": "160", "y": "20", "width": "320", "height": "56", "rx": "8", "fill": "var(--fig-card)", "stroke": "var(--fig-ink)", "data-node": "q"}, "c": []}, {"t": "text", "a": {"x": "320", "y": "53", "text-anchor": "middle", "font-size": "13", "fill": "var(--fig-ink)", "data-en": "Two writers race: who wins?", "data-hant": "兩個寫入同時到：誰贏？", "data-hans": "兩個寫入同時到：誰贏？"}, "c": ["Two writers race: who wins?"]}, {"t": "rect", "a": {"x": "40", "y": "156", "width": "240", "height": "64", "rx": "8", "fill": "var(--fig-accent-tint)", "stroke": "var(--fig-accent)", "stroke-width": "1.6", "data-node": "cas"}, "c": []}, {"t": "text", "a": {"x": "160", "y": "184", "text-anchor": "middle", "font-size": "13", "fill": "var(--fig-accent)", "data-en": "CAS on version (taken)", "data-hant": "用 version 做 CAS（採用）", "data-hans": "用 version 做 CAS（採用）"}, "c": ["CAS on version (taken)"]}, {"t": "text", "a": {"x": "160", "y": "206", "text-anchor": "middle", "font-size": "12", "fill": "var(--fig-muted)", "data-en": "WHERE version = :v", "data-hant": "WHERE version = :v", "data-hans": "WHERE version = :v"}, "c": ["WHERE version = :v"]}, {"t": "rect", "a": {"x": "360", "y": "156", "width": "240", "height": "64", "rx": "8", "fill": "var(--fig-card-2)", "stroke": "var(--fig-soft)", "stroke-dasharray": "5,4", "data-node": "lock"}, "c": []}, {"t": "text", "a": {"x": "480", "y": "184", "text-anchor": "middle", "font-size": "13", "fill": "var(--fig-muted)", "data-en": "Row lock (turned down)", "data-hant": "鎖整列（未採用）", "data-hans": "鎖整列（未採用）"}, "c": ["Row lock (turned down)"]}, {"t": "text", "a": {"x": "480", "y": "206", "text-anchor": "middle", "font-size": "12", "fill": "var(--fig-soft)", "data-en": "held across the PSP call", "data-hant": "鎖跨過收單呼叫", "data-hans": "鎖跨過收單呼叫"}, "c": ["held across the PSP call"]}]};
    // the figure as a tampered room.json could carry it: what Studio's server would have dropped, sent anyway; and a label of two lines
    const BAD = "https://x.example", TAMPER = { ...FIG_TREE, a: { ...FIG_TREE.a, onload: "window.__pwn=1", style: `background:url(${BAD}/a)` }, c: [...FIG_TREE.c,
      { t: "script", a: {}, c: ["window.__pwn=1"] }, { t: "foreignObject", a: { width: "10", height: "10" }, c: [{ t: "div", a: {}, c: ["x"] }] }, { t: "a", a: { href: "javascript:window.__pwn=1" }, c: [{ t: "text", a: { x: "5", y: "5" }, c: ["click"] }] },
      { t: "image", a: { href: `${BAD}/i.png` }, c: [] }, { t: "use", a: { href: "#ar" }, c: [] }, { t: "style", a: {}, c: ["*{fill:red}"] },
      { t: "rect", a: { x: "1", y: "1", width: "2", height: "2", onclick: "window.__pwn=1", onmouseover: "window.__pwn=1", href: BAD, "xlink:href": BAD, style: `fill:url(${BAD}/p)`, fill: `url(${BAD}/p)`, stroke: "javascript:x", "marker-end": `url(${BAD}/m#a)`, class: "x", filter: `url(${BAD}/f)` }, c: [] },
      { t: "text", a: { x: "320", y: "232", "text-anchor": "middle", "font-size": "12", fill: "var(--fig-ink)", "data-en": "Line one Line two", "data-hant": "第一行第二行", "data-hans": "第一行第二行" }, c: [{ t: "tspan", a: { x: "320", dy: "0", "data-en": "Line one", "data-hant": "第一行", "data-hans": "第一行" }, c: ["Line one"] }, { t: "tspan", a: { x: "320", dy: "14", "data-en": "Line two", "data-hant": "第二行", "data-hans": "第二行" }, c: ["Line two"] }] }] };
    const ZP = PAY_OF("zh-TW", H, ok1, cl); ZP.figs.find((f) => f.type === "svg").tree = TAMPER; ZP.turn.auto = true;
    const RF = { ...ROOM, subject: { kind: "pr", repository: "example/lumen-pay" }, autoTeach: { on: true, room: null, global: true, skipped: null }, head: H, board: [...ROOM.board, ...ZP.figs], turns: [...ROOM.turns.map((t) => ({ ...t, lang: "zh-TW" })), ZP.turn] };
    const { ctx, p } = await open(1440, "zh-TW"); await p.setViewportSize({ width: 1440, height: 1000 }); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: RF }));
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 }); await p.click('[data-toc-scene="t3"]'); await p.waitForSelector("[data-report]", { timeout: 5000 }).catch(() => {});
    // the gate the page itself can run: every label clear of boxes, lines and other labels; no connector through a box not its end
    const geo = await p.evaluate(() => [...document.querySelectorAll("[data-report] svg.rr-ortho")].map((svg) => {
      const r = (e) => { const b = e.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, over = (a, b, i = 1) => a.x + i < b.x + b.w - i && a.x + a.w - i > b.x + i && a.y + i < b.y + b.h - i && a.y + a.h - i > b.y + i;
      const labels = [...svg.querySelectorAll("[data-elabel]")].map((e) => ({ t: e.textContent, n: e.dataset.edgeN, b: r(e), deco: getComputedStyle(e.querySelector("text")).textDecorationLine })), nodes = [...svg.querySelectorAll("[data-node]")].map((g) => ({ id: g.getAttribute("data-node"), b: r(g.querySelector(".rr-box")) }));
      const edges = [...svg.querySelectorAll("path.rr-edge")].map((e) => { const L = e.getTotalLength(), pts = []; for (let k = 0; k <= 120; k++) { const q = e.getPointAtLength((L * k) / 120); pts.push([q.x, q.y]); } return { n: e.dataset.edgeN, ends: e.getAttribute("data-edge").split(">"), pts, L }; });
      const near = (p, pts, d) => pts.some((q, k) => k && (() => { const [ax, ay] = pts[k - 1], [bx, by] = q, dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l)) : 0; return Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy) < d; })());
      const inNode = ([x, y], pad) => nodes.some((n) => x > n.b.x - pad && x < n.b.x + n.b.w + pad && y > n.b.y - pad && y < n.b.y + n.b.h + pad);
      const bad = [];
      labels.forEach((l, i) => { labels.forEach((m, j) => { if (j > i && over(l.b, m.b)) bad.push(`chip ${l.t} on chip ${m.t}`); }); nodes.forEach((n) => { if (over(l.b, n.b, 0)) bad.push(`chip ${l.t} on box ${n.id}`); });
        edges.forEach((e) => { if (e.n !== l.n && e.pts.some(([x, y]) => x > l.b.x + 1.5 && x < l.b.x + l.b.w - 1.5 && y > l.b.y + 1.5 && y < l.b.y + l.b.h - 1.5)) bad.push(`chip ${l.t} on another connector`); });
        // on its own connector, near its middle
        const own = edges.find((e) => e.n === l.n), c = [l.b.x + l.b.w / 2, l.b.y + l.b.h / 2], k = own ? own.pts.reduce((best, p, j) => (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(own.pts[best][0] - c[0], own.pts[best][1] - c[1]) ? j : best), 0) : -1;
        if (!own || Math.hypot(own.pts[k][0] - c[0], own.pts[k][1] - c[1]) > 3 || k < 120 * 0.15 || k > 120 * 0.85) bad.push(`chip ${l.t} off its connector's middle`);
        if (/_/.test(l.t) || (l.deco && l.deco !== "none")) bad.push(`chip ${l.t} underlined or with an underscore`); });
      edges.forEach((e) => nodes.forEach((n) => { if (!e.ends.includes(n.id) && e.pts.some(([x, y]) => x > n.b.x + 3 && x < n.b.x + n.b.w - 3 && y > n.b.y + 3 && y < n.b.y + n.b.h - 3)) bad.push(`${e.ends.join(">")} through ${n.id}`); }));
      // no two connectors share a stretch: never more than 12px of one within 2px of another (away from the boxes they meet at)
      edges.forEach((e, i) => edges.forEach((f, j) => { if (j <= i) return; let run = 0, best = 0; const step = e.L / 120;
        for (const p of e.pts) { if (inNode(p, 10)) { run = 0; continue; } if (near(p, f.pts, 2)) { run += step; best = Math.max(best, run); } else run = 0; }
        if (best > 12) bad.push(`${e.ends.join(">")} runs along ${f.ends.join(">")} for ${Math.round(best)}px`); }));
      // crossings: two connectors meeting anywhere but at a box they share
      const X = (p, q, r, t) => { const d = (q[0] - p[0]) * (t[1] - r[1]) - (q[1] - p[1]) * (t[0] - r[0]); if (!d) return null; const u = ((r[0] - p[0]) * (t[1] - r[1]) - (r[1] - p[1]) * (t[0] - r[0])) / d, v = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1])] : null; };
      const crossed = [];
      edges.forEach((e, i) => edges.forEach((f, j) => { if (j <= i) return; const shared = e.ends.filter((id) => f.ends.includes(id)).map((id) => nodes.find((n) => n.id === id)?.b).filter(Boolean); let n = 0;
        for (let a = 1; a < e.pts.length; a++) for (let b = 1; b < f.pts.length; b++) { const x = X(e.pts[a - 1], e.pts[a], f.pts[b - 1], f.pts[b]); if (x && !shared.some((sb) => x[0] > sb.x - 14 && x[0] < sb.x + sb.w + 14 && x[1] > sb.y - 14 && x[1] < sb.y + sb.h + 14)) n++; }
        if (n) crossed.push(`${e.ends.join(">")} × ${f.ends.join(">")}`); }));
      // along one row (a lifecycle's main row): a connector is the straight step or an arc above the row, never below it
      if (svg.closest("[data-statemap]")) edges.forEach((e) => { const [a, b] = e.ends.map((id) => nodes.find((n) => n.id === id)?.b); if (!a || !b || e.ends[0] === e.ends[1]) return;
        const cy = a.y + a.h / 2; if (Math.abs(b.y + b.h / 2 - cy) > 1) return; if (e.pts.every(([, y]) => Math.abs(y - cy) < 2)) return;
        if (e.pts.some(([, y]) => y > Math.min(a.y, b.y) + 2)) bad.push(`${e.ends.join(">")} leaves its row below or through the boxes, not as an arc above`); });
      return { nodes: nodes.length, edges: edges.length, labels: labels.length, bad, crossed }; }));
    ok(geo.length === 3 && geo.map((g) => g.nodes).join() === "7,8,7" && geo.map((g) => g.edges).join() === "8,12,12" && geo.every((g) => !g.bad.length) && !geo[0].crossed.length && !geo[1].crossed.length && geo[2].crossed.length <= 1,
      "Studio's drawings read: the architecture and both lifecycles with each chip on its own connector near its middle (never on a box, another connector or chip, never underlined), no connector through a box that is not one of its ends, no two sharing a stretch, ways back along a lifecycle's row as arcs above it, no crossing (one at most in the authorization's)", JSON.stringify(geo.map((g) => [g.nodes, g.edges, g.bad.slice(0, 6), g.crossed])));
    const colours = await p.evaluate(() => { const sv = document.querySelectorAll("[data-report] svg.rr-ortho"), fill = (sel) => { const e = sv[0].querySelector(sel); return e ? getComputedStyle(e).stroke : null; };
      return { changed: fill('[data-node="api"] .rr-box'), plain: fill('[data-node="orders"] .rr-box'), added: fill('[data-node="worker"] .rr-box'), back: sv[1] ? getComputedStyle(sv[1].querySelector("path.rr-edge.back")).stroke : null, edge: sv[1] ? getComputedStyle(sv[1].querySelector("path.rr-edge.next")).stroke : null }; });
    ok(colours.changed && colours.changed !== colours.plain && colours.added !== colours.plain && colours.added !== colours.changed && colours.back !== colours.edge, "the point stands out by colour: the changed component, the new one and the ways back each in their own", JSON.stringify(colours));
    // a lifecycle per entity; a state picked shows the transaction that brings the entity into it, what it writes outside set apart
    const lifecycles = await p.$$eval('[data-report-section] [data-statemap]', (els) => els.map((e) => e.querySelector(".rp-entity")?.textContent));
    await p.click('[data-toc-scene="t3-4"]'); await p.waitForTimeout(300); await p.click('[data-statemap] [data-state-pick="authorized"]'); await p.waitForTimeout(300);
    const tx = await p.evaluate(() => { const sm = [...document.querySelectorAll("[data-statemap]")].find((e) => e.querySelector('[data-state-pick="authorized"]')), on = sm?.querySelector('[data-transition][aria-current="true"]'), panel = sm?.querySelector("[data-tx-panel]"), chip = sm?.querySelector("[data-elabel].on");
      return on && panel && { row: on.getAttribute("data-transition"), panel: panel.getAttribute("data-tx-panel"), chip: chip?.dataset.edgeN, under: panel.previousElementSibling?.classList.contains("rp-legend"), table: panel.querySelector("[data-tx-table]")?.getAttribute("data-tx-table"), op: panel.querySelector(".rp-op")?.textContent, outside: panel.querySelector("[data-tx-outside]")?.textContent }; });
    ok(lifecycles.length === 2 && /orders\.status/.test(lifecycles[0]) && /authorizations\.state/.test(lifecycles[1]) && tx?.row === "1" && tx.panel === "1" && tx.chip === "1" && tx.under && tx.table === "orders" && tx.op === "UPDATE" && /PSP authorize/.test(tx.outside || ""),
      "one lifecycle for each entity; picking a state shows the one transaction that brings it there (tables, op, fields), and the writes outside it set apart", JSON.stringify({ lifecycles, tx }));
    // every call; the figure the tutor drew, rebuilt as elements with its words in the room's language
    const calls = await p.$$eval("[data-calls] [data-call]", (els) => els.map((e) => [e.querySelector(".rp-call-name")?.textContent, !!e.querySelector('[data-call-part="transaction"] [data-tx]')]));
    const drawn = await p.evaluate(() => { const f = document.querySelector('[data-svg-figure] svg'); return f && { texts: [...f.querySelectorAll("text")].map((t) => t.textContent), marker: f.querySelector("marker")?.id, ref: f.querySelector("[marker-end]")?.getAttribute("marker-end"), scripts: f.querySelectorAll("script, foreignObject").length }; });
    ok(JSON.stringify(calls) === JSON.stringify([["/orders/:id/pay", true], ["/orders/:id", false], ["/webhooks/psp", true]]), "every call: its request, its response, the transaction it runs (or that it writes nothing)", JSON.stringify(calls));
    ok(drawn && drawn.texts.includes("兩個寫入同時到：誰贏？") && !drawn.texts.includes("Two writers race: who wins?") && drawn.ref === `url(#${drawn.marker})` && /^fB3-2-/.test(drawn.marker) && !drawn.scripts,
      "a figure the tutor drew is rebuilt element by element, its words in the room's language, its marker ids kept to the figure", JSON.stringify(drawn));
    const tamper = await p.evaluate((bad) => { const f = document.querySelector("[data-svg-figure] svg"), all = f ? [f, ...f.querySelectorAll("*")] : [];
      return { names: [...new Set(all.map((e) => e.localName))], attrs: [...new Set(all.flatMap((e) => [...e.attributes].map((a) => a.name)))], classes: [...new Set(all.flatMap((e) => [...e.classList]))], styles: all.map((e) => e.getAttribute("style")).filter(Boolean), values: all.flatMap((e) => [...e.attributes].map((a) => a.value)).filter((v) => v.includes(bad) || /javascript:|url\(http/i.test(v)), pwned: !!window.__pwn,
        lines: [...(f?.querySelectorAll("text") ?? [])].filter((t) => t.querySelector("tspan")).map((t) => [...t.querySelectorAll("tspan")].map((x) => [x.textContent, x.getAttribute("dy")])) }; }, BAD);
    ok(!["script", "foreignObject", "foreignobject", "a", "image", "use", "style", "div"].some((n) => tamper.names.includes(n)) && !tamper.attrs.some((a) => /^on|^(href|xlink:href|filter)$/.test(a)) && tamper.classes.every((c) => /^rr-/.test(c)) && tamper.styles.every((v) => !/url\(|background/i.test(v)) && !tamper.values.length && !tamper.pwned,
      "a figure from a tampered room.json is still rebuilt only from the allowlist: no script, foreignObject, link, image, use or style; no handler, href, style or outside url() reaches the page", JSON.stringify(tamper));
    ok(JSON.stringify(tamper.lines) === JSON.stringify([[["第一行", "0"], ["第二行", "14"]]]), "a label of two lines keeps both, each in the room's language at its own place (not flattened into one)", JSON.stringify(tamper.lines));
    const note = await p.evaluate(() => ({ text: document.querySelector("[data-report] [data-auto-started]")?.textContent ?? null, sw: !!document.querySelector("[data-report] [data-auto-off]") }));
    ok(/貼上後自動開始/.test(note.text ?? "") && /codex · gpt-6/.test(note.text ?? "") && note.sw, "a lesson started on paste says so, with the tutor it ran on and the switch that stops it starting on the next paste", JSON.stringify(note));
    ok(!errs.length, "the figures draw with no page error", errs.join(" | "));
    await ctx.close(); }

  // ---------- focus mode: the room takes the screen and gives it back as it was ----------
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); localStorage.setItem("crew.side", "open"); localStorage.setItem("crew.chatOpen", "1"); } } catch {} });
    await ctx.addInitScript(stubs, ["unavailable"]); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: ROOM }));
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    const shell = () => p.evaluate(() => ({ focus: document.body.dataset.focus === "room", side: document.body.classList.contains("side-collapsed"), chat: !document.body.classList.contains("chat-closed"), sideW: Math.round(document.querySelector(".side").getBoundingClientRect().width), store: [localStorage.getItem("crew.side"), localStorage.getItem("crew.chatOpen")] }));
    await p.goto(`${base}/#/board`); await p.waitForFunction(() => S.route?.name === "board"); await p.waitForTimeout(300);
    const before = await shell();
    await p.evaluate(() => { location.hash = "#/room/SC-50"; }); await p.waitForSelector("[data-stage]", { timeout: 15000 }); await p.waitForTimeout(300);
    const inRoom = await shell();
    ok(before.side === false && before.chat === true && inRoom.focus && inRoom.side && !inRoom.chat && inRoom.sideW <= 64 && JSON.stringify(inRoom.store) === JSON.stringify(["open", "1"]), "in a room the sidebar folds to its 64px rail and Firstmate closes, without changing the saved preferences", JSON.stringify({ before, inRoom }));
    await p.click("[data-room-firstmate]"); const sheet = await p.evaluate(() => { const c = document.querySelector("#chat").getBoundingClientRect(), st = document.querySelector("[data-stage]").getBoundingClientRect(); return { open: !document.body.classList.contains("chat-closed"), fixed: getComputedStyle(document.querySelector("#chat")).position, stageW: Math.round(st.width) }; });
    await p.click("#chatClose"); const after = await shell();
    ok(sheet.open && sheet.fixed === "fixed" && sheet.stageW > 1100 && !after.chat && JSON.stringify(after.store) === JSON.stringify(["open", "1"]), "the header's Firstmate opens it as a sheet over the room (the board keeps its width); closing it saves nothing", JSON.stringify({ sheet, after }));
    await p.evaluate(() => { location.hash = "#/board"; }); await p.waitForFunction(() => S.route?.name === "board"); await p.waitForTimeout(200);
    const left = await shell();
    ok(!left.focus && left.side === false && left.chat === true && JSON.stringify(left.store) === JSON.stringify(["open", "1"]), "leaving the room gives the sidebar and Firstmate back as they were", JSON.stringify(left));
    await ctx.close(); }

  // ---------- leaving a room mid-flight: a turn being sent, a citation loading, the mic listening, a scene playing ----------
  { const { ctx, p, release } = await open(1440, "en");
    let citeHold = null; await p.route(/\/api\/review-room\/SC-50\/cite\?/, async (r) => { await new Promise((res) => (citeHold = res)); r.fulfill({ json: { kind: "diff", path: "src/percent.ts", from: 2, to: 3, head: H, text: "@@ -1 +1 @@\n+x" } }); });
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.waitForFunction(() => document.querySelector("[data-mic]")?.disabled === false);
    await p.dispatchEvent("[data-mic]", "pointerdown"); await p.waitForSelector("[data-heard]");
    await p.click("[data-cite]"); await p.click('[data-room-action="how"]'); await p.click("[data-room-start]"); await p.waitForSelector("[data-room-busy]");
    await p.click("[data-play]");
    await p.evaluate(() => { window.__cancels = 0; window.__recStopped = false; location.hash = "#/room"; }); await p.waitForSelector('[data-pr-box="home"]'); await p.waitForSelector("[data-room-list]:not([data-room-list-loading])"); await p.waitForTimeout(300);
    const eager = await p.evaluate(() => ({ cancels: window.__cancels, rec: window.__recStopped }));
    ok(eager.cancels > 0 && eager.rec === true, "leaving the room stops its playback and its mic at once", JSON.stringify(eager));
    await p.evaluate(() => { window.__redraws = 0; new MutationObserver(() => window.__redraws++).observe(document.querySelector("#view"), { childList: true }); document.querySelector('[data-pr-url="home"]').dataset.mark = "1"; });
    release(); citeHold?.(); await p.evaluate(() => { window.__rec?.onresult?.({ results: [[{ transcript: "late words" }]] }); window.__rec?.onend?.(); });
    await p.waitForTimeout(3000);
    ok(await p.evaluate(() => window.__redraws === 0 && document.querySelector('[data-pr-url="home"]').dataset.mark === "1"), "what the room finishes after the captain left (the turn it sent, a citation, the mic) does not redraw the page now on screen", String(await p.evaluate(() => window.__redraws)));
    await ctx.close(); }

  // ---------- no on-device recognition: no mic; 390, zh-TW ----------
  { const { ctx, p } = await open(390, "zh-TW", "unavailable");
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.waitForFunction(() => document.querySelector("[data-mic]")?.disabled === true);
    ok(/裝置上的語音辨識/.test(await p.getAttribute("[data-mic]", "title")), "without on-device recognition the mic stays off and says why");
    ok(/場景 3 \/ 3/.test(await p.textContent("[data-scene-pos]")) && /紀錄/.test(await p.textContent("[data-transcript] header")) && /語音關/.test(await p.textContent("[data-voice]")), "zh-TW: the stage, the transcript and the voice choice read in Chinese");
    ok(await noScroll(p), "no sideways scroll at 390");
    // a phone: the picture on top (a flowchart laid out top down, its labels at least 14px), one point card under it that is
    // the caption, a read-only note instead of the prompt
    await p.click("[data-transcript-toggle]"); await p.click('[data-jump="t1"]'); await p.click("[data-replay]"); await p.click("[data-play]"); await p.click("[data-point-next]");
    const ph = await p.evaluate(() => { const vis = (e) => !!e && e.checkVisibility(), v = document.querySelector("[data-visual]").getBoundingClientRect(), pts = [...document.querySelectorAll("[data-stage] .rr-point")].filter(vis), card = pts[0]?.getBoundingClientRect(), main = document.querySelector("#main");
      const svg = document.querySelector("[data-visual] svg.rr-flow"), label = svg?.querySelector("[data-node] text"), px = label ? parseFloat(getComputedStyle(label).fontSize) * svg.getScreenCTM().a : 0;
      return { doc: document.documentElement.scrollHeight - innerHeight, main: main.scrollHeight - main.clientHeight, above: !!card && v.bottom <= card.top + 1, inView: v.top >= 0 && (card?.bottom ?? 999) <= innerHeight, shown: pts.length, caption: vis(document.querySelector("[data-caption]")), layout: svg?.dataset.layout, px: Math.round(px * 10) / 10,
        note: vis(document.querySelector("[data-room-phone]")), chips: vis(document.querySelector("[data-room-action]")), input: vis(document.querySelector("[data-room-text]")) }; });
    ok(ph.doc <= 0 && ph.main <= 0 && ph.above && ph.inView && ph.shown === 1 && !ph.caption && ph.layout === "TD" && ph.px >= 14 && ph.note && !ph.chips && !ph.input, "390×844: the picture on top and one point card under it (the caption merged into it), a top-down flowchart with labels of 14px or more, the prompt a read-only note; nothing scrolls", JSON.stringify(ph));
    await p.screenshot({ path: join(shots, "room-390-zh.png") });
    await ctx.close(); }

  // ---------- a pull request by its URL: the URL box, its room (state, new commits, what reviewers asked, what changed) ----------
  { const PRID = "PR-0123456789ab-7", EVIL = 'Why? <img src=x onerror="window.__pwned=1"> [diff:a.txt]\nAnd a second line the gist leaves for the original.';
    const rq = (text, ref, quote) => ({ text, kind: "claim", basis: "reviewer", cites: [ok1(ref)], quote });
    const PRROOM = { ...ROOM, card: { id: PRID, run: "R-050", node: "review", title: { en: "Pull request #7: Shout", "zh-TW": "Pull request #7：Shout" }, status: "open" }, task: { id: "R-050", title: "Add percent" },
      subject: { kind: "pr", room: PRID, url: "https://github.com/fixture/project/pull/7", repository: "fixture/project", number: 7 }, pr: { id: "7", url: "https://github.com/fixture/project/pull/7" }, summary: null,
      prState: { state: "open", draft: false, approved: true, checkedAt: "2026-10-28T12:00:00Z", headRepo: "contrib/project", verdicts: [{ author: "rita", state: "APPROVED", commit: H, current: true }] }, moved: { from: B, to: H, commits: 2, rewritten: false },
      board: [{ id: "B2-1", turn: 2, type: "diff", title: "What changed since you last looked", path: "", range: { from: B, to: H }, commit: H, base: B, header: "bbbbbbbb..aaaaaaaa", text: "@@ -1 +1 @@\n-TWO\n+Two", basis: "cited", cites: [ok1(`commit:${H}`)] }],
      turns: [{ n: 1, action: "reviewers", studio: true, title: "What reviewers asked", status: "done", provider: "studio", model: "", text: "", answer: "x", claims: [rq("rita · on a.txt:L2 [review:c11]", "review:c11", EVIL)] },
        { n: 2, action: "since", studio: true, title: "What changed since last time", status: "done", provider: "studio", model: "", text: "", from: B, answer: "y", claims: [cl(`2 new commits since you last looked (bbbbbbbb → aaaaaaaa) [commit:${H}]`, [ok1(`commit:${H}`)]), rq("Changed since: the code this comment points at: rita on a.txt:L2 [review:c11]", "review:c11", EVIL)] }],
      sources: [], check: { questions: [] } };
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); });
    await ctx.addInitScript(stubs, ["unavailable"]); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const opens = [], checks = [];
    let globalAuto = true; const asked = [];
    await ctx.route(/\/api\/review-room\/settings$/, (r) => { if (r.request().method() === "POST") globalAuto = JSON.parse(r.request().postData() || "{}").autoTeach; r.fulfill({ json: { autoTeach: globalAuto } }); });
    await ctx.route(/\/api\/review-room\/paste-offer\?/, (r) => { const u = new URL(r.request().url()).searchParams.get("url"); asked.push(u);
      r.fulfill({ json: /fixture\/project\/pull\/7$/.test(u) ? { auto: globalAuto, provider: "codex", model: "gpt-6", effort: "high", paid: true, images: true, createsHost: true, plan: "fp-7" } : { auto: true, error: "github.com/someone/else is not the repository of a project connected to GitHub", code: "not_connected" } }); });
    await ctx.route(/\/api\/review-room\/open-pr$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); opens.push(b.url);
      if (!/^https:\/\/github\.com\/fixture\/project\/pull\/7$/.test(b.url)) return r.fulfill({ status: 400, json: { error: "github.com/someone/else is not the GitHub repository of a registered project connected to GitHub; Studio reads only those", code: "not_connected" } });
      r.fulfill({ json: { id: PRID, href: `#/room/${PRID}`, room: PRROOM } }); });
    await ctx.route(new RegExp(`/api/review-room/${PRID}(\\?open=1)?$`), (r) => r.fulfill({ json: PRROOM }));
    await ctx.route(new RegExp(`/api/review-room/${PRID}/check$`), (r) => { checks.push(1); r.fulfill({ json: { ...PRROOM, moved: null, prState: { ...PRROOM.prState, state: "merged" }, open: false, offer: null, closed: { en: "This pull request is merged on GitHub: the room stays readable and takes no turn.", zh: "已合併" } } }); });
    await ctx.route(new RegExp(`/api/review-room/${PRID}/cite\\?`), (r) => r.fulfill({ json: { kind: "review", note: "inline", id: "c11", author: "rita", body: EVIL, path: "a.txt", line: 2, url: "https://github.com/fixture/project/pull/7#discussion_r11" } }));
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/#/room`); await p.waitForSelector('[data-pr-box="home"]', { timeout: 15000 });
    await p.fill('[data-pr-url="home"]', "https://github.com/someone/else/pull/1"); await p.click('[data-pr-open="home"]'); await p.waitForSelector('[data-pr-error="home"]');
    ok(/not the GitHub repository of a registered project connected to GitHub/.test(await p.textContent('[data-pr-error="home"]')), "the Review Room's home takes a pull request's URL; a repository not connected is refused with the reason");
    await p.fill('[data-pr-url="home"]', "https://github.com/fixture/project/pull/7"); await p.waitForSelector('[data-paste-offer="on"]', { timeout: 5000 }).catch(() => {});
    const po = await p.evaluate(() => document.querySelector('[data-pr-box="home"] [data-paste-offer]')?.textContent ?? null);
    ok(/starts the lesson by itself/.test(po ?? "") && /one paid model round on codex · gpt-6 \(high\)/.test(po ?? "") && /up to two generated pictures/.test(po ?? "") && /creates this pull request's host Task and its tutor's staffing/.test(po ?? "") && !/nothing is written/i.test(po ?? ""),
      "before the paste, the paste box says what it starts, as the room would run it: the host Task and staffing it creates, one paid round on this tutor and model, the room's pictures setting", po);
    // a switch changed: the box asks again and says the new thing (no answer kept from before the change)
    const n0 = asked.length; await p.click("[data-auto-global]"); await p.waitForSelector('[data-pr-box="home"] [data-paste-offer="off"]', { timeout: 5000 }).catch(() => {});
    const offLine = await p.evaluate(() => document.querySelector('[data-pr-box="home"] [data-paste-offer]')?.dataset.pasteOffer);
    await p.click("[data-auto-global]"); await p.waitForSelector('[data-pr-box="home"] [data-paste-offer="on"]', { timeout: 5000 }).catch(() => {});
    ok(offLine === "off" && asked.length >= n0 + 2, "turning auto-teach off or on asks the paste box's offer again: it never shows what a paste started before the switch changed", JSON.stringify({ offLine, asked: asked.length - n0 }));
    await p.click('[data-pr-open="home"]'); await p.waitForSelector(`[data-review-room="${PRID}"]`);
    ok(opens.length === 2 && (await p.evaluate(() => location.hash)) === `#/room/${PRID}`, "a connected repository's URL opens its room", JSON.stringify(opens));
    ok(/Open · approved at this head/.test(await p.textContent("[data-pr-state]")) && /from the fork contrib\/project/.test(await p.textContent("[data-room-subject]")) && /rita: approved/.test(await p.textContent("[data-pr-verdicts]")),
      "the room shows the pull request's state on GitHub: open, approved at this head by whom, from a fork");
    ok(/2 new commits since you last looked/.test(await p.textContent("[data-room-moved]")) && !!(await p.$('[data-room-github]')) && (await p.getAttribute("[data-room-github]", "href")) === "https://github.com/fixture/project/pull/7", "it says how many commits came since the captain last looked, with a link to GitHub");
    let s = await stage(p);
    ok(s.scene === "t2" && /What changed since last time/.test(s.title) && s.visual === "B2-1" && !!(await p.$('[data-studio-scene="since"]')), "the scene of what changed since last time is Studio's own, its picture the diff between the two heads", JSON.stringify(s));
    await p.click("[data-scene-prev]"); s = await stage(p);
    const q = await p.evaluate(() => ({ quote: document.querySelector('[data-untrusted="review"]')?.textContent, imgs: document.querySelectorAll(".rr-quote img, .rr-point img").length, pwned: !!window.__pwned, badge: document.querySelector('[data-basis="reviewer"]')?.textContent, chips: [...document.querySelectorAll(".rr-point [data-cite]")].map((e) => e.dataset.cite) }));
    ok(/What reviewers asked/.test(s.title) && q.quote?.includes('<img src=x onerror="window.__pwned=1">') && q.quote.includes("[diff:a.txt]") && q.imgs === 0 && !q.pwned && /Reviewer's words/.test(q.badge) && JSON.stringify(q.chips) === JSON.stringify(["review:c11"]),
      "what reviewers asked: each comment is its words as text (markup stays text, a citation-looking text is no link), labelled a reviewer's words, cited to the comment", JSON.stringify(q));
    const fold = await p.evaluate(() => { const d = document.querySelector('.rr-point [data-untrusted-fold="review"]'); return d && { open: d.open, gist: d.querySelector(".rr-gist")?.textContent ?? "", shown: d.querySelector("blockquote")?.checkVisibility() ? 1 : 0 }; });
    await p.click('.rr-point [data-untrusted-fold="review"] summary'); await p.evaluate(() => render());
    const kept = await p.evaluate(() => document.querySelector('.rr-point [data-untrusted-fold="review"]')?.open === true && document.querySelector('.rr-point [data-untrusted-fold="review"] blockquote')?.checkVisibility());
    ok(kept, "an opened original stays open across a redraw");
    await p.click('.rr-point [data-untrusted-fold="review"] summary');
    ok(!!fold && fold.open === false && fold.shown === 0 && fold.gist.length > 0 && fold.gist.length <= 120, "a reviewer's words show as a one-line gist; the full text stays folded until the captain opens it", JSON.stringify(fold));
    await p.click('[data-cite="review:c11"]'); await p.waitForSelector('[data-cite-panel="review:c11"] [data-untrusted="review"]');
    ok(/rita/.test(await p.textContent("[data-cite-panel]")) && (await p.getAttribute("[data-review-link]", "href")) === "https://github.com/fixture/project/pull/7#discussion_r11" && await p.evaluate(() => !document.querySelector("[data-cite-panel] img")), "the citation opens the comment, as text, with a link to it on GitHub");
    const shown = await p.evaluate(() => [...document.querySelectorAll("[data-stage] .rr-point")].map((e) => { const b = e.getBoundingClientRect(); return [b.height > 0, e.textContent.slice(0, 40)]; }));
    ok(shown.length === 1 && shown[0][0] && /rita · on a\.txt:L2/.test(shown[0][1]), "the scene's point is on the stage, visible", JSON.stringify(shown));
    ok(await noScroll(p), "no sideways scroll in a pull request's room at 1440");
    await p.screenshot({ path: join(shots, "room-pr-1440.png") });
    await p.click(`[data-room-check="${PRID}"]`); await p.waitForSelector('[data-pr-state="merged"]');
    ok(checks.length === 1 && /Merged on GitHub/.test(await p.textContent("[data-pr-state]")) && /merged on GitHub: the room stays readable/.test(await p.textContent("[data-room-closed]")) && !(await p.$("[data-room-moved]")) && !!(await p.$("[data-stage]")),
      "Check for new commits reads it again: merged on GitHub, the room says so and stays readable, no prompt");
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(100);
    ok(await noScroll(p), "no sideways scroll in a pull request's room at 390");
    await p.screenshot({ path: join(shots, "room-pr-390.png") });
    await ctx.close(); }

  // ---------- the entries: the Task page's button on a reviewed branch, the project page's pull request box ----------
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); });
    await ctx.addInitScript(stubs, ["unavailable"]); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const def = { id: "code-firstmate", name: "Code", version: 1, kind: "code", roles: [], nodes: [{ id: "review", kind: "agent", mode: "review", role: "reviewer", label: "Review", x: 0, y: 0 }], edges: [] };
    const task = (id, reviewRoom) => ({ id, title: "Add percent", status: "succeeded", result: "closed", workflow: "code-firstmate", version: 1, def, params: {}, ctx: {}, nodes: { review: { state: "passed", visits: 1 } }, cards: [], events: [], ledger: [], ledgerOk: true, ledgerBad: [], done: [], outputs: [], walked: [], steps: [], reviewRoom, createdAt: "2026-10-28T10:00:00Z", updatedAt: "2026-10-28T10:00:00Z" });
    await ctx.route(/\/api\/tasks\/R-061$/, (r) => r.fulfill({ json: task("R-061", { href: "#/room/R-061", reviewed: true, head: H, branch: "crew/percent", local: true, turns: 0, moved: true }) }));
    await ctx.route(/\/api\/tasks\/R-062$/, (r) => r.fulfill({ json: task("R-062", null) }));
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/#/run/R-061`); await p.waitForSelector('[data-task-review-room="R-061"]', { timeout: 15000 });
    ok((await p.getAttribute('[data-task-review-room="R-061"]', "href")) === "#/room/R-061" && /Open review room · new commits/.test(await p.textContent('[data-task-review-room="R-061"]')) && /local branch, not published/.test(await p.getAttribute('[data-task-review-room="R-061"]', "title")),
      "a Task whose branch passed Studio's review shows Open review room (new commits marked; a local-only branch says so)");
    await p.goto(`${base}/#/run/R-062`); await p.waitForSelector('[data-runview="R-062"]', { timeout: 15000 });
    ok(!(await p.$("[data-task-review-room]")), "a Task with no reviewed branch has no review room button");
    // the project page of a project connected to GitHub carries the pull request box
    const real = await (await fetch(`${base}/api/projects/overview`, { headers: { "x-crew-session": process.env.CREW_SESSION_TOKEN } })).json().catch(() => null);
    const pid = (real?.projects ?? []).find((x) => x.id && x.id !== "studio")?.id;
    if (pid) { await ctx.route(new RegExp(`/api/projects/${pid}/overview$`), async (r) => { const res = await r.fetch(), j = await res.json(); r.fulfill({ json: { ...j, github: { connected: true, verified: true, repository: "fixture/project" } } }); });
      await p.goto(`${base}/#/project/${pid}`); await p.waitForSelector(`[data-project-review-room="${pid}"]`, { timeout: 15000 });
      ok(/Review a pull request of fixture\/project/.test(await p.textContent(`[data-project-review-room="${pid}"]`)) && (await p.getAttribute(`[data-pr-url="project:${pid}"]`, "placeholder")) === "https://github.com/fixture/project/pull/123", "a project connected to GitHub offers the pull request box on its page");
      await p.route(/\/api\/review-room\/open-pr$/, (r) => r.fulfill({ status: 400, json: { error: "Paste a pull request's address: https://github.com/<owner>/<repo>/pull/<number>", code: "bad_url" } }));
      await p.fill(`[data-pr-url="project:${pid}"]`, "https://github.com/fixture/project/issues/1"); await p.click(`[data-pr-open="project:${pid}"]`); await p.waitForSelector(`[data-pr-error="project:${pid}"]`);
      ok(/Paste a pull request's address/.test(await p.textContent(`[data-pr-error="project:${pid}"]`)), "the project page's box shows why an address is refused");
      const sent = []; p.on("request", (q) => { if (/\/api\/review-room\/open-pr$/.test(q.url())) sent.push(JSON.parse(q.postData() || "{}")); });
      await p.route(/\/api\/review-room\/paste-offer\?/, async (r) => { await new Promise((ok2) => setTimeout(ok2, 700)); const pu = new URL(r.request().url()).searchParams.get("url"); r.fulfill({ json: { auto: true, provider: "codex", model: "gpt-6", effort: null, paid: true, images: false, createsHost: false, plan: `fp-${pu.split("/").pop()}` } }); });
      await p.fill(`[data-pr-url="project:${pid}"]`, "https://github.com/fixture/project/pull/8"); await p.press(`[data-pr-url="project:${pid}"]`, "Enter"); await p.waitForSelector(`[data-pr-error="project:${pid}"]`);
      const early = sent.at(-1);
      await p.fill(`[data-pr-url="project:${pid}"]`, "https://github.com/fixture/project/pull/9"); await p.waitForSelector(`[data-pr-box="project:${pid}"] [data-paste-offer="on"]`, { timeout: 5000 }).catch(() => {});
      await p.press(`[data-pr-url="project:${pid}"]`, "Enter"); await p.waitForTimeout(300); const late = sent.at(-1);
      ok(early?.url === "https://github.com/fixture/project/pull/8" && !("auto" in early) && !("plan" in early) && late?.url === "https://github.com/fixture/project/pull/9" && late.auto === true && late.plan === "fp-9",
        "Enter at once after the paste, before the box has said what it starts, opens the room without starting a lesson; once it has said so, the paste asks to start it with that plan's fingerprint", JSON.stringify({ early, late }));
      // the plan changed on Studio's side since the box said it: nothing starts, the box shows the new plan and says so
      await p.route(/\/api\/review-room\/open-pr$/, (r) => r.fulfill({ json: { id: "PR-x-10", href: "#/room/PR-x-10", room: { card: { id: "PR-x-10" } }, plan: { auto: true, provider: "claude", model: "m-2", effort: null, paid: true, images: true, createsHost: false, plan: "fp-new" } } }));
      await p.fill(`[data-pr-url="project:${pid}"]`, "https://github.com/fixture/project/pull/10"); await p.waitForSelector(`[data-pr-box="project:${pid}"] [data-paste-offer="on"]`, { timeout: 5000 }).catch(() => {});
      await p.press(`[data-pr-url="project:${pid}"]`, "Enter"); await p.waitForSelector(`[data-pr-error="project:${pid}"]`, { timeout: 5000 }).catch(() => {});
      const moved = await p.evaluate((w) => ({ hash: location.hash, line: document.querySelector(`[data-pr-box="${w}"] [data-paste-offer]`)?.textContent ?? "", err: document.querySelector(`[data-pr-error="${w}"]`)?.textContent ?? "" }), `project:${pid}`);
      ok(/claude · m-2/.test(moved.line) && /up to two generated pictures/.test(moved.line) && /nothing started/.test(moved.err) && !/PR-x-10/.test(moved.hash), "when what a paste starts changed since the box said it, nothing starts: the box shows the new plan and asks for a second paste", JSON.stringify(moved)); }
    else ok(false, "fixture: the UI server lists a project to show", JSON.stringify(real));
    await ctx.close(); }

  // ---------- the real routes: a card that does not exist, a write needs the desktop session ----------
  { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(`${base}/#/board`);
    const r = await p.evaluate(async () => { const a = await fetch("/api/review-room/SC-999"); const b = await fetch("/api/review-room/SC-999/turn", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); const c = await fetch("/api/review-room/SC-999/speech", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); return [a.status, b.status, (await b.json()).code, c.status]; });
    ok(r[0] === 404 && r[1] === 404 && r[2] === "not_found" && r[3] === 404, "the real routes answer: no room, no turn and no voice for a card that does not exist", JSON.stringify(r));
    const raw = await fetch(`${base}/api/review-room/SC-999/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    ok(raw.status === 401 || raw.status === 403, "a write without Studio's session is refused", String(raw.status));
    { const g = await p.evaluate(async () => { const a = await fetch("/api/review-room/SC-999/reset"), b = await fetch("/api/review-room/SC-999/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); return [a.status, b.status, (await b.json()).code]; });
      const bare = await fetch(`${base}/api/review-room/SC-999/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      ok(g[0] === 405 && g[1] === 404 && g[2] === "not_found" && (bare.status === 401 || bare.status === 403), "starting a room over is a POST only, with Studio's session, on a room that exists", JSON.stringify([g, bare.status])); }
    const ca = await p.evaluate(async () => { const x = await fetch("/api/review-room/SC-999/check-answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n: 1, choice: 0 }) }); return [x.status, (await x.json()).code]; });
    const caRaw = await fetch(`${base}/api/review-room/SC-999/check-answer`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    ok(ca[0] === 404 && ca[1] === "not_found" && (caRaw.status === 401 || caRaw.status === 403), "the check's answer route is real, and like every write it needs Studio's session", JSON.stringify([ca, caRaw.status]));
    const lb = await p.evaluate(async () => { const a = await fetch("/api/review-room/library/room-sc-999"), b = await fetch("/api/review-room/library/room-sc-999", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), c = await fetch("/api/artifacts/room-sc-999/v/1/approve", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), d = await fetch("/api/review-room/SC-999/save", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const e = await fetch("/api/artifacts/room-sc-999", { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" });
      return [a.status, b.status, c.status, (await c.json()).code, d.status, e.status, (await e.json()).error]; });
    ok(lb[0] === 404 && lb[1] === 405 && lb[2] === 403 && lb[3] === "room-snapshot-read-only" && lb[4] === 404 && lb[5] === 404 && /no such saved room/.test(lb[6] ?? ""), "a saved room's route reads only; the Library refuses any write to a saved room but its deletion; Save to Library is a real route", JSON.stringify(lb));
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\nreview-room-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
