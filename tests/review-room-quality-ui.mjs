import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Quality, not size caps (docs/units/review-room.md, "Short on the board, long in the body" and "A lesson's rounds"): every
// scene keeps its short title and points as the board's glanceable layer and carries its full explanation as a markdown body,
// folded under its points, opened with a click, kept open across redraws and there again after a reload; a drawing far larger
// than the old caps (a 16-actor, 80-step sequence; a 48-node, 96-edge architecture; a 40-state, 80-transition lifecycle) is
// laid out whole at a legible size, its region widened rather than the drawing shrunk or cut; a lesson that stopped before
// its tutor said it is complete says why. The room's routes are answered by the test: nothing paid runs.
//                                                                                         node tests/review-room-quality-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-quality-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-quality-ui-")), data = join(tmp, "data"); mkdirSync(data);
const port = await freePort();
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
const shots = process.env.QUALITY_SHOTS || join(root, "tests/out/review-room-quality"); mkdirSync(shots, { recursive: true });
const H = "a".repeat(40), B = "b".repeat(40);
const ok1 = (ref) => ({ ref, ok: true });
const cl = (text, cites = [], more = {}) => ({ text, kind: "claim", basis: cites.some((c) => c.ok) ? "cited" : "inference", cites, ...more });
const OFFER = { provider: "codex", model: "gpt-6", effort: "high", paid: true, independence: { level: "vendor", adaptive: false, en: "Different vendor from the author.", zh: "和作者不同供應商。" }, hash: "feedc0ffee123456" };
const ACTIONS = [["how", "How?", "怎麼運作？"], ["why", "Why?", "為什麼？"], ["teach", "Teach me", "教我"], ["quiz", "Quiz", "考我"]].map(([id, en, zh]) => ({ id, en, zh }));
// drawings far over the old caps (actors 6, steps 16, nodes 12, edges 20, states 10, transitions 16)
const ACTORS = Array.from({ length: 16 }, (_, i) => `svc-${i + 1}`);
const SEQ = { id: "B1-1", turn: 1, type: "sequence", title: "One checkout, every hop", actors: ACTORS, basis: "cited", cites: [ok1("diff:src/checkout.ts")],
  steps: Array.from({ length: 80 }, (_, i) => ({ from: ACTORS[i % 16], to: ACTORS[(i * 5 + 3) % 16], label: `call ${i + 1}`, kind: i % 3 === 2 ? "return" : "call", ...(i >= 20 && i < 26 ? { frame: "loop", frameLabel: "retry" } : {}) })) };
const ARCH = { id: "B2-1", turn: 2, type: "arch", title: "The whole system", inferred: true, basis: "cited", cites: [ok1("diff:src/checkout.ts")],
  nodes: Array.from({ length: 48 }, (_, i) => ({ id: `n${i}`, label: `part ${i + 1}`, kind: ["service", "store", "queue", "external"][i % 4], mark: i % 9 === 0 ? "new" : null })),
  edges: Array.from({ length: 96 }, (_, i) => ({ from: `n${i % 48}`, to: `n${(i % 48 + (i < 48 ? 1 : 7)) % 48}`, label: i % 6 ? "" : `e${i}` })) };
const STATES = { id: "B2-2", turn: 2, type: "states", title: "An order's whole life", entity: "orders.status", basis: "cited", cites: [ok1("diff:src/checkout.ts")],
  states: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, label: `state ${i + 1}`, ...(i % 11 === 0 ? { mark: "new" } : {}) })),
  transitions: Array.from({ length: 80 }, (_, i) => ({ from: `s${i % 40}`, to: `s${i < 40 ? (i + 1) % 40 : (i % 40 + 13) % 40}`, label: `t${i + 1}`, cite: ok1("diff:src/checkout.ts") })) };
