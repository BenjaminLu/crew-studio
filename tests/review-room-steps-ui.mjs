import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Steps and illustrations (docs/units/review-room.md, "Steps and illustrations"): every card on the board, an answer's scene and
// a lesson's chapter alike, is its numbered steps on the left and an illustration on the right (on a phone the illustration on
// top). A step picked shows its own picture zoomed to what it is about, with its detail under it; the illustration is never
// code (the code is a link away: GitHub for a pull request on GitHub, the citation panel otherwise); a connector of a drawing
// clicked says what that step does and why it was built this way. An older room with none of this still renders. The room's
// routes are answered by the test: nothing paid runs.                                       node tests/review-room-steps-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-steps-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-steps-ui-")), data = join(tmp, "data"); mkdirSync(data);
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
const shots = process.env.STEPS_SHOTS || join(root, "tests/out/review-room-steps"); mkdirSync(shots, { recursive: true });
const H = "a".repeat(40), B = "b".repeat(40);
const cl = (text, cites = [], more = {}) => ({ text, kind: "claim", basis: cites.some((c) => c.ok) ? "cited" : "inference", cites, ...more });
const ok1 = (ref) => ({ ref, ok: true });
const OFFER = { provider: "codex", model: "gpt-6", effort: "high", paid: true, independence: { level: "vendor", adaptive: false, en: "Different vendor from the author.", zh: "和作者不同供應商。" }, hash: "feedc0ffee123456" };
const ACTIONS = [["how", "How?", "怎麼運作？"], ["why", "Why?", "為什麼？"], ["teach", "Teach me", "教我"], ["quiz", "Quiz", "考我"]].map(([id, en, zh]) => ({ id, en, zh }));
const ex = (edge, does, why) => ({ edge, does, ...(why ? { why } : {}), cites: [ok1("diff:src/percent.ts")] });
/** a percent helper: turn 1 answers how it works in three steps (a flow with its connectors explained, then the function's code),
 *  turn 2 is its lesson (what, what talks to what, its lifecycle), turn 3 an older answer with code and nothing new */
