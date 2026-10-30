import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The lesson board on the page (public/review-board.js, docs/units/review-room.md "The lesson board"), with real DOM geometry:
// a finished lesson is a canvas the camera owns (the viewport never scrolls itself); every chapter a region with its content
// and drawings; three levels of detail (far: only each chapter's number, title, one line and its question counts); "Next"
// frames each chapter at a readable scale (0.85 or more at 1440); a chapter not reached yet is a placeholder; every place
// asks through a popover inside the screen; a question waits in its card for the paid round's confirmation and is sent with
// the room's offer; its answer streams into its card ("Thinking"); a follow-up goes below or beside, a rephrasing is a
// version tab; show the code is free; understood folds a thread; focus frames it and Escape returns; tidying folds the
// understood questions into their chapter and before / after shows the original; nothing overlaps; pins sit on their place;
// the keyboard drives it; a phone opens on the outline and asks in a bottom sheet; a Library snapshot replays it read-only.
// The room's routes are answered by the test from an invented lesson: nothing paid runs.     node tests/review-room-board-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { boardRoom } from "./lib/review-board-fixture.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-board-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-board-ui-")), data = join(tmp, "data"); mkdirSync(data);
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
const shots = process.env.BOARD_SHOTS || join(root, "tests/out/review-board"); mkdirSync(shots, { recursive: true });
const errors = [];
const ID = "SC-60", DIFF = "@@ -38,6 +40,13 @@\n-  if (age(p) > EXPIRE_AFTER) await expire(p);\n+  if (age(p) > EXPIRE_AFTER) {\n+    const r = await gateway.getCharge(p.ref);\n+    if (r.status === 'paid') return settle(p, 'recheck');\n+    await expire(p);\n+  }";
const clone = (x) => JSON.parse(JSON.stringify(x));

/** a page on the board: the room's routes answered from the fixture; what the page sends kept */
async function open(width, lang = "zh-TW", o = {}) {
  const phone = width < 600, ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: o.dark ? "dark" : "light", reducedMotion: "reduce" });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed"));
    // speech, stubbed (headless Chromium has none)
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak: () => {}, cancel: () => {} } }); window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; }, [lang]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const S = { room: o.room ?? boardRoom(lang), turns: [], lessons: [], cites: [] };
  await ctx.route(/\/api\/review-room\/SC-60(\?open=1)?$/, (r) => r.fulfill({ json: S.room }));
  await ctx.route(/\/api\/review-room\/SC-60\/cite\?/, (r) => { S.cites.push(new URL(r.request().url()).searchParams.get("ref")); r.fulfill({ json: { kind: "diff", path: "src/recheck.ts", from: 40, to: 52, head: "a".repeat(40), text: DIFF } }); });
  await ctx.route(/\/api\/review-room\/SC-60\/turn$/, async (r) => { const b = JSON.parse(r.request().postData() || "{}"); S.turns.push(b);
    if (b.confirm !== S.room.offer.hash) return r.fulfill({ status: 409, json: { error: "confirm it", code: "confirm_required", offer: S.room.offer } });
    // Studio's answer to a confirmed question: a running turn and its card (src/domain/review-room.ts applyThread)
    const room = clone(S.room), n = room.turns.length + 1, L = room.lesson, th = b.thread;
    let t = th.n != null ? L.threads.find((x) => x.n === th.n) : null; const now = "t";
    if (!t) { const a = th.anchor, ch = room.turns[0].scenes[a.scene === "t1" ? 0 : Number(a.scene.split("-")[1]) - 1].chapter, key = `${ch}/${a.scene}/${a.kind}${a.item ? `/${a.item}` : ""}${a.part ? `#${a.part}` : ""}`;
      t = { n: Math.max(0, ...L.threads.map((x) => x.n)) + 1, key, anchor: { ...a, turn: 1, chapter: ch }, locator: { type: "text", section: key }, nodes: [], state: "open", at: now, resolvedAt: null, merged: null }; L.threads.push(t); }
    const parent = th.node ? t.nodes.find((x) => x.id === th.node) : null; let node;
    if (!parent) { node = { id: "n1", parent: null, rel: "root", chip: th.chip, q: th.q ?? null, versions: [n], code: null, at: now }; t.nodes.push(node); }
    else if (th.chip === "rephrase") { parent.versions.push(n); node = parent; }
    else { node = { id: `n${t.nodes.length + 1}`, parent: parent.id, rel: th.chip === "example" ? "side" : "below", chip: th.chip, q: th.q ?? null, versions: [n], code: null, at: now }; t.nodes.push(node); }
    room.turns.push({ n, action: "ask", text: "q", lang, status: "running", provider: "codex", model: "gpt-6", answer: "", head: "a".repeat(40), thread: { n: t.n, node: node.id } });
    room.running = n; room.progress = { turn: n, status: "running", said: o.said ?? "Reading src/recheck.ts to see when it asks again", tools: 2, at: null };
    S.room = room; r.fulfill({ json: room }); });
  await ctx.route(/\/api\/review-room\/SC-60\/lesson$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); S.lessons.push(b); const room = clone(S.room), L = room.lesson;
    if (b.op === "visit") { if (!L.visited.includes(b.scene)) L.visited.push(b.scene); S.room = room; return r.fulfill({ json: { visited: L.visited } }); }
    if (b.op === "resolve") { const t = L.threads.find((x) => x.n === b.n); t.state = b.on === false ? "open" : "resolved"; S.room = room; return r.fulfill({ json: room }); }
    if (b.op === "code") { let t = b.n != null ? L.threads.find((x) => x.n === b.n) : null; const a = b.anchor;
      if (!t) { const key = `${room.turns[0].scenes[a.scene === "t1" ? 0 : Number(a.scene.split("-")[1]) - 1].chapter}/${a.scene}/${a.kind}${a.item ? `/${a.item}` : ""}${a.part ? `#${a.part}` : ""}`; t = L.threads.find((x) => x.key === key);
        if (!t) { t = { n: Math.max(0, ...L.threads.map((x) => x.n)) + 1, key, anchor: { ...a, turn: 1, chapter: key.split("/")[0] }, locator: { type: "text", section: key }, nodes: [], state: "open", at: "t", resolvedAt: null, merged: null }; L.threads.push(t); } }
      const root = t.nodes.find((x) => x.rel === "root"); t.nodes.push(root ? { id: `n${t.nodes.length + 1}`, parent: root.id, rel: "below", chip: "code", q: null, versions: [], code: b.ref, at: "t" } : { id: "n1", parent: null, rel: "root", chip: "code", q: null, versions: [], code: b.ref, at: "t" });
      S.room = room; return r.fulfill({ json: room }); }
    if (b.op === "tidy") { let merged = 0; for (const t of L.threads) if (t.state === "resolved" && !t.merged) { const tn = room.turns.find((x) => x.n === t.nodes[0].versions.at(-1)); t.merged = { at: "t", gist: tn.claims[0].text, cites: tn.claims[0].cites }; merged++; }
      S.room = room; return r.fulfill({ json: { merged, open: L.threads.filter((t) => t.state === "open").length, view: room } }); }
    r.fulfill({ status: 400, json: { error: "op" } }); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e.message}`));
  await p.goto(`${base}/#/room/${o.id ?? ID}`); await p.waitForSelector("[data-board-vp]", { timeout: 15000 }); await p.waitForTimeout(300);
  return { ctx, p, S };
}
const cam = (p) => p.evaluate((id) => window.crewReviewRoom.board.camOf(id), ID);
const settle = (p, ms = 250) => p.waitForTimeout(ms);
/** a request the page sends may wait behind the page's other requests: wait for what the test expects, a while */
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 60)); } return !!(await f()); };
/** the screen boxes of the board's parts */
const geo = (p) => p.evaluate(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const vis = (e) => { const s = getComputedStyle(e); return s.display !== "none" && s.visibility !== "hidden" && e.getClientRects().length > 0; };
  return { vp: r(document.querySelector("[data-board-vp]")), cards: [...document.querySelectorAll(".rb-card, .rb-tchip")].filter(vis).map((e) => ({ id: e.dataset.tcard || `chip${e.dataset.tchip}`, ...r(e) })),
    bodies: [...document.querySelectorAll("[data-region] > .rb-rbody")].map((e) => ({ id: e.parentElement.dataset.region, ...r(e) })), regions: [...document.querySelectorAll("[data-region]")].map((e) => ({ id: e.dataset.region, ...r(e) })) }; });