const BODY = ["### How a checkout moves", "", "The cart hands the order to **checkout**, which prices it once [diff:src/checkout.ts] and then calls `reserve()` on every warehouse in turn.",
  "", "- a retry runs at most three times", "- a refusal ends the checkout, nothing reserved", "", "```", "reserve(order) -> ok | refused", "```", "",
  ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: the edge case where a warehouse answers late is handled by the timeout,\nand the order stays priced, never charged twice [diff:src/checkout.ts].\n`)].join("\n");
const ROOM = () => ({ card: { id: "SC-91", run: "R-091", node: "merge-card", title: { en: "Merge: Rework checkout", "zh-TW": "合併：重寫結帳" }, status: "open" }, task: { id: "R-091", title: "Rework checkout" },
  pr: { id: 9, url: "https://github.com/fixture/shop/pull/9" }, head: H, base: B, open: true, running: null, offer: OFFER, actions: ACTIONS, autoTeach: { on: true }, lessonRounds: 12,
  board: [SEQ, ARCH, STATES],
  turns: [
    { n: 1, action: "how", text: "How does checkout work now?", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "x", head: H, claims: [cl("x")],
      scenes: [{ n: 1, title: "Every hop of a checkout", picture: "B1-1", body: BODY, bodyCites: [ok1("diff:src/checkout.ts")], points: [cl("Sixteen services take part [diff:src/checkout.ts].", [ok1("diff:src/checkout.ts")], { focus: ["step:1"] }), cl("A retry loops at most three times.")] }] },
    { n: 2, action: "teach", text: "Teach me this change.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "y", head: H, claims: [cl("y")], jobs: ["J1", "J2", "J3", "J4", "J5"], stopped: "no-progress",
      scenes: [{ n: 1, chapter: "what", title: "A checkout rework", picture: "", body: "It moves pricing **before** reservation [diff:src/checkout.ts].\n\nBefore, a price could change after stock was held.", bodyCites: [ok1("diff:src/checkout.ts")], points: [cl("It reworks checkout [diff:src/checkout.ts].", [ok1("diff:src/checkout.ts")]), cl("Pricing comes first.")] },
        { n: 2, chapter: "talks", title: "What talks to what", picture: "B2-1", points: [cl("Forty-eight parts [diff:src/checkout.ts].", [ok1("diff:src/checkout.ts")]), cl("Ninety-six links.")] },
        { n: 3, chapter: "lifecycle", title: "An order's life", picture: "B2-2", body: "Forty states, each transition cited [diff:src/checkout.ts].", bodyCites: [ok1("diff:src/checkout.ts")], points: [cl("Forty states [diff:src/checkout.ts].", [ok1("diff:src/checkout.ts")]), cl("Eighty transitions.")] }] }],
  tutors: [], sources: [], notes: [], lesson: { threads: [], visited: ["t2", "t2-2", "t2-3", "end"] }, check: { questions: [] },
  diffstat: { files: [{ path: "src/checkout.ts", added: 40, removed: 12 }], total: { files: 1, added: 40, removed: 12 }, from: "git" } });
// the voice: a stand-in (headless Chromium's own speech crashes the page)
const stubs = () => { const v = [{ name: "Ava (Premium)", lang: "en-US", localService: true, voiceURI: "ava" }];
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => v, speak: (u) => setTimeout(() => u.onend && u.onend(), 5), cancel: () => {} } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; }; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; };
async function open(width, o = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: o.dark ? "dark" : "light", reducedMotion: "reduce" });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [o.lang || "en"]);
  await ctx.addInitScript(stubs);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/api\/remote\/me$/, (r) => r.fulfill({ json: { kind: width < 600 ? "phone" : "desktop", device: null } }));
  const S = { posts: [] };
  await ctx.route(/\/api\/review-room\/SC-91(\?open=1)?$/, (r) => r.fulfill({ json: o.room || ROOM() }));
  await ctx.route(/\/api\/review-room\/SC-91\/(lesson|turn|arrive)$/, (r) => { S.posts.push(r.request().url()); r.fulfill(/lesson$/.test(r.request().url()) ? { json: { visited: [] } } : { status: 409, json: { error: "confirm", code: "confirm_required", offer: OFFER } }); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e.message}`));
  await p.goto(`${base}/#/room/SC-91`); await p.waitForSelector("#view .rr-room", { timeout: 15000 }); await p.waitForTimeout(500);
  return { ctx, p, S };
}
const tap = (p, sel, o = {}) => p.click(sel, { timeout: 2500, ...o }).catch(() => {});
const fly = async (p, key) => { await tap(p, `[data-outline="${key}"]`); await p.waitForTimeout(550); };
/** a scene's body as the board shows it */
const body = (p, key) => p.evaluate((k) => { const d = document.querySelector(`[data-region="${k}"] [data-scene-body]`); if (!d) return null; const t = d.querySelector("[data-scene-body-text]"), r = t?.getBoundingClientRect();
  return { open: d.open, summary: d.querySelector("summary")?.textContent || "", shown: !!r && r.height > 0 && d.open, heads: [...(t?.querySelectorAll(".rr-sbody-h") || [])].map((x) => x.textContent), items: t?.querySelectorAll("li").length ?? 0,
    pre: t?.querySelector("pre")?.textContent || "", paras: t?.querySelectorAll("p").length ?? 0, cites: t?.querySelectorAll("[data-cite]").length ?? 0, text: (t?.textContent || "").slice(0, 120), script: !!t?.querySelector("script, [onclick]") }; }, key);
