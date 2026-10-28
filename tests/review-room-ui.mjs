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
const stage = (p) => p.$eval("[data-stage]", (e) => ({ scene: e.dataset.scene, pos: e.querySelector("[data-scene-pos]")?.dataset.scenePos, title: e.querySelector("[data-scene-title]")?.textContent, points: e.querySelectorAll(".rr-point").length,
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
      return { stageH: st.height, barH: bar.height, below: bar.top >= st.bottom - 1, drawerOpen: d.open }; });
    ok(layout.stageH > layout.barH * 2 && layout.below && layout.drawerOpen === false, "the board takes most of the screen; a slim prompt bar sits under it; the transcript drawer starts closed", JSON.stringify(layout));
    await p.click("[data-transcript] summary"); const jumps = await p.$$eval("[data-jump]", (els) => els.map((e) => [e.dataset.jump, e.textContent]));
    const links = await p.evaluate(() => ({ js: document.querySelectorAll('a[href^="javascript:" i]').length, src: [...document.querySelectorAll("[data-source]")].map((e) => [e.dataset.source, !!e.querySelector("a"), e.querySelector("[data-source-text]")?.textContent ?? null]) }));
    ok(links.js === 0 && JSON.stringify(links.src) === JSON.stringify([["1", true, null], ["2", false, null], ["3", false, "javascript:alert(document.cookie)"], ["4", false, "javascript:alert(2)"]]), "only a fetched http(s) page is a link; a refused or non-http address is plain text, never an anchor", JSON.stringify(links));
    ok(jumps.length === 3 && /This change at a glance/.test(jumps[0][1]) && /Teach me this change\. → How percent works/.test(jumps[1][1]), "the transcript lists each question and its scene's title", JSON.stringify(jumps));
    await p.click('[data-jump="t1"]'); s = await stage(p);
    ok(s.scene === "t1" && s.pos === "2/3" && s.title === "How percent works" && s.points === 5 && s.visual === "B1-7", "a click in the transcript jumps to its scene; the visual is the one the last point cites", JSON.stringify(s));
    ok(await p.$eval('[data-claim="inference"]', (e) => /Inference/.test(e.textContent)) && await p.evaluate(() => !window.__pwned && !document.querySelector(".rr-point img")), "an uncited point reads Inference; model text with markup stays text");
    // screenshots: before / after toggle
    ok(await p.$eval("[data-visual] [data-shot-side]", (e) => e.dataset.shotSide) === "after" && /screenshot · base and head/.test(await p.textContent('[data-visual] [data-kind="screenshot"]')), "the screenshot is labelled with its kind and shows the head first");
    await p.click('[data-shot-toggle="before"]');
    ok(await p.$eval("[data-visual] [data-shot-img]", (e) => e.dataset.shotImg + " " + e.getAttribute("src")) === "before /api/wruns/R-050/captures/x/before/index.html.png", "Before shows the base's screenshot");
    // play: points appear one at a time, the visual follows the point, the caption reads it
    await p.click("[data-play]"); s = await stage(p);
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
    await p.click('[data-jump="t0"]').catch(async () => { await p.click("[data-transcript] summary"); await p.click('[data-jump="t0"]'); });
    ok(!!(await p.$("[data-visual] [data-illustration-pending]")) && /paid generated image, made once/.test(await p.textContent("[data-visual] [data-paid-image]")), "the opening picture still being drawn shows a placeholder, labelled as a paid generated image made once");
    // voice: off by default; on-device voices only, the best first; the vendor's own voice for the whole scene
    await p.click('[data-jump="t1"]').catch(() => {});
    const voices = await p.$$eval("[data-voice] option", (els) => els.map((e) => e.value));
    ok(JSON.stringify(voices) === JSON.stringify(["off", "vendor", "local:ava", "local:com.apple.voice.enhanced.en-US.Zoe", "local:com.apple.voice.compact.en-US.Samantha"]) && (await p.$eval("[data-voice]", (e) => e.value)) === "off", "voice is off by default; the choices are the tutor vendor's own voice and this Mac's on-device voices, the best first (none a browser would send away, no novelty or robotic legacy voice)", JSON.stringify(voices));
    // a voice picked before it was dropped (a robotic one) is not kept as silence: the best voice there is takes its place
    await p.evaluate(() => localStorage.setItem("crew.room.voice", "local:fred")); await p.click("[data-point-next]").catch(() => {}); await p.click('[data-jump="t1"]').catch(async () => { await p.click("[data-transcript] summary"); await p.click('[data-jump="t1"]'); });
    ok((await p.$eval("[data-voice]", (e) => e.value)) === "local:ava", "a saved voice no longer offered falls back to the best one on this Mac", await p.$eval("[data-voice]", (e) => e.value));
    await p.selectOption("[data-voice]", "off");
    // an older macOS: Safari gives every voice, the good ones too, a com.apple.speech.synthesis.voice. address
    const voicesWith = async (list) => { await p.evaluate((l) => { window.__voices = l; }, list); await p.click("[data-point-next]").catch(() => {}); await p.click('[data-jump="t1"]').catch(async () => { await p.click("[data-transcript] summary"); await p.click('[data-jump="t1"]'); }); return p.$$eval("[data-voice] option", (els) => els.map((e) => e.value)); };
    const old = (n) => ({ name: n, lang: "en-US", localService: true, voiceURI: `com.apple.speech.synthesis.voice.${n.replace(/ /g, "")}` });
    let vs = await voicesWith(["Samantha", "Zarvox", "Alex", "Fred", "Bad News"].map(old));
    ok(JSON.stringify(vs) === JSON.stringify(["off", "vendor", "local:com.apple.speech.synthesis.voice.Samantha", "local:com.apple.speech.synthesis.voice.Alex"]), "on an older macOS the good voices are offered though they share the legacy address; novelty and legacy voices are still left out", JSON.stringify(vs));
    vs = await voicesWith(["Fred", "Zarvox", "Ralph", "Bubbles"].map(old));
    ok(JSON.stringify(vs) === JSON.stringify(["off", "vendor", "local:com.apple.speech.synthesis.voice.Fred", "local:com.apple.speech.synthesis.voice.Ralph"]), "when this Mac has only legacy voices, they are offered rather than none; a novelty voice never is", JSON.stringify(vs));
    await voicesWith(null);
    await p.selectOption("[data-voice]", "local:ava"); await p.click("[data-play]"); await p.waitForFunction(() => window.__spoken.length >= 2);
    ok(await p.evaluate(() => window.__spoken[0][0] === "An amount in cents goes into percent ." || /^An amount in cents goes into percent/.test(window.__spoken[0][0])) && await p.evaluate(() => window.__spoken[0][1] === "ava"), "with this Mac's voice each point is spoken as it appears", JSON.stringify(await p.evaluate(() => window.__spoken)));
    await p.click("[data-play]").catch(() => {}); await p.evaluate(() => { window.__spoken = []; });
    await p.selectOption("[data-voice]", "vendor"); await p.click("[data-play]"); await p.waitForFunction(() => !!window.__audio);
    ok(speech.length === 1 && speech[0].scene === "t1" && (await p.evaluate(() => window.__audio.src)) === "/api/review-room/SC-50/audio/voice-t1-0123456789ab.mp3", "the vendor's voice is asked for the whole scene once and played", JSON.stringify(speech));
    await p.evaluate(() => { const a = window.__audio; a.currentTime = 6; a.ontimeupdate(); }); s = await stage(p);
    ok(s.points >= 3 && s.points < 5, "the points appear as the narration reaches them", JSON.stringify(s));
    await p.evaluate(() => window.__audio.onended()); s = await stage(p);
    ok(s.points === 5 && (await p.evaluate(() => window.__spoken.length)) === 0, "when it ends every point is shown; no browser voice spoke over it");
    await p.selectOption("[data-voice]", "off");
    // a spoken question: on-device recognition, push to talk, the transcript shown before it is sent
    ok(await p.evaluate(() => JSON.stringify(window.__micAsked)) === JSON.stringify({ langs: ["en"], processLocally: true }), "the mic is offered only after the browser says it recognises speech on this device");
    await p.dispatchEvent("[data-mic]", "pointerdown"); await p.waitForSelector("[data-heard]");
    ok((await p.inputValue("[data-room-text]")) === "why do halves round up" && await p.evaluate(() => window.__recStarted.local === true) && !posts.length, "holding the mic fills the question with what it heard, recognised on this device; nothing is sent yet");
    await p.dispatchEvent("[data-mic]", "pointerup");
    await p.click("[data-room-send]"); await p.waitForSelector('[data-room-confirm="ask"]');
    ok(await p.getAttribute("[data-independence]", "data-independence") === "same" && /Tutor: codex · gpt-6 — Same model as the author: a fresh context, not an independent opinion\. Only one model is usable/.test(await p.textContent("[data-independence]")), "the room labels the tutor and its independence from the author");
    ok(/paid model round on codex · gpt-6 \(high\)/.test(await p.textContent("[data-room-confirm]")) && /up to two illustrations, each a paid image job/.test(await p.textContent("[data-room-confirm]")) && /nothing is sent to GitHub/.test(await p.textContent("[data-room-confirm]")) && !posts.length, "Ask first asks to confirm the paid round on its provider and model, illustrations included");
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
    await p.click('[data-jump="t1"]').catch(async () => { await p.click("[data-transcript] summary"); await p.click('[data-jump="t1"]'); });
    await p.click("[data-play]"); await p.evaluate(() => { location.hash = "#/room"; }); await p.waitForSelector('[data-pr-box="home"]');
    await p.evaluate(() => { window.__redraws = 0; new MutationObserver(() => window.__redraws++).observe(document.querySelector("#view"), { childList: true }); document.querySelector('[data-pr-url="home"]').dataset.mark = "1"; });
    await p.waitForTimeout(4000);
    ok(await p.evaluate(() => window.__redraws === 0 && document.querySelector('[data-pr-url="home"]').dataset.mark === "1"), "once the captain leaves a room, its poll and its playback no longer redraw the page on screen", String(await p.evaluate(() => window.__redraws)));
    await ctx.close(); }

  // ---------- leaving a room mid-flight: a turn being sent, a citation loading, the mic listening, a scene playing ----------
  { const { ctx, p, release } = await open(1440, "en");
    let citeHold = null; await p.route(/\/api\/review-room\/SC-50\/cite\?/, async (r) => { await new Promise((res) => (citeHold = res)); r.fulfill({ json: { kind: "diff", path: "src/percent.ts", from: 2, to: 3, head: H, text: "@@ -1 +1 @@\n+x" } }); });
    await p.goto(`${base}/#/room/SC-50`); await p.waitForSelector("[data-stage]", { timeout: 15000 });
    await p.waitForFunction(() => document.querySelector("[data-mic]")?.disabled === false);
    await p.dispatchEvent("[data-mic]", "pointerdown"); await p.waitForSelector("[data-heard]");
    await p.click("[data-cite]"); await p.click('[data-room-action="how"]'); await p.click("[data-room-start]"); await p.waitForSelector("[data-room-busy]");
    await p.click("[data-play]");
    await p.evaluate(() => { window.__cancels = 0; window.__recStopped = false; location.hash = "#/room"; }); await p.waitForSelector('[data-pr-box="home"]');
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
    ok(/場景 3 \/ 3/.test(await p.textContent("[data-scene-pos]")) && /紀錄/.test(await p.textContent("[data-transcript] summary")) && /語音關/.test(await p.textContent("[data-voice]")), "zh-TW: the stage, the transcript and the voice choice read in Chinese");
    ok(await noScroll(p), "no sideways scroll at 390");
    await p.screenshot({ path: join(shots, "room-390-zh.png") });
    await ctx.close(); }

  // ---------- a pull request by its URL: the URL box, its room (state, new commits, what reviewers asked, what changed) ----------
  { const PRID = "PR-0123456789ab-7", EVIL = 'Why? <img src=x onerror="window.__pwned=1"> [diff:a.txt]';
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
    await p.fill('[data-pr-url="home"]', "https://github.com/fixture/project/pull/7"); await p.click('[data-pr-open="home"]'); await p.waitForSelector(`[data-review-room="${PRID}"]`);
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
      ok(/Paste a pull request's address/.test(await p.textContent(`[data-pr-error="project:${pid}"]`)), "the project page's box shows why an address is refused"); }
    else ok(false, "fixture: the UI server lists a project to show", JSON.stringify(real));
    await ctx.close(); }

  // ---------- the real routes: a card that does not exist, a write needs the desktop session ----------
  { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(`${base}/#/board`);
    const r = await p.evaluate(async () => { const a = await fetch("/api/review-room/SC-999"); const b = await fetch("/api/review-room/SC-999/turn", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); const c = await fetch("/api/review-room/SC-999/speech", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); return [a.status, b.status, (await b.json()).code, c.status]; });
    ok(r[0] === 404 && r[1] === 404 && r[2] === "not_found" && r[3] === 404, "the real routes answer: no room, no turn and no voice for a card that does not exist", JSON.stringify(r));
    const raw = await fetch(`${base}/api/review-room/SC-999/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    ok(raw.status === 401 || raw.status === 403, "a write without Studio's session is refused", String(raw.status));
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\nreview-room-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