const ROOM = (url = "https://github.com/fixture/project/pull/7") => ({ card: { id: "SC-81", run: "R-081", node: "merge-card", title: { en: "Merge: Add percent", "zh-TW": "合併：新增 percent" }, status: "open" }, task: { id: "R-081", title: "Add percent" },
  pr: { id: 7, url }, head: H, base: B, open: true, running: null, offer: OFFER, actions: ACTIONS, autoTeach: { on: true },
  board: [
    { id: "B1-1", turn: 1, type: "mermaid", title: "How a price is made", code: "flowchart LR\n  A[amount in cents] --> B[percent]\n  B -->|Math.round| C[whole cents]\n  C --> D[the cart]", basis: "cited", cites: [ok1("diff:src/percent.ts")],
      explain: [ex("A>B", "Hands the amount over in cents", "One place rounds, so every caller agrees")] },
    { id: "B1-3", turn: 1, type: "code", title: "The function", path: "src/percent.ts", commit: H, start: 1, end: 3, total: 5, lines: ["export function percent(amount: number, pct: number): number {", "  return Math.round((amount * pct) / 100);", "}"], highlight: [2], basis: "cited", cites: [] },
    { id: "B2-1", turn: 2, type: "arch", title: "Who calls it", nodes: [{ id: "cart", label: "Cart", kind: "actor" }, { id: "pct", label: "percent()", kind: "service", mark: "new" }, { id: "led", label: "Ledger", kind: "store" }],
      edges: [{ from: "cart", to: "pct", label: "percent(1999, 15)", cite: ok1("diff:src/percent.ts") }, { from: "pct", to: "led", label: "writes" }], cites: [ok1("diff:src/percent.ts")], inferred: true, basis: "cited",
      explain: [ex("cart>pct", "The cart asks for a line's price", "The cart never rounds: one rule, in one place")] },
    { id: "B2-2", turn: 2, type: "states", title: "An invoice", entity: "invoices.state", states: [{ id: "draft", label: "Draft" }, { id: "priced", label: "Priced", mark: "new" }, { id: "paid", label: "Paid" }],
      transitions: [{ from: "draft", to: "priced", label: "price", detail: "sets total", cite: ok1("diff:src/percent.ts"), why: "Priced once, before it is shown" }, { from: "priced", to: "paid", label: "pay", cite: ok1("diff:src/percent.ts") }], cites: [ok1("diff:src/percent.ts")], basis: "cited" },
    { id: "B4-1", turn: 4, type: "svg", kind: "flow", title: "Two boxes", tree: {"t":"svg","a":{"viewBox":"0 0 400 120"},"c":[{"t":"rect","a":{"x":"10","y":"40","width":"80","height":"40","data-node":"x","fill":"var(--fig-card)","stroke":"var(--fig-ink)"},"c":[]},{"t":"path","a":{"d":"M90,60 H210","data-edge":"x>y","stroke":"var(--fig-muted)","fill":"none"},"c":[]},{"t":"g","a":{"transform":"translate(200,0)"},"c":[{"t":"rect","a":{"x":"10","y":"40","width":"80","height":"40","data-node":"y","fill":"var(--fig-card)","stroke":"var(--fig-ink)"},"c":[]}]}]}, nodes: ["x", "y"], edges: ["x>y"], transitions: [], cites: [], basis: "inference", explain: [ex("x>y", "Passes the order on", "Y owns the rounding")] },
    { id: "B3-1", turn: 3, type: "code", title: "Rounding", path: "src/percent.ts", commit: H, start: 2, end: 2, total: 5, lines: ["  return Math.round((amount * pct) / 100);"], highlight: [2], basis: "cited", cites: [] }],
  turns: [
    { n: 1, action: "how", text: "How does this change work?", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "x", head: H, claims: [cl("x")],
      scenes: [{ n: 1, title: "How a price is made", picture: "B1-1", points: [
        cl("The amount goes in, in cents [diff:src/percent.ts].", [ok1("diff:src/percent.ts")], { focus: ["A", "A>B"], detail: "The cart passes whole cents, never a float." }),
        cl("It is rounded half up.", [], { focus: ["B>C"], detail: "Math.round: 299.85 becomes 300." }),
        cl("The function is three lines [diff:src/percent.ts:L1-3].", [ok1("diff:src/percent.ts:L1-3")], { picture: "B1-3", detail: "Read it on GitHub." })] }] },
    { n: 2, action: "teach", text: "Teach me this change.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "y", head: H, claims: [cl("y")],
      scenes: [{ n: 1, chapter: "what", title: "A percent helper", picture: "", points: [cl("It adds percent [diff:src/percent.ts].", [ok1("diff:src/percent.ts")], { detail: "One new function." }), cl("It rounds to the cent.")] },
        { n: 2, chapter: "talks", title: "Who calls it", picture: "B2-1", points: [cl("The cart calls it [diff:src/percent.ts].", [ok1("diff:src/percent.ts")], { focus: ["cart>pct"], detail: "Each line of the cart, once." }), cl("The ledger keeps the result, as an invoice [board:B2-2].", [ok1("board:B2-2")], { focus: ["led"] })] },
        { n: 3, chapter: "lifecycle", title: "An invoice", picture: "B2-2", points: [cl("Pricing moves draft to priced [diff:src/percent.ts].", [ok1("diff:src/percent.ts")], { focus: ["draft>priced"] }), cl("Paying ends it [diff:src/percent.ts].", [ok1("diff:src/percent.ts")])] }] },
    { n: 4, action: "why", text: "Why two boxes?", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "w", head: H, claims: [cl("w")],
      scenes: [{ n: 1, title: "Two boxes", picture: "B4-1", points: [cl("X hands over [diff:src/percent.ts].", [ok1("diff:src/percent.ts")]), cl("Y rounds.", [], { focus: ["y"] })] }] },
    { n: 3, action: "ask", text: "Where is the rounding?", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "z", head: H, claims: [cl("It is one line [board:B3-1].", [ok1("board:B3-1")]), cl("Nothing else rounds [diff:src/percent.ts].", [ok1("diff:src/percent.ts")])] }],
  tutors: [], sources: [], notes: [], lesson: { threads: [], visited: ["t2", "t2-2", "t2-3", "end"] }, check: { questions: [] },
  diffstat: { files: [{ path: "src/percent.ts", added: 4, removed: 0 }, { path: "test/percent.test.ts", added: 3, removed: 1 }], total: { files: 2, added: 7, removed: 1 }, from: "git" } });