/** a drawing's size on its region (layout pixels, the camera's zoom aside) against its own drawn size, and what it holds */
/** a region on the board: its width, whether its drawing is on screen, its "View drawing" control, a sequence's step list */
const region = (p, key) => p.evaluate((k) => { const reg = document.querySelector(`[data-region="${k}"]`); if (!reg) return null; const rb = reg.querySelector(".rb-rbody"), svg = reg.querySelector(".rb-illus svg, [data-visual] svg"), a = svg?.getBoundingClientRect(), vp = reg.closest("[data-board-vp]").getBoundingClientRect();
  return { w: rb.offsetWidth, onScreen: !!a && a.width > 40 && a.right > vp.left && a.left < vp.right && a.bottom > vp.top && a.top < vp.bottom, view: reg.querySelector("[data-fig-view]")?.textContent || null, steps: reg.querySelectorAll("[data-seq-list] [data-seq-step]").length }; }, key);
/** the drawing viewer: its drawing's size, its labels on screen and their rendered height (font size at the scale shown) */
const viewer = (p) => p.evaluate(() => { const v = document.querySelector("[data-fig-viewer]"); if (!v) return null; const svg = v.querySelector("svg.rr-figview-svg");
  const hs = [...svg.querySelectorAll("text")].map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth).map((r) => r.height).sort((a, b) => a - b);
  return { vbw: svg.viewBox.baseVal.width, shown: hs.length, median: hs[hs.length >> 1] || 0, nodes: svg.querySelectorAll("[data-node]").length, steps: svg.querySelectorAll("[data-step]").length, list: v.querySelectorAll("[data-seq-step]").length, focus: !!document.activeElement?.hasAttribute("data-fig-close"), zoom: v.querySelector("[data-fig-zoom]")?.textContent }; });