const hit = (a, b, g = 0) => a.x < b.r + g && a.r + g > b.x && a.y < b.b + g && a.b + g > b.y;

try {
  // ---------- 1440: the board, the camera, the walkthrough ----------
  { const { ctx, p, S } = await open(1440, "zh-TW");
    const base0 = await p.evaluate(() => { const vp = document.querySelector("[data-board-vp]"); vp.scrollTop = 400; vp.scrollLeft = 300; vp.dispatchEvent(new Event("scroll"));
      return { regions: [...document.querySelectorAll("[data-region]")].map((e) => e.dataset.region), chapters: [...document.querySelectorAll("[data-region]")].map((e) => e.dataset.chapter), figures: [...document.querySelectorAll("[data-report-figure]")].map((e) => e.dataset.figureType),
        statemap: document.querySelectorAll("[data-statemap] [data-transition]").length, tx: document.querySelectorAll("[data-tx-panel] [data-tx-table]").length, calls: document.querySelectorAll("[data-calls] [data-call]").length,
        scroll: [vp.scrollTop, vp.scrollLeft], page: document.documentElement.scrollHeight - innerHeight, wide: document.documentElement.scrollWidth - innerWidth, report: !!document.querySelector(".rr-report") }; });
    ok(JSON.stringify(base0.chapters) === JSON.stringify(["what", "talks", "decisions", "change", "change", "lifecycle", "sequence", "calls", "watch", "questions", "end"]) && JSON.stringify(base0.figures) === JSON.stringify(["arch", "decision", "item", "item", "states", "sequence", "calls"])
      && base0.statemap === 4 && base0.tx >= 1 && base0.calls === 2 && !base0.report,
      "a finished lesson is the board: every chapter a region in its order, with all its drawings (the state map with its transitions and transaction, every call), and a last region for the questions", JSON.stringify(base0));
    ok(base0.scroll[0] === 0 && base0.scroll[1] === 0 && base0.page <= 0 && base0.wide <= 0, "the viewport never scrolls by itself, nor does the page: the camera owns the view", JSON.stringify(base0));
    // the walkthrough frames each chapter at a readable scale
    const c0 = await cam(p), g0 = await geo(p), what = g0.bodies.find((b) => b.id === "t1");
    ok(c0.s >= 0.85 && what.x >= g0.vp.x && what.r <= g0.vp.r && what.y >= g0.vp.y && what.y < g0.vp.b - 100, "the board opens on the first chapter, framed at a readable scale (0.85 or more at 1440) and in view", JSON.stringify({ c0, what, vp: g0.vp }));
    const steps = [];
    for (let i = 0; i < 4; i++) { await p.click("[data-board-next]"); await settle(p); const c = await cam(p), g = await geo(p), cur = await p.$eval("[data-stage]", (e) => e.dataset.scene), b = g.bodies.find((x) => x.id === cur);
      const fs = await p.evaluate((k) => { const el = document.querySelector(`[data-region="${k}"] .rp-card p, [data-region="${k}"] .rp-card li`); return el ? parseFloat(getComputedStyle(el).fontSize) : 0; }, cur);
      steps.push({ cur, s: Math.round(c.s * 100) / 100, fs: Math.round(fs * c.s * 10) / 10, inView: b && b.x >= g.vp.x - 1 && b.x < g.vp.r - 200 && b.y >= g.vp.y && b.y < g.vp.b - 150 }); }
    ok(JSON.stringify(steps.map((x) => x.cur)) === '["t1-2","t1-3","t1-4","t1-5"]' && steps.every((x) => x.s >= 0.85 && x.fs >= 12.5 && x.inView), "“Next” flies to each chapter in order and frames its text at 0.85 or more (12.5px or more on screen), in view", JSON.stringify(steps));
    await p.keyboard.press("n"); await settle(p); const kn = await p.$eval("[data-stage]", (e) => e.dataset.scene); await p.keyboard.press("p"); await p.keyboard.press("ArrowLeft"); await settle(p); const kp = await p.$eval("[data-stage]", (e) => e.dataset.scene);
    await p.keyboard.press("ArrowRight"); await settle(p); const ka = await p.$eval("[data-stage]", (e) => e.dataset.scene);
    ok(kn === "t1-6" && kp === "t1-4" && ka === "t1-5", "n and → step a chapter on, p and ← back", JSON.stringify([kn, kp, ka]));
    // the outline flies there; the chapters read are kept for the room
    await p.click('[data-outline="t1-8"]'); await settle(p);
    const out = await p.evaluate(() => ({ cur: document.querySelector("[data-stage]").dataset.scene, on: document.querySelector('[data-outline="t1-8"]').getAttribute("aria-current"), mm: document.querySelectorAll("[data-minimap] rect.r").length, vw: !!document.querySelector("[data-minimap] rect.vw") }));
    ok(out.cur === "t1-8" && out.on === "true" && out.mm === 11 && out.vw, "an outline click flies to its chapter, marked current; the minimap shows every region and the camera's view", JSON.stringify(out));
    // zoom: the wheel at the pointer, ± and fit all; the levels of detail
    const before = await cam(p), vr = (await geo(p)).vp; await p.mouse.move(vr.x + 300, vr.y + 300); await p.mouse.wheel(0, 500); await settle(p, 120); const wheeled = await cam(p);
    await p.click("[data-zoom-in]"); await settle(p); const plus = await cam(p);
    ok(wheeled.s < before.s && plus.s > wheeled.s && /\d+%/.test(await p.textContent("[data-zoom-pct]")), "the wheel zooms at the pointer, + zooms in, and the zoom shows as a percentage", JSON.stringify([before.s, wheeled.s, plus.s]));
    // drag to pan
    const c1 = await cam(p); await p.mouse.move(vr.x + 500, vr.y + 400); await p.mouse.down(); await p.mouse.move(vr.x + 400, vr.y + 340, { steps: 4 }); await p.mouse.up(); await settle(p, 80); const c2 = await cam(p);
    ok(Math.round(c2.x - c1.x) === -100 && Math.round(c2.y - c1.y) === -60 && !(await p.$(".rb-pop")), "dragging pans the camera by the drag (and asks nothing)", JSON.stringify([c1, c2]));
    // far: the map
    await p.click("[data-zoom-fit]"); await settle(p, 400);
    const far = await p.evaluate(() => { const plane = document.querySelector("[data-board-plane]"), vis = (e) => { const s = getComputedStyle(e); return s.display !== "none" && s.visibility !== "hidden" && e.getClientRects().length > 0; };
      const texts = []; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3 && c.textContent.trim() && c.parentElement && vis(c.parentElement)) texts.push({ t: c.textContent.trim(), map: !!c.parentElement.closest(".rb-map") }); else if (c.nodeType === 1) walk(c); } }; walk(plane);
      const maps = [...plane.querySelectorAll("[data-region]")].map((r) => { const m = r.querySelector(".rb-map"), g = m.querySelector("[data-map-gist]"), lh = parseFloat(getComputedStyle(g).lineHeight);
        return { id: r.dataset.region, kids: [...m.children].map((c) => c.className), oneLine: g.getBoundingClientRect().height <= lh * 1.25 * (r.getBoundingClientRect().width / r.offsetWidth) + 1, open: m.querySelector(".rb-badge.q")?.textContent, done: m.querySelector(".rb-badge.ok")?.textContent }; });
      return { lod: plane.dataset.lod, out: texts.filter((x) => !x.map).map((x) => x.t).slice(0, 8), maps, cards: [...plane.querySelectorAll(".rb-card,.rb-tchip,.rb-pin,.rb-rtitle")].filter(vis).length, links: vis(plane.querySelector("[data-board-links]")) }; });
    ok(far.lod === "far" && far.out.length === 0 && far.cards === 0 && !far.links && far.maps.every((m) => JSON.stringify(m.kids) === JSON.stringify(["rb-mn", "rb-mt", "rb-mg", "rb-mq"]) && m.oneLine),
      "far away (fit all) each chapter shows only its number, its title, one line and its question badges: no text, card, pin or line besides", JSON.stringify(far).slice(0, 900));
    const t1 = far.maps.find((m) => m.id === "t1"), t5 = far.maps.find((m) => m.id === "t1-5"), end = far.maps.find((m) => m.id === "end");
    ok(/未解 1/.test(t1.open) && /懂了 0/.test(t1.done) && /未解 0/.test(t5.open) && /懂了 1/.test(t5.done) && /未解 2/.test(end.open), "the map's badges count each chapter's open and understood questions", JSON.stringify([t1, t5, end]));
    await p.screenshot({ path: join(shots, "desktop-light-map.png") });
    // mid: the cards say what was asked and the answer's first lines, without their actions
    await p.click('[data-outline="t1"]'); await settle(p); const vc = (await geo(p)).vp; await p.mouse.move(vc.x + vc.w / 2, vc.y + vc.h / 2);
    for (let i = 0; i < 6 && (await cam(p)).s > 0.6; i++) { await p.click("[data-zoom-out]"); await settle(p, 60); }
    const mid = await p.evaluate(() => ({ lod: document.querySelector("[data-board-plane]").dataset.lod, acts: [...document.querySelectorAll(".rb-card .rb-acts")].filter((e) => getComputedStyle(e).display !== "none").length, cards: [...document.querySelectorAll(".rb-card")].filter((e) => e.getClientRects().length).length }));
    ok(mid.lod === "mid" && mid.acts === 0 && mid.cards > 0, "in between (mid) the cards stay, short, without their actions", JSON.stringify(mid));
    await ctx.close(); }

  // ---------- 1440: nothing overlaps, pins on their place, the popover, asking, follow-ups, the code, understood, focus, tidy ----------
  { const { ctx, p, S } = await open(1440, "zh-TW");
    await p.click('[data-outline="t1"]'); await settle(p);
    // every region read: nothing overlaps anywhere on the board
    const all = await p.evaluate(() => { const B = window.crewReviewRoom.board; return true; });
    const g = await geo(p), bad = [];
    for (let i = 0; i < g.cards.length; i++) { for (let j = i + 1; j < g.cards.length; j++) if (hit(g.cards[i], g.cards[j])) bad.push(`${g.cards[i].id}×${g.cards[j].id}`); for (const b of g.bodies) if (hit(g.cards[i], b)) bad.push(`${g.cards[i].id}×${b.id}`); }
    for (let i = 0; i < g.regions.length; i++) for (let j = i + 1; j < g.regions.length; j++) if (hit(g.regions[i], g.regions[j])) bad.push(`${g.regions[i].id}×${g.regions[j].id}`);
    ok(all && g.cards.length >= 5 && !bad.length, "no question's card overlaps another card or any region, and no region overlaps another", JSON.stringify({ n: g.cards.length, bad }));
    const pins = await p.evaluate(() => [...document.querySelectorAll(".rb-pin[data-pin-for]")].map((pin) => { const a = document.querySelector(`[data-akey="${CSS.escape(pin.dataset.pinFor)}"]`), pr = pin.getBoundingClientRect(), cx = pr.left + pr.width / 2, cy = pr.top + pr.height / 2;
      const rs = a ? [...a.getClientRects()] : [], on = rs.some((r) => cx >= r.left - 14 && cx <= r.right + 14 && cy >= r.top - 18 && cy <= r.bottom + 14); return { key: pin.dataset.pinFor, n: pin.dataset.pin, on, inside: !!a?.contains(pin) }; }));
    ok(pins.length === 4 && pins.every((x) => x.on) && pins.some((x) => x.inside) && pins.some((x) => !x.inside), "each question's numbered pin sits on its place: inside a sentence, at a drawing's part", JSON.stringify(pins));
    // the anchor's card branches beside it, joined to it
    const near = await p.evaluate(() => { const a = document.querySelector('[data-akey="what/t1/sentence#p0.s1"]').getBoundingClientRect(), c = document.querySelector('[data-tcard="1:n1"]').getBoundingClientRect(), ex = document.querySelector('[data-tcard="1:n2"]').getBoundingClientRect();
      return { right: c.left > a.right, level: Math.abs(c.top - a.top) < 60, side: ex.left > c.right && Math.abs(ex.top - c.top) < 4, line: document.querySelectorAll('[data-board-links] path[data-link="1"]').length }; });
    ok(near.right && near.level && near.side && near.line >= 2, "a question's card branches right beside its place, joined by a line; its example sits beside it", JSON.stringify(near));
    await p.screenshot({ path: join(shots, "desktop-light-chapter.png") });
    // the popover: inside the screen, its chips and the free question
    const s1 = await p.$('[data-akey="what/t1/sentence#p1.s0"]'); const b1 = await s1.boundingBox(); await p.mouse.click(b1.x + b1.width - 4, b1.y + b1.height - 3); await p.waitForSelector(".rb-pop");
    const pop = await p.evaluate(() => { const r = document.querySelector(".rb-pop").getBoundingClientRect(); return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, chips: [...document.querySelectorAll(".rb-pop [data-chip]")].map((b) => b.textContent), input: !!document.querySelector(".rb-pop [data-pop-input]"), modal: !!document.querySelector("[data-room-confirm]"), focus: document.activeElement?.dataset?.chip ?? null }; });
    ok(pop.inside && JSON.stringify(pop.chips) === JSON.stringify(["更深 ↓", "例子 →", "換個說法", "為什麼", "看程式碼"]) && pop.input && !pop.modal && pop.focus === "deeper", "a click on a sentence opens its popover inside the screen: 更深 ↓, 例子 →, 換個說法, 為什麼, 看程式碼 and a question of one's own", JSON.stringify(pop));
    // a popover near the screen's right and bottom edges stays inside it
    const edge = await p.evaluate(() => { const B = window.crewReviewRoom.board.state, a = document.querySelector('[data-akey="what/t1/sentence#p0.s0"]'); B.pop = null; a.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: innerWidth - 20, clientY: innerHeight - 20 })); return true; });
    await settle(p, 120); const pr2 = await p.evaluate(() => { const r = document.querySelector(".rb-pop").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, W: innerWidth, H: innerHeight }; });
    ok(edge && pr2.l >= 0 && pr2.t >= 0 && pr2.r <= pr2.W && pr2.b <= pr2.H, "a popover opened at the screen's corner is moved inside it", JSON.stringify(pr2));
    await p.keyboard.press("Escape"); await settle(p, 80);
    ok(!(await p.$(".rb-pop")) && await p.evaluate(() => document.activeElement?.dataset?.akey === "what/t1/sentence#p0.s0"), "Escape closes the popover and gives the focus back to the place");
    // asking: the question waits in its card for the confirmation, inline; nothing is sent before it
    await p.mouse.click(b1.x + 8, b1.y + 6); await p.waitForSelector(".rb-pop"); await p.click('.rb-pop [data-chip="deeper"]'); await p.waitForSelector("[data-pending]");
    const pend = await p.evaluate(() => { const a = document.querySelector('[data-akey="what/t1/sentence#p1.s0"]').getBoundingClientRect(), c = document.querySelector("[data-pending]").getBoundingClientRect(); return { text: document.querySelector("[data-board-confirm]")?.textContent, right: c.left > a.right, modal: !!document.querySelector("[data-room-confirm], [role=dialog][aria-modal=true]"), pop: !!document.querySelector(".rb-pop") }; });
    ok(S.turns.length === 0 && /付費的模型執行：codex · gpt-6（high）/.test(pend.text) && pend.right && !pend.modal && !pend.pop, "a paid chip asks for the round's confirmation inside the new card beside its place, not as a modal; nothing is sent yet", JSON.stringify(pend));
    await p.click("[data-board-start]"); await p.waitForSelector("[data-thinking]", { timeout: 15000 }).catch(() => {});
    const sent = S.turns.at(-1), think = await p.evaluate(() => ({ thinking: document.querySelector("[data-thinking]")?.textContent, said: document.querySelector("[data-streaming]")?.textContent, card: document.querySelector("[data-thinking]")?.closest("[data-tcard]")?.dataset.tcard }));
    ok(sent?.confirm === "feedc0ffee654321" && sent.thread?.chip === "deeper" && sent.thread.anchor?.scene === "t1" && sent.thread.anchor.kind === "sentence" && sent.thread.anchor.part === "p1.s0" && /同一筆付款只結算一次/.test(sent.thread.anchor.text) && !sent.action,
      "confirmed, the question is sent as the room's paid turn with the room's offer and the place (scene, kind, part, its words)", JSON.stringify(sent));
    ok(think.thinking === "思考中" && /Reading src\/recheck\.ts/.test(think.said || "") && think.card === "5:n1", "while the tutor works, its card says 思考中 and streams what it has said so far", JSON.stringify(think));
    // the answer arrives (the room's poll): text only
    S.room = clone(S.room); const tr = S.room.turns.at(-1); Object.assign(tr, { status: "done", answer: "x", claims: [{ text: "Both paths call settle(), whose CAS lets one win <img src=x onerror=\"window.__pwned=1\"> [diff:src/settle.ts:L8-30].", kind: "claim", basis: "cited", cites: [{ ref: "diff:src/settle.ts:L8-30", ok: true }] }] }); S.room.running = null; S.room.progress = null;
    await p.waitForFunction(() => /CAS lets one win/.test(document.querySelector('[data-tcard="5:n1"]')?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
    const done = await p.evaluate(() => ({ text: document.querySelector('[data-tcard="5:n1"] .rb-cbody')?.textContent, img: !!document.querySelector(".rb-card img"), pwned: !!window.__pwned, cite: !!document.querySelector('[data-tcard="5:n1"] [data-cite="diff:src/settle.ts:L8-30"]') }));
    ok(/CAS lets one win <img src=x/.test(done.text || "") && !done.img && !done.pwned && done.cite, "the answer shows in its card as text (markup stays text), its citation a chip", JSON.stringify(done));
    // follow-ups: an example beside, deeper below, each confirmed in its own card
    await p.click('[data-tcard="5:n1"] [data-follow="example"]'); await p.waitForSelector("[data-pending]");
    const side = await p.evaluate(() => { const a = document.querySelector('[data-tcard="5:n1"]').getBoundingClientRect(), c = document.querySelector("[data-pending]").getBoundingClientRect(); return { beside: c.left > a.right && Math.abs(c.top - a.top) < 4 }; });
    await p.click("[data-board-start]"); await until(() => S.turns.length === 2);
    ok(side.beside && S.turns.at(-1).thread?.n === 5 && S.turns.at(-1).thread.node === "n1" && S.turns.at(-1).thread.chip === "example" && S.turns.at(-1).confirm === "feedc0ffee654321", "例子 → asks in a card beside its parent, then sends the follow-up on that card with the confirmation", JSON.stringify([side, S.turns.at(-1)]));
    Object.assign(S.room.turns.at(-1), { status: "done", claims: [{ text: "Order 7731 at 14:07.", kind: "claim", basis: null, cites: [] }] }); S.room.running = null; S.room = clone(S.room);
    await p.waitForFunction(() => !document.querySelector("[data-thinking]"), null, { timeout: 15000 }).catch(() => {});
    await p.click('[data-tcard="5:n1"] [data-follow="deeper"]'); await p.waitForSelector("[data-pending]");
    const below = await p.evaluate(() => { const a = document.querySelector('[data-tcard="5:n1"]').getBoundingClientRect(), c = document.querySelector("[data-pending]").getBoundingClientRect(); return c.top > a.bottom && Math.abs(c.left - a.left) < 4; });
    await p.click("[data-board-cancel]"); await settle(p, 80);
    ok(below && !(await p.$("[data-pending]")) && S.turns.length === 2, "更深 ↓ asks in a card below its parent; cancelled, nothing is sent", JSON.stringify(below));
    // a rephrasing is a version tab of the same card
    await p.click('[data-outline="t1-5"]'); await settle(p); await p.click('[data-tchip="2"]'); await settle(p, 120);
    const tabs = await p.evaluate(() => [...document.querySelectorAll('[data-tcard="2:n1"] [data-version-tab]')].map((b) => [b.textContent, b.getAttribute("aria-pressed")]));
    await p.click('[data-tcard="2:n1"] [data-version-tab="0"]').catch(() => {});
    const v0 = await p.evaluate(() => document.querySelector('[data-tcard="2:n1"] .rb-cbody')?.textContent || "");
    ok(JSON.stringify(tabs) === '[["1","false"],["2","true"]]' && /兩邊都讀到 version 2/.test(v0), "換個說法 is a version of the same card: tabs 1 and 2, the latest shown, the first one a click away", JSON.stringify([tabs, v0.slice(0, 40)]));
    // show the code: free, no turn
    const turns0 = S.turns.length, tr0 = await p.$('[data-akey="lifecycle/t1-6/transition/B1-5#transition:0"]'); await p.click('[data-outline="t1-6"]'); await settle(p);
    await p.evaluate(() => document.querySelector('[data-akey="lifecycle/t1-6/transition/B1-5#transition:0"]').dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 600, clientY: 400 }))); await p.waitForSelector(".rb-pop");
    await p.click('.rb-pop [data-chip="code"]'); await p.waitForFunction(() => /getCharge/.test(document.querySelector('.rb-card[data-thread="6"][data-chip="code"]')?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
    const code = S.lessons.find((x) => x.op === "code");
    ok(tr0 && S.turns.length === turns0 && code?.ref === "diff:src/pay.ts:L40-58" && code.anchor?.kind === "transition" && code.anchor.part === "transition:0" && S.cites.includes("diff:src/pay.ts:L40-58") && await p.evaluate(() => /getCharge/.test(document.querySelector('.rb-card[data-thread="6"][data-chip="code"]')?.textContent || "")),
      "看程式碼 on a transition is free: no turn, a code card holding its citation, the diff read through the citation viewer", JSON.stringify({ code, cites: S.cites, turns: S.turns.length - turns0, cards: await p.evaluate(() => [...document.querySelectorAll('.rb-card[data-chip="code"]')].map((c) => c.dataset.tcard + ':' + c.textContent.slice(0, 80))) }));
    // understood: folded into a chip
    await p.click('[data-outline="t1"]'); await settle(p); await p.click('[data-tcard="1:n1"] [data-resolve="1"]'); await p.waitForSelector('[data-tchip="1"]', { timeout: 15000 }).catch(() => {});
    ok(S.lessons.some((x) => x.op === "resolve" && x.n === 1) && !(await p.$('[data-tcard="1:n1"]')) && /✓ #1 懂了/.test(await p.textContent('[data-tchip="1"]')), "懂了 ✓ marks the question understood: its cards fold into a chip “✓ #1 懂了”");
    // focus: frame the thread, dim the rest, Escape returns
    await p.click('[data-outline="t1-6"]'); await settle(p); const back = await cam(p); await p.$eval('[data-focus-thread="3"]', (b) => b.click()); await settle(p, 300);
    const foc = await p.evaluate(() => { const vp = document.querySelector("[data-board-vp]").getBoundingClientRect(), op = (e) => parseFloat(getComputedStyle(e).opacity);
      const mine = [...document.querySelectorAll('.rb-card[data-thread="3"]')], others = [...document.querySelectorAll('.rb-card:not([data-thread="3"])')];
      return { bar: document.querySelector("[data-focus-bar]")?.textContent, inView: mine.every((e) => { const r = e.getBoundingClientRect(); return r.left >= vp.left && r.right <= vp.right && r.top >= vp.top && r.bottom <= vp.bottom; }), lit: mine.every((e) => op(e) === 1), dim: others.length > 0 && others.every((e) => op(e) < 0.5) }; });
    await p.screenshot({ path: join(shots, "desktop-light-focus.png") });
    await p.keyboard.press("Escape"); await settle(p, 300); const after = await cam(p);
    ok(/聚焦 #3/.test(foc.bar || "") && foc.inView && foc.lit && foc.dim && Math.abs(after.x - back.x) < 1 && Math.abs(after.y - back.y) < 1 && Math.abs(after.s - back.s) < 0.001 && !(await p.$("[data-focus-bar]")),
      "⤢ frames the question's thread and dims the rest; Escape returns the camera to where it was", JSON.stringify({ foc, back, after }));
    // tidy: understood questions fold into their chapter; before / after
    await p.click('[data-outline="t1-5"]'); await settle(p); const runs0 = S.turns.length;
    await p.click("[data-board-tidy]"); await p.waitForSelector('[data-absorbed]', { timeout: 15000 }).catch(() => {});
    const tidy = await p.evaluate(() => ({ abs: [...document.querySelectorAll("[data-absorbed]")].map((e) => [e.closest("[data-region]").dataset.region, e.querySelector(".rb-abs-tag").textContent]), chip: document.querySelector('[data-tchip="2"]')?.textContent, open: !!document.querySelector('[data-tcard="3:n1"]'), toast: document.querySelector("[data-board-toast]")?.textContent }));
    await p.screenshot({ path: join(shots, "desktop-light-tidy-after.png") });
    ok(S.lessons.some((x) => x.op === "tidy") && S.turns.length === runs0 && tidy.abs.some(([k, t]) => k === "t1-5" && /↳ 併入你問的 #2/.test(t)) && /已併入 #2/.test(tidy.chip || "") && tidy.open && /併回章節/.test(tidy.toast || ""),
      "整理白板 folds the understood questions into their chapter (↳ 併入你問的 #2) with no paid turn; the open ones stay on the board", JSON.stringify(tidy));
    await p.click('[data-tidy-view="before"]'); await settle(p, 100);
    const pre = await p.evaluate(() => ({ abs: document.querySelectorAll("[data-absorbed]").length, chip: document.querySelector('[data-tchip="2"]')?.textContent, pressed: document.querySelector('[data-tidy-view="before"]').getAttribute("aria-pressed") }));
    await p.screenshot({ path: join(shots, "desktop-light-tidy-before.png") });
    await p.click('[data-tidy-view="after"]'); await settle(p, 100); const post = await p.evaluate(() => document.querySelectorAll("[data-absorbed]").length);
    ok(pre.abs === 0 && /✓ #2 懂了/.test(pre.chip || "") && pre.pressed === "true" && post >= 2, "整理前 shows the original text (nothing folded in, the question a chip again); 整理後 shows it folded in", JSON.stringify({ pre, post }));
    // only the chapters with questions
    await p.check("[data-only-asked]"); await settle(p, 400);
    const only = await p.evaluate(() => { const vp = document.querySelector("[data-board-vp]").getBoundingClientRect(); const rs = [...document.querySelectorAll("[data-region]")];
      return { dim: rs.filter((r) => !r.classList.contains("hasq")).every((r) => parseFloat(getComputedStyle(r).opacity) < 0.2), framed: rs.filter((r) => r.classList.contains("hasq")).every((r) => { const b = r.getBoundingClientRect(); return b.left >= vp.left - 1 && b.right <= vp.right + 1 && b.top >= vp.top - 1 && b.bottom <= vp.bottom + 1; }), n: rs.filter((r) => r.classList.contains("hasq")).length }; });
    await p.uncheck("[data-only-asked]");
    ok(only.dim && only.framed && only.n >= 4, "“只看有問題的” frames only the chapters with questions and dims the rest", JSON.stringify(only));
    // the notes and the last region list every question
    const notes = await p.evaluate(() => ({ side: [...document.querySelectorAll('[data-notes-list="side"] [data-note-thread]')].map((b) => [b.dataset.noteThread, b.dataset.noteState]), end: document.querySelectorAll('[data-notes-list="end"] [data-note-thread]').length, count: document.querySelector("[data-end-count]")?.textContent }));
    ok(JSON.stringify(notes.side) === JSON.stringify([["1", "merged"], ["2", "merged"], ["3", "open"], ["4", "merged"], ["5", "open"], ["6", "open"]]) && notes.end === 6 && /問了 6 處/.test(notes.count || ""), "the notes panel lists every question with its state; the last region lists them too", JSON.stringify(notes));
    await p.click('[data-notes-list="side"] [data-note-thread="3"]'); await settle(p, 300);
    ok(await p.$eval("[data-board-plane]", (e) => e.dataset.focus) === "3", "a click on a question in the notes focuses it");
    await p.keyboard.press("Escape");
    // the keyboard: Tab reaches a place (a focus ring), Enter asks there
    await p.click('[data-outline="t1-9"]'); await settle(p); await p.focus('[data-akey="watch/t1-9/risk#p0.s0"]'); await p.keyboard.press("Shift+Tab"); await p.keyboard.press("Tab");
    const kb = await p.evaluate(() => { const a = document.activeElement; return { key: a?.dataset?.akey, ring: getComputedStyle(a).outlineStyle !== "none" && parseFloat(getComputedStyle(a).outlineWidth) >= 2, scroll: document.querySelector("[data-board-vp]").scrollTop }; });
    await p.keyboard.press("Enter"); await settle(p, 120);
    ok(kb.key === "watch/t1-9/risk#p0.s0" && kb.ring && kb.scroll === 0 && (await p.$eval(".rb-pop", (e) => e.dataset.boardPop)) === "watch/t1-9/risk#p0.s0", "a place reached with the keyboard shows a focus ring (the viewport does not scroll); Enter opens its popover; a risk is a place of its own", JSON.stringify(kb));
    await p.keyboard.press("Escape");
    await ctx.close(); }

  // ---------- a fresh lesson: chapters not reached are placeholders; reading one is kept ----------
  { const { ctx, p, S } = await open(1440, "zh-TW", { room: boardRoom("zh-TW", { seeded: false }) });
    const ph = await p.evaluate(() => ({ un: [...document.querySelectorAll("[data-region].unvisited")].map((e) => e.dataset.region).length, t1: document.querySelector('[data-region="t1"]').classList.contains("unvisited"), text: document.querySelector('[data-placeholder="t1-2"]')?.textContent, hidden: getComputedStyle(document.querySelector('[data-region="t1-2"] .rp-card')).visibility }));
    await p.screenshot({ path: join(shots, "desktop-light-fresh.png") });
    await p.click("[data-board-next]"); await until(() => S.lessons.some((x) => x.op === "visit" && x.scene === "t1-2"));
    ok(ph.un === 10 && !ph.t1 && /還沒講到/.test(ph.text || "") && ph.hidden === "hidden" && S.lessons.some((x) => x.op === "visit" && x.scene === "t1-2") && !(await p.$('[data-region="t1-2"].unvisited')),
      "a chapter not reached yet is a placeholder (還沒講到); “Next” reaches it, shows it and keeps it read for the room", JSON.stringify(ph));
    // the first question on a place with none
    const a = await p.$('[data-akey="talks/t1-2/edge/B1-1#edge:api_psp"]') || await p.$('[data-region="t1-2"] [data-akind="edge"]');
    const k = await a.getAttribute("data-akey"); await p.evaluate((key) => document.querySelector(`[data-akey="${CSS.escape(key)}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 500, clientY: 400 })), k); await p.waitForSelector(".rb-pop");
    await p.fill("[data-pop-input]", "Why does the API wait?"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-pending]");
    await p.click("[data-board-start]"); await until(() => S.turns.length > 0); await p.waitForSelector('[data-region="t1-2"] .rb-pin[data-pin]', { timeout: 15000 }).catch(() => {}); const sent = S.turns.at(-1);
    ok(sent?.thread?.chip === "free" && sent.thread.q === "Why does the API wait?" && sent.thread.anchor?.kind === "edge" && sent.thread.anchor.item === "B1-1" && /^edge:/.test(sent.thread.anchor.part) && !!(await p.$('[data-region="t1-2"] .rb-pin[data-pin]')),
      "a question in one's own words on a drawing's line is sent with its place (the drawing, the line); its pin appears there", JSON.stringify(sent));
    await ctx.close(); }

  // ---------- a pull request on GitHub: show the code goes through the room's citation opener (GitHub), never a card ----------
  { const room = boardRoom("zh-TW"); room.pr = { id: 318, url: "https://github.com/example/lumen-pay/pull/318" }; room.subject = { kind: "pr", room: "SC-60", url: room.pr.url, repository: "example/lumen-pay", number: 318 };
    const { ctx, p, S } = await open(1440, "zh-TW", { room }); await p.evaluate(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push([String(u), t, f]); return null; }; });
    const cards0 = await p.$$eval('.rb-card[data-chip="code"]', (e) => e.length);
    await p.$eval('[data-akey="what/t1/sentence#p0.s0"]', (e) => e.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 500, clientY: 300 }))); await p.waitForSelector(".rb-pop");
    await p.click('.rb-pop [data-chip="code"]'); await until(async () => (await p.evaluate(() => window.__opened.length)) > 0 || S.cites.length > 0 || !!(await p.$("[data-cite-panel]")), 5000);
    const gh = await p.evaluate(() => ({ opened: window.__opened, panel: !!document.querySelector("[data-cite-panel]") }));
    ok(!S.lessons.some((x) => x.op === "code") && (await p.$$eval('.rb-card[data-chip="code"]', (e) => e.length)) === cards0 && (gh.opened.length > 0 || gh.panel || S.cites.includes("diff:src/recheck.ts:L10-30")),
      "in a pull request's room 看程式碼 opens the code through the room's citation opener (the pull request on GitHub), never an inline code card", JSON.stringify({ gh, cites: S.cites, lessons: S.lessons }));
    await ctx.close(); }

  // ---------- dark ----------
  { const { ctx, p } = await open(1440, "zh-TW", { dark: true });
    const bg = await p.$eval("[data-board-vp]", (e) => getComputedStyle(e).backgroundColor), card = await p.$eval(".rb-card", (e) => getComputedStyle(e).backgroundColor);
    ok(bg === "rgb(27, 31, 39)" && card !== "rgb(255, 255, 255)", "dark: the board is the room's dark paper (#1b1f27) and the cards follow the theme", JSON.stringify([bg, card]));
    await p.screenshot({ path: join(shots, "desktop-dark-chapter.png") });
    await p.click("[data-zoom-fit]"); await settle(p, 300); await p.screenshot({ path: join(shots, "desktop-dark-map.png") });
    await ctx.close(); }

  // ---------- a phone: the outline first, a chapter framed at a readable size, the popover a bottom sheet ----------
  { const { ctx, p, S } = await open(390, "zh-TW");
    const first = await p.evaluate(() => { const r = document.querySelector("[data-board-rail]"), b = r.getBoundingClientRect(); return { open: r.classList.contains("open"), bottom: Math.round(b.bottom), h: Math.round(b.height), H: innerHeight, items: r.querySelectorAll("[data-outline]").length, wide: document.documentElement.scrollWidth - innerWidth }; });
    await p.screenshot({ path: join(shots, "phone-light-outline.png") });
    ok(first.open && first.bottom === first.H && first.h > first.H * 0.5 && first.items === 11 && first.wide <= 0, "a phone opens on the outline: a sheet from the bottom listing every chapter", JSON.stringify(first));
    await p.click('[data-outline="t1-6"]'); await settle(p, 300);
    const ph = await p.evaluate(() => { const vp = document.querySelector("[data-board-vp]").getBoundingClientRect(), b = document.querySelector('[data-region="t1-6"] .rb-rbody').getBoundingClientRect(); return { sheet: document.querySelector("[data-board-rail]").classList.contains("open"), s: window.crewReviewRoom.board.camOf("SC-60").s, left: b.left >= vp.left, right: b.right <= vp.right + 1, fill: b.width / vp.width, top: b.top >= vp.top && b.top < vp.top + 120 }; });
    ok(!ph.sheet && ph.s >= 0.9 && ph.left && ph.right && ph.fill > 0.85 && ph.top, "tapping a chapter closes the sheet and frames it across the phone's width at a readable size", JSON.stringify(ph));
    await p.screenshot({ path: join(shots, "phone-light-chapter.png") });
    const a = await p.$('[data-region="t1-6"] [data-akind="sentence"]'); const ab = await a.boundingBox(); await p.mouse.click(ab.x + 10, ab.y + 6); await p.waitForSelector(".rb-pop");
    const sheet = await p.evaluate(() => { const r = document.querySelector(".rb-pop").getBoundingClientRect(); return { left: r.left, right: Math.round(r.right), bottom: Math.round(r.bottom), W: innerWidth, H: innerHeight, chips: document.querySelectorAll(".rb-pop [data-chip]").length, chipH: document.querySelector(".rb-pop [data-chip]").getBoundingClientRect().height }; });
    await p.screenshot({ path: join(shots, "phone-light-popover.png") });
    ok(sheet.left === 0 && sheet.right === sheet.W && sheet.bottom === sheet.H && sheet.chips === 5 && sheet.chipH >= 32, "on a phone the popover is a bottom sheet across the screen, its chips big enough to tap", JSON.stringify(sheet));
    await p.keyboard.press("Escape"); await p.click('[data-sheet="notes"]'); await settle(p, 200);
    const nt = await p.evaluate(() => ({ open: document.querySelector("[data-board-notes]").classList.contains("open"), n: document.querySelectorAll('[data-board-notes] [data-note-thread]').length, badge: document.querySelector('[data-sheet="notes"] b')?.textContent }));
    ok(nt.open && nt.n === 4 && nt.badge === "4", "標註 opens the questions as a sheet, its count on the button", JSON.stringify(nt));
    await ctx.close(); }
  { const { ctx, p } = await open(390, "zh-TW", { dark: true }); await p.click('[data-outline="t1"]'); await settle(p, 300); await p.screenshot({ path: join(shots, "phone-dark-chapter.png") }); await ctx.close(); }

  // ---------- a Library snapshot: the board read-only, its threads visible, no paid action ----------
  { const room = boardRoom("zh-TW"); room.lesson.visited = ["t1"];
    const snap = { schema: 1, kind: "review-room-snapshot", room: "SC-60", savedAt: "2026-10-29T10:00:00Z", reason: "Saved by captain", artifact: "room-sc-60", n: 1, versions: [{ n: 1, at: "t", summary: "Saved" }], cost: { usd: 0.3 }, tutors: [], subject: { kind: "merge", room: "SC-60" },
      view: { ...room, open: false, offer: null, running: null, notes: undefined, tutors: [], translate: null }, cites: { "diff:src/recheck.ts:L10-30": { kind: "diff", path: "src/recheck.ts", from: 10, to: 30, head: "a".repeat(40), text: "@@ -1 +1 @@\n+recheck()" }, "diff:src/pay.ts:L40-58": { kind: "diff", path: "src/pay.ts", from: 40, to: 58, head: "a".repeat(40), text: "@@ -1 +1 @@\n+charge()" }, "diff:src/recheck.ts:L40-52": { kind: "diff", path: "src/recheck.ts", from: 40, to: 52, head: "a".repeat(40), text: DIFF } } };
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "zh-TW"); } catch {} Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak: () => {}, cancel: () => {} } }); window.webkitSpeechRecognition = undefined; });
    const live = []; await ctx.route(/\/api\/review-room\/(SC-60|library\/room-sc-60)/, (r) => { const u = r.request().url(); if (/library\/room-sc-60/.test(u)) return r.fulfill({ json: snap }); live.push(`${r.request().method()} ${u}`); r.fulfill({ status: 404, json: { error: "no" } }); });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`lib: ${e.message}`));
    await p.goto(`${base}/#/room/lib:room-sc-60`); await p.waitForSelector("[data-stage]", { timeout: 15000 }); await p.click('[data-toc-scene="t1"]').catch(() => {}); await p.waitForSelector("[data-board-vp]", { timeout: 5000 }).catch(() => {});
    const ro = await p.evaluate(() => ({ board: !!document.querySelector("[data-board-vp]"), unvisited: document.querySelectorAll("[data-region].unvisited").length, cards: document.querySelectorAll(".rb-card").length, tidy: !!document.querySelector("[data-board-tidy]"), follow: document.querySelectorAll("[data-follow], [data-resolve]").length }));
    await p.evaluate(() => document.querySelector('[data-akey="what/t1/sentence#p0.s0"]').dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 500, clientY: 300 }))); await p.waitForSelector(".rb-pop");
    const pop = await p.evaluate(() => ({ paid: [...document.querySelectorAll('.rb-pop [data-chip]:not([data-chip="code"])')].every((b) => b.disabled), input: !!document.querySelector(".rb-pop [data-pop-input]"), code: !document.querySelector('.rb-pop [data-chip="code"]').disabled }));
    await p.click('.rb-pop [data-chip="code"]'); await p.waitForSelector("[data-cite-panel]", { timeout: 3000 }).catch(() => {});
    ok(ro.board && ro.unvisited === 0 && ro.cards >= 4 && !ro.tidy && ro.follow === 0 && pop.paid && !pop.input && pop.code && !!(await p.$("[data-cite-panel]")) && !live.length,
      "a Library snapshot replays the board read-only: every chapter shown, its questions' cards visible, no tidy or follow-up, the popover's paid chips off; show the code opens the saved citation (nothing read from the live room)", JSON.stringify({ ro, pop, live }));
    await ctx.close(); }

  // ---------- the real routes: findings and the board's free actions need a room and Studio's session ----------
  { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(`${base}/#/board`);
    const r = await p.evaluate(async () => { const a = await fetch("/api/review-room/SC-999/findings"), b = await fetch("/api/review-room/SC-999/lesson", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "tidy" }) }), c = await fetch("/api/review-room/SC-999/lesson");
      return [a.status, (await a.json()).code, b.status, (await b.json()).code, c.status]; });
    const bare = await fetch(`${base}/api/review-room/SC-999/lesson`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "tidy" }) });
    ok(r[0] === 404 && r[1] === "not_found" && r[2] === 404 && r[3] === "not_found" && r[4] === 405 && (bare.status === 401 || bare.status === 403), "the findings and the board's actions are real routes: a room must exist, the actions are POST with Studio's session", JSON.stringify([r, bare.status]));
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\nreview-room-board-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