const stubs = () => { const v = [{ name: "Ava (Premium)", lang: "en-US", localService: true, voiceURI: "ava" }];
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => v, speak: (u) => setTimeout(() => u.onend && u.onend(), 5), cancel: () => {} } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; }; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
  window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; };
async function open(width, room, o = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: o.dark ? "dark" : "light", reducedMotion: "reduce" });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [o.lang || "en"]);
  await ctx.addInitScript(stubs);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/api\/remote\/me$/, (r) => r.fulfill({ json: { kind: width < 600 ? "phone" : "desktop", device: null } }));
  const S = { posts: [] };
  await ctx.route(/\/api\/review-room\/SC-81(\?open=1)?$/, (r) => r.fulfill({ json: room }));
  await ctx.route(/\/api\/review-room\/SC-81\/(lesson|turn|arrive)$/, (r) => { S.posts.push(r.request().url()); r.fulfill(/lesson$/.test(r.request().url()) ? { json: { visited: [] } } : { status: 409, json: { error: "confirm", code: "confirm_required", offer: OFFER } }); });
  // the vendor's voice: a stand-in audio the test moves along by hand (window.__audio)
  if (o.vendor) { await ctx.addInitScript(() => { try { localStorage.setItem("crew.room.voice", "vendor"); } catch {}
      window.Audio = function (src) { this.src = src; this.currentTime = 0; this.duration = 0; window.__audio = this; this.play = async () => {}; this.pause = () => {}; }; });
    await ctx.route(/\/api\/review-room\/SC-81\/speech$/, (r) => r.fulfill({ json: { src: "data:audio/mpeg;base64,AAAA" } })); }
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e.message}`));
  await p.goto(`${base}/#/room/SC-81`); await p.waitForSelector("#view .rr-room", { timeout: 15000 }); await p.waitForTimeout(400);
  return { ctx, p, S };
}
const tap = (p, sel, o = {}) => p.click(sel, { timeout: 2500, ...o }).catch(() => {});
const fly = async (p, key) => { await tap(p, `[data-outline="${key}"]`); await p.waitForTimeout(550); };
/** the rectangles of a region's steps and its illustration */
const sides = (p, key) => p.evaluate((k) => { const r = document.querySelector(`[data-region="${k}"]`); if (!r) return null; const st = r.querySelector(".rr-points, .rb-split > .rp-card"), il = r.querySelector("[data-visual], .rb-illus");
  const a = st?.getBoundingClientRect(), b = il?.getBoundingClientRect(); return a && b ? { stepsRight: a.right, stepsLeft: a.left, illusLeft: b.left, illusTop: b.top, stepsTop: a.top, nums: r.querySelectorAll("[data-step-pick]").length } : null; }, key);