const camScale = (p) => p.evaluate(() => { const t = getComputedStyle(document.querySelector("[data-board-plane]")).transform; const m = /matrix\(([^,]+)/.exec(t); return m ? Number(m[1]) : 1; });
const openView = async (p, key) => { await p.evaluate((k) => document.querySelector(`[data-region="${k}"] [data-fig-view]`)?.click(), key); await p.waitForSelector("[data-fig-viewer]", { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(200); };

try {
  // ---------- an answer's full explanation: folded under its points, opened with a click, kept across a redraw and a reload ----------
  { const { ctx, p } = await open(1440); await fly(p, "t1");
    const closed = await body(p, "t1");
    ok(closed && !closed.open && /The full explanation/.test(closed.summary) && / · \d+ words$/.test(closed.summary), "an answer's scene carries its full explanation under its points, folded to one line", JSON.stringify(closed));
    await tap(p, '[data-region="t1"] [data-scene-body-toggle]'); await p.waitForTimeout(300); const opened = await body(p, "t1");
    ok(opened?.shown && JSON.stringify(opened.heads) === '["How a checkout moves"]' && opened.items === 2 && /reserve\(order\) -> ok \| refused/.test(opened.pre) && opened.paras >= 31 && opened.cites >= 31 && !opened.script,
      "opened, the body reads as markdown: its heading, its list, its code block, every paragraph, each citation a chip; nothing of it is markup", JSON.stringify(opened));
    await tap(p, '[data-region="t1"] [data-step-pick="1"]'); await p.waitForTimeout(300); const after = await body(p, "t1");
    ok(after?.open && after.shown, "a step picked (a redraw) leaves the body open", JSON.stringify(after));
    await p.screenshot({ path: join(shots, "body-1440.png") });
    await p.reload(); await p.waitForSelector("#view .rr-room", { timeout: 15000 }); await p.waitForTimeout(500); await fly(p, "t1");
    await tap(p, '[data-region="t1"] [data-scene-body-toggle]'); await p.waitForTimeout(300); const again = await body(p, "t1");
    ok(again?.shown && again.paras === opened.paras && again.cites === opened.cites, "after a reload the body is there again, whole", JSON.stringify(again));
    await ctx.close(); }
  // ---------- a lesson's chapters carry theirs too; a chapter left without one shows none ----------
  { const { ctx, p } = await open(1440); await fly(p, "t2"); const what = await body(p, "t2"), talks = await body(p, "t2-2");
    await tap(p, '[data-region="t2"] [data-scene-body-toggle]'); await p.waitForTimeout(300); const whatOpen = await body(p, "t2");
    ok(what && !what.open && !talks && whatOpen?.shown && /moves pricing before reservation/.test(whatOpen.text) && whatOpen.cites === 1, "a lesson's chapter shows its body the same way; a chapter without one has none", JSON.stringify({ what, talks, whatOpen }));
    const note = await p.evaluate(() => { const x = document.querySelector("[data-lesson-stopped]"); return x && { text: x.textContent, err: x.classList.contains("rr-err"), calm: x.classList.contains("rr-stopnote") }; });
    ok(/Not marked complete by the tutor: stopped after 5 rounds: two rounds in a row added nothing/.test(note?.text || "") && note.calm && !note.err, "a lesson that stopped for no progress says why and after how many rounds, as a note, not an error", JSON.stringify(note));
    await ctx.close(); }
  { const failed = ROOM(); failed.turns[1] = { ...failed.turns[1], stopped: "failed", followUpError: "the vendor went away" };
    const { ctx, p } = await open(1440, { room: failed }); await fly(p, "t2");
    const note = await p.evaluate(() => { const x = document.querySelector("[data-lesson-stopped]"); return x && { text: x.textContent, err: x.classList.contains("rr-err") }; });
    ok(/stopped after 5 rounds: a round failed \(the vendor went away\)/.test(note?.text || "") && note.err, "a lesson ended by a failed round says so, with the error, in red", JSON.stringify(note));
    const { ctx: c2, p: p2 } = await open(1440, { room: failed, lang: "zh-TW" }); await fly(p2, "t2");
    const zh = await p2.evaluate(() => document.querySelector("[data-lesson-stopped]")?.textContent || "");
    ok(/5 回合後停止：有一回合失敗（the vendor went away）/.test(zh), "and in Chinese", zh);
    await fly(p2, "t1"); const zcount = await p2.evaluate(() => document.querySelector('[data-region="t1"] [data-scene-body-toggle]')?.textContent || "");
    ok(/ · \d+ 詞（英文）$/.test(zcount), "a Chinese room counts an English body in words, saying so", zcount); await c2.close();
    await ctx.close(); }
  // ---------- drawings far larger than the old caps: a readable preview in a region of the usual size, its drawing on screen
  //            when the board flies there, and "View drawing" opens it at its own scale, its labels legible ----------
  for (const dark of [false, true]) {
    const tag = dark ? "dark" : "light", { ctx, p } = await open(1440, { dark });
    await fly(p, "t1"); const seq = await region(p, "t1"); await openView(p, "t1"); const sv = await viewer(p);
    ok(seq && seq.w <= 1000 && seq.onScreen && seq.view === "View drawing" && seq.steps === 80, `${tag}: an answer's 16-actor, 80-step sequence is a preview in a card of the usual width, on screen, with “View drawing” and every step listed`, JSON.stringify(seq));
    ok(sv && sv.steps === 80 && sv.shown >= 8 && sv.median >= 11 && sv.focus && sv.zoom === "100%" && sv.list === 80, `${tag}: “View drawing” opens the sequence at its own size: labels on screen at 11px or more, every step listed, the focus on Close`, JSON.stringify(sv));
    await p.screenshot({ path: join(shots, `sequence-view-${tag}-1440.png`) });
    for (let i = 0; i < 9; i++) await p.keyboard.press("Tab");
    const trapped = await p.evaluate(() => !!document.activeElement?.closest("[data-fig-viewer]"));
    ok(trapped, `${tag}: Tab stays inside the viewer while it is open`, String(trapped));
    await p.keyboard.press("Escape"); await p.waitForTimeout(150); const gone = await p.evaluate(() => !document.querySelector("[data-fig-viewer]") && !!document.activeElement?.hasAttribute("data-fig-view"));
    ok(gone, `${tag}: Escape closes the viewer and gives the focus back to “View drawing”`, String(gone));
    await fly(p, "t2-2"); const ar = await region(p, "t2-2"); await p.screenshot({ path: join(shots, `arch-${tag}-1440.png`) }); await openView(p, "t2-2"); const av = await viewer(p);
    ok(ar && ar.w <= 900 && ar.onScreen && ar.view && av && av.nodes === 48 && av.vbw < 3200 && av.shown >= 8 && av.median >= 11, `${tag}: a 48-node, 96-edge architecture: its layers in bands (not one row), a preview on screen in its region, legible in the viewer`, JSON.stringify({ ar, av }));
    await p.screenshot({ path: join(shots, `arch-view-${tag}-1440.png`) }); await p.keyboard.press("Escape");
    await fly(p, "t2-3"); const st = await region(p, "t2-3"); await p.screenshot({ path: join(shots, `states-${tag}-1440.png`) });
    const btn = await p.evaluate(() => { const b = document.querySelector('[data-region="t2-3"] [data-fig-view]'), vp = document.querySelector("[data-board-vp]").getBoundingClientRect(), r = b?.getBoundingClientRect(), list = document.querySelector('[data-region="t2-3"] [data-trans-list]');
      return { inView: !!r && r.width > 0 && r.top >= vp.top && r.bottom <= vp.bottom && r.left >= vp.left && r.right <= vp.right, folded: !!list && !list.open, above: !!r && !!list && r.bottom <= list.getBoundingClientRect().top + 1 }; });
    ok(btn.inView && btn.folded && btn.above, `${tag}: flying to the lifecycle shows “View drawing” right under its preview, in view, above its transition list (folded past 16 rows)`, JSON.stringify(btn));
    await p.evaluate(() => { const sg = document.querySelector('[data-region="t2-3"] svg.rr-preview'), r = sg.getBoundingClientRect(); sg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 })); }); await p.waitForTimeout(250);
    const byClick = await p.evaluate(() => document.querySelector("[data-fig-viewer]")?.getAttribute("data-fig-viewer") || null); await p.keyboard.press("Escape"); await p.waitForTimeout(150);
    ok(byClick === "B2-2", `${tag}: a click on the preview opens the viewer too`, String(byClick));
    await openView(p, "t2-3"); const stv = await viewer(p);
    const rows = await p.evaluate(() => document.querySelectorAll('[data-region="t2-3"] [data-transition-row]').length);
    ok(st && st.w <= 900 && st.onScreen && st.view && stv && stv.nodes === 40 && stv.vbw < 3200 && stv.shown >= 8 && stv.median >= 11 && rows === 80, `${tag}: a 40-state, 80-transition lifecycle: its states in rows (not one row thousands wide), on screen in its region, every transition listed, legible in the viewer`, JSON.stringify({ st, stv, rows }));
    await p.screenshot({ path: join(shots, `states-view-${tag}-1440.png`) }); await p.keyboard.press("Escape");
    await p.evaluate(() => document.querySelector("[data-zoom-fit]")?.click()); await p.waitForTimeout(800); const fs = await camScale(p);
    ok(fs >= 0.1, `${tag}: Fit all keeps the board at its zoom floor or above (regions keep their size)`, String(fs));
    await p.screenshot({ path: join(shots, `fit-all-${tag}-1440.png`) });
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(wide <= 0, `${tag}: the page itself never scrolls sideways`, String(wide));
    await fly(p, "t1"); await openView(p, "t1"); await p.evaluate(() => { location.hash = "#/rooms"; }); await p.waitForTimeout(300);
    const left = await p.evaluate(() => !document.querySelector("[data-fig-viewer]"));
    ok(left, `${tag}: leaving the room closes the viewer`, String(left));
    await ctx.close(); }
  // ---------- narrow screens: the big drawing is a preview whose “View drawing” opens it full screen at its own scale ----------
  for (const width of [760, 390]) {
    const { ctx, p } = await open(width); if (width < 600) await tap(p, "[data-board-rail] .rb-sheetx"); await fly(p, "t1"); await openView(p, "t1"); const v = await viewer(p);
    const fits = await p.evaluate(() => { const r = document.querySelector("[data-fig-viewer]")?.getBoundingClientRect(); return !!r && r.width <= innerWidth + 1 && r.height <= innerHeight + 1; });
    ok(v && v.shown >= 3 && v.median >= 11 && fits, `${width}: the sequence opens full screen at its own scale, labels on screen at 11px or more (vector, not a scaled-up picture)`, JSON.stringify({ v, fits }));
    await p.screenshot({ path: join(shots, `sequence-view-${width}.png`) }); await p.keyboard.press("Escape");
    await fly(p, "t2-3"); await openView(p, "t2-3"); const s2 = await viewer(p);
    ok(s2 && s2.shown >= 3 && s2.median >= 11, `${width}: the lifecycle too`, JSON.stringify(s2));
    await p.screenshot({ path: join(shots, `states-view-${width}.png`) });
    await ctx.close(); }
  // ---------- the confirmation says a lesson goes on until it is complete, with its ceiling, never "one round" alone ----------
  { const { ctx, p } = await open(1440, { room: { ...ROOM(), turns: ROOM().turns.filter((t) => t.action !== "teach") } }); await p.evaluate(() => document.querySelector('[data-room-action="teach"]')?.click()); await p.waitForSelector('[data-room-confirm="teach"]', { timeout: 5000 }).catch(() => {});
    const conf = await p.evaluate(() => [...document.querySelectorAll("[data-room-confirm]")].map((x) => x.textContent).join(" | "));
    ok(/then more paid rounds until the lesson is complete \(it stops when two rounds in a row add nothing, at most 12 rounds\)/.test(conf), "the lesson's confirmation says rounds go on until it is complete, stopping at no progress or the ceiling", conf.slice(0, 600));
    await ctx.close(); }
  // ---------- a phone: the body still opens, nothing wider than the screen ----------
  { const { ctx, p } = await open(390); await tap(p, "[data-board-rail] .rb-sheetx"); await fly(p, "t1");
    await p.evaluate(() => document.querySelector('[data-region="t1"] [data-scene-body-toggle]')?.click()); await p.waitForTimeout(300); const b = await body(p, "t1"), wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(b?.shown && wide <= 0, "on a phone the body opens too, nothing wider than the screen", JSON.stringify({ b, wide }));
    await ctx.close(); }
} catch (e) { fail++; console.log(`  FAIL  the suite crashed: ${e.stack || e}`); }
ok(!errors.length, "no page errors", errors.join(" | "));
await browser.close(); app.kill();
console.log(`\nreview-room-quality-ui: ${pass} passed, ${fail} failed`);
if (fail) { console.log(appLog.slice(-1500)); process.exit(1); }
process.exit(0);