/** what the region's illustration shows */
const illus = (p, key) => p.evaluate((k) => { const r = document.querySelector(`[data-region="${k}"]`), f = r?.querySelector("[data-visual], .rb-illus"); if (!f) return null; const svg = f.querySelector("svg.rr-flow, svg.rr-seq, svg");
  return { of: (f.closest("[data-illustration-of]") || f.querySelector("[data-illustration-of]"))?.getAttribute("data-illustration-of") ?? f.getAttribute("data-illustration-of"), visual: f.getAttribute("data-visual"), focus: f.getAttribute("data-zoom-focus") || f.querySelector("[data-zoom-focus]")?.getAttribute("data-zoom-focus") || null,
    zoomed: !!svg?.classList.contains("rr-zoomed"), vb: svg?.getAttribute("viewBox") || null, focused: [...(svg?.querySelectorAll(".rr-focus") || [])].map((e) => e.getAttribute("data-node") || e.getAttribute("data-edge") || e.getAttribute("data-elabel")).filter(Boolean),
    detail: f.querySelector("[data-step-detail]")?.textContent || null, code: f.querySelectorAll(".rr-body .rr-code, .rr-body .rr-diff, .rr-body pre, .rp-figbody .rr-code").length,
    refs: [...f.querySelectorAll("[data-code-ref]")].map((e) => [e.dataset.codeRef, e.dataset.codeLink]), type: f.querySelector("[data-item-type]")?.dataset.itemType || f.querySelector("[data-figure-type]")?.dataset.figureType || null }; }, key);
const click = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); return true; }, sel);

try {
  // ---------- an answer's scene: steps on the left, the illustration on the right, light and dark ----------
  for (const dark of [false, true]) {
    const { ctx, p } = await open(1440, ROOM(), { dark });
    await fly(p, "t1"); const s = await sides(p, "t1");
    ok(s && s.nums === 3 && s.stepsRight <= s.illusLeft + 2, `${dark ? "dark" : "light"}: an answer is its numbered steps on the left and its illustration on the right`, JSON.stringify(s));
    await fly(p, "t2-2"); const l = await sides(p, "t2-2");
    ok(l && l.nums === 2 && l.stepsRight <= l.illusLeft + 2, `${dark ? "dark" : "light"}: a lesson's chapter too: its numbered steps on the left, its drawing on the right`, JSON.stringify(l));
    await fly(p, "t1"); await p.screenshot({ path: join(shots, `answer-${dark ? "dark" : "light"}-1440.png`) });
    await ctx.close(); }
  // ---------- picking a step shows its picture, zoomed to what it is about, with its detail ----------
  { const { ctx, p, S } = await open(1440, ROOM()); await fly(p, "t1");
    const whole = await illus(p, "t1");
    await tap(p, '[data-region="t1"] [data-step-pick="1"]'); await p.waitForTimeout(250); const one = await illus(p, "t1");
    const full = (whole?.vb || "").split(/[ ,]+/).map(Number), part = (one?.vb || "").split(/[ ,]+/).map(Number);
    ok(whole?.of === "all" && whole.visual === "B1-1" && !whole.zoomed && one?.of === "1" && one.visual === "B1-1" && one.focus === "A,A>B" && one.zoomed && part[2] * part[3] < full[2] * full[3] * 0.8 && one.focused.includes("A") && one.focused.includes("A>B") && /never a float/.test(one.detail || ""),
      "a step picked shows its picture zoomed to its focus (the rest dimmed), its detail under it; before, the whole picture", JSON.stringify({ whole, one }));
    await tap(p, '[data-region="t1"] [data-step-pick="2"]'); await p.waitForTimeout(250); const two = await illus(p, "t1");
    ok(two?.of === "2" && two.focus === "B>C" && two.focused.includes("B>C") && /299\.85 becomes 300/.test(two.detail || ""), "the next step moves the zoom to its own part", JSON.stringify(two));
    // the third step's picture is the function's code: never drawn; Studio's picture of the files instead, the code a link to GitHub
    await tap(p, '[data-region="t1"] [data-step-pick="3"]'); await p.waitForTimeout(250); const three = await illus(p, "t1");
    ok(three?.of === "3" && three.code === 0 && three.visual !== "B1-3" && /^t1-(files|key)$/.test(three.visual || "") && JSON.stringify(three.refs) === '[["diff:src/percent.ts:L1-3","github"]]',
      "the illustration is never code: a step whose picture is code shows Studio's picture of the files, and the code is a link (GitHub, at those lines)", JSON.stringify(three));
    await tap(p, '[data-region="t1"] [data-code-ref]'); const opened = await p.evaluate(() => window.__opened);
    ok(opened.length === 1 && /^https:\/\/github\.com\/fixture\/project\/pull\/7\/files#diff-[0-9a-f]{64}R1-R3$/.test(opened[0]), "the code link opens the pull request's lines on GitHub, in a new window", JSON.stringify(opened));
    // a connector clicked: what that step does and why; one with nothing recorded says so; Ask about this only fills the question
    await tap(p, '[data-region="t1"] [data-step-pick="1"]'); await p.waitForTimeout(200);
    await click(p, '[data-region="t1"] [data-visual] [data-edge-hit="A>B"]'); await p.waitForTimeout(200);
    const e1 = await p.evaluate(() => { const x = document.querySelector('[data-region="t1"] [data-explain]'); return x && { key: x.dataset.explain, does: x.querySelector("[data-explain-does]")?.textContent, why: x.querySelector("[data-explain-why]")?.textContent, cites: x.querySelectorAll("[data-cite]").length }; });
    ok(e1?.key === "A>B" && /Hands the amount over in cents/.test(e1.does || "") && /every caller agrees/.test(e1.why || "") && e1.cites === 1, "a connector clicked opens what that step does and why it was built this way, with what it rests on", JSON.stringify(e1));
    await click(p, '[data-region="t1"] [data-visual] [data-edge-hit="C>D"]'); await p.waitForTimeout(200);
    const e2 = await p.evaluate(() => { const x = document.querySelector('[data-region="t1"] [data-explain]'); return x && { key: x.dataset.explain, none: !!x.querySelector("[data-explain-none]") }; });
    await tap(p, '[data-region="t1"] [data-explain-ask]'); await p.waitForTimeout(200);
    const draft = await p.evaluate(() => document.querySelector("[data-room-text]")?.value || "");
    ok(e2?.key === "C>D" && e2.none && /C → D/.test(draft) && !S.posts.some((u) => /turn$/.test(u)), "one with nothing recorded says so; “Ask about this” only fills the question (nothing sent, nothing paid)", JSON.stringify({ e2, draft, posts: S.posts }));
    await p.screenshot({ path: join(shots, "explain-1440.png") });
    // a lesson's connector: its explanation tops the ask popover, whose chips stay
    await fly(p, "t2-2"); await click(p, '[data-region="t2-2"] [data-edge-hit="cart>pct"]'); await p.waitForTimeout(250);
    const pop = await p.evaluate(() => { const x = document.querySelector(".rb-pop"); return x && { explain: x.querySelector("[data-explain]")?.dataset.explain, does: x.querySelector("[data-explain-does]")?.textContent, chips: [...x.querySelectorAll("[data-chip]")].map((c) => c.dataset.chip) }; });
    ok(pop?.explain === "cart>pct" && /asks for a line's price/.test(pop.does || "") && pop.chips.includes("why") && pop.chips.includes("deeper"), "on a lesson's drawing a connector's popover says what that step does and why, its ask chips still there", JSON.stringify(pop));
    await p.keyboard.press("Escape"); await p.waitForTimeout(150);
    await tap(p, '[data-region="t2-2"] [data-step-pick="1"]'); await p.waitForTimeout(250); const ls = await illus(p, "t2-2");
    ok(ls?.of === "1" && ls.focus === "cart>pct" && ls.zoomed && /Each line of the cart/.test(ls.detail || ""), "a lesson's step picked zooms its chapter's drawing to that step, its detail under it", JSON.stringify(ls));
    await tap(p, '[data-region="t2-2"] [data-step-pick="2"]'); await p.waitForTimeout(250); const cited = await illus(p, "t2-2");
    const keeps = await p.evaluate(() => !!document.querySelector('[data-region="t2-3"] [data-report-figure="B2-2"]'));
    ok(cited?.of === "2" && cited.type === "states" && keeps, "a lesson's step that cites another chapter's drawing shows it, and that chapter keeps its own", JSON.stringify({ cited, keeps }));
    await fly(p, "t2-3"); const why = await p.evaluate(() => document.querySelector('[data-region="t2-3"] [data-transition-why]')?.textContent || null);
    ok(/Priced once, before it is shown/.test(why || ""), "a lifecycle's transition says why it is built that way beside what it writes", JSON.stringify(why));
    await fly(p, "t2"); const txt = await p.evaluate(() => { const r = document.querySelector('[data-region="t2"]'); return r && { illus: !!r.querySelector(".rb-illus"), solo: !!r.querySelector(".rb-split.solo"), nums: r.querySelectorAll("[data-step-pick]").length }; });
    ok(txt && !txt.illus && txt.solo && txt.nums === 2, "a text chapter with no drawing and no step picture stays one column of numbered steps", JSON.stringify(txt));
    await ctx.close(); }
  // ---------- a lesson kept without some chapters (the tutor left them out after Studio's follow-ups): marked incomplete, naming them ----------
  { const gapped = () => { const r = ROOM(); r.turns = r.turns.map((t) => t.n === 2 ? { ...t, gaps: ["change", "sequence"], jobs: ["J1", "J2", "J3"], cost: { usd: 0.3 } } : t); return r; };
    const note = (p) => p.evaluate(() => { const x = document.querySelector('[data-region="t2"] [data-lesson-gaps]'); return x && { gaps: x.dataset.lessonGaps, text: x.textContent, shown: x.getBoundingClientRect().height > 0, all: document.querySelectorAll("[data-lesson-gaps]").length }; });
    let { ctx, p } = await open(1440, gapped()); await fly(p, "t2"); const en = await note(p); await p.screenshot({ path: join(shots, "lesson-gaps-1440.png") }); await ctx.close();
    ({ ctx, p } = await open(1440, gapped(), { lang: "zh-TW" })); await fly(p, "t2"); const zh = await note(p); await ctx.close();
    ({ ctx, p } = await open(1440, ROOM())); await fly(p, "t2"); const none = await note(p), any = await p.evaluate(() => document.querySelectorAll("[data-lesson-gaps]").length); await ctx.close();
    const busy = gapped(); busy.turns = busy.turns.map((t) => t.n === 2 ? { ...t, status: "running" } : t); busy.running = 2;
    ({ ctx, p } = await open(1440, busy)); const whileRunning = await p.evaluate(() => document.querySelectorAll("[data-lesson-gaps]").length); await ctx.close();
    ok(whileRunning === 0, "while its follow-ups run, a lesson is not yet called incomplete", String(whileRunning));
    ok(en?.shown && en.gaps === "change sequence" && en.all === 1 && en.text === "Incomplete: missing The change itself; One request, in order" && zh?.shown && zh.text === "不完整：缺少 改了什麼、一次請求的順序" && !none && any === 0,
      "a lesson kept with gaps says so over its first chapter, naming the missing chapters (en and zh); a complete lesson shows no such note", JSON.stringify({ en, zh, none, any })); }
  // ---------- a tutor's own figure: its connectors are wide click targets too; a zoom finds a part inside a moved group;
  //            the play bar's last dot picks the last step ----------
  { const { ctx, p } = await open(1440, ROOM()); await fly(p, "t4");
    const hit = await p.evaluate(() => !!document.querySelector('[data-region="t4"] [data-visual] [data-edge-hit="x>y"]'));
    await click(p, '[data-region="t4"] [data-visual] [data-edge-hit="x>y"]'); await p.waitForTimeout(200);
    const e4 = await p.evaluate(() => document.querySelector('[data-region="t4"] [data-explain="x>y"] [data-explain-does]')?.textContent || null);
    ok(hit && /Passes the order on/.test(e4 || ""), "a connector of a figure the tutor drew has a wide click target and opens its explanation", JSON.stringify({ hit, e4 }));
    await p.keyboard.press("Escape"); await tap(p, '[data-region="t4"] [data-step-pick="2"]'); await p.waitForTimeout(250); const z = await illus(p, "t4"), vb = (z?.vb || "").split(/[ ,]+/).map(Number);
    ok(z?.zoomed && vb[0] > 100 && z.focused.includes("y"), "a step's zoom finds its part inside a group moved by a transform", JSON.stringify(z));
    await fly(p, "t1"); await p.$eval('[data-playbar] [data-dot$=":3"]', (e) => e.click()).catch(() => {}); await p.waitForTimeout(250); const last = await illus(p, "t1");
    // playing one scene leaves the others whole
    await p.$eval("[data-playbar] [data-play]", (e) => e.click()).catch(() => {}); await p.waitForTimeout(150); const other = await illus(p, "t3"); await p.$eval("[data-playbar] [data-play]", (e) => e.click()).catch(() => {});
    ok(other?.of === "all", "playing one scene changes no other card's step", JSON.stringify(other));
    ok(last?.of === "3" && /Read it on GitHub/.test(last.detail || ""), "the play bar's last dot picks the last step: its picture and detail show", JSON.stringify(last));
    await ctx.close(); }
  // ---------- the vendor's voice played from a dot picked before: at its end the illustration is the last step, not that dot's ----------
  { const { ctx, p } = await open(1440, { ...ROOM(), offer: { ...OFFER, voice: "openai" } }, { vendor: true }); await fly(p, "t1");
    await p.$eval('[data-playbar] [data-dot$=":1"]', (e) => e.click()).catch(() => {}); await p.waitForTimeout(200); const picked = await illus(p, "t1");
    await p.$eval("[data-playbar] [data-play]", (e) => e.click()).catch(() => {}); await p.waitForFunction(() => !!window.__audio, null, { timeout: 3000 }).catch(() => {});
    await p.evaluate(() => { const a = window.__audio; if (!a) return; a.duration = 10; a.currentTime = 10; a.ontimeupdate?.(); }); await p.waitForTimeout(250); const end = await illus(p, "t1");
    ok(picked?.of === "1" && end?.of === "3" && /Read it on GitHub/.test(end.detail || ""), "the vendor's voice started after a dot was picked: when it reaches the last point the illustration shows the last step, not the dot picked before", JSON.stringify({ picked: picked?.of, end: end?.of }));
    await ctx.close(); }
  // ---------- an older answer: code is never the picture; with no pull request on GitHub its link opens the citation panel ----------
  { const { ctx, p } = await open(1440, ROOM(null)); await fly(p, "t3");
    const old = await illus(p, "t3"); await tap(p, '[data-region="t3"] [data-code-ref]'); await p.waitForTimeout(250);
    const panel = await p.evaluate(() => ({ ref: document.querySelector("[data-cite-panel]")?.dataset.citePanel, lines: document.querySelectorAll("[data-cite-panel] [data-line]").length }));
    ok(old && old.code === 0 && old.visual !== "B3-1" && JSON.stringify(old.refs) === '[["diff:src/percent.ts:L2-2","panel"]]' && panel.ref === "board:B3-1" && panel.lines === 1, "an older answer whose picture was code renders with Studio's picture; its code opens in the citation panel", JSON.stringify({ old, panel }));
    await ctx.close(); }
  // ---------- a phone: the illustration on top, the steps under it ----------
  for (const dark of [false, true]) {
    const { ctx, p } = await open(390, ROOM(), { dark }); await tap(p, "[data-board-rail] .rb-sheetx"); await fly(p, "t1");
    const s = await sides(p, "t1"), wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(s && s.illusTop < s.stepsTop && wide <= 0, `${dark ? "dark" : "light"} phone: the illustration on top, the numbered steps under it, nothing wider than the screen`, JSON.stringify({ s, wide }));
    await p.screenshot({ path: join(shots, `answer-${dark ? "dark" : "light"}-390.png`) });
    await ctx.close(); }
} catch (e) { fail++; console.log(`  FAIL  the suite crashed: ${e.stack || e}`); }
ok(!errors.length, "no page errors", errors.join(" | "));
await browser.close(); app.kill();
console.log(`\nreview-room-steps-ui: ${pass} passed, ${fail} failed`);
if (fail) { console.log(appLog.slice(-1500)); process.exit(1); }
process.exit(0);
