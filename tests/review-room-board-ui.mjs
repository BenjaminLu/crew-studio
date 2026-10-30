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
  // the server says who is looking (GET /api/remote/me: a paired phone or this Mac), whatever the window's width
  await ctx.route(/\/api\/remote\/me$/, (r) => r.fulfill({ json: { kind: o.viewer ?? (phone ? "phone" : "desktop"), device: null } }));
  await ctx.route(/\/api\/review-room\/SC-60(\?open=1)?$/, (r) => r.fulfill({ json: S.room }));
  await ctx.route(/\/api\/review-room\/SC-60\/cite\?/, (r) => { S.cites.push(new URL(r.request().url()).searchParams.get("ref")); r.fulfill({ json: { kind: "diff", path: "src/recheck.ts", from: 40, to: 52, head: "a".repeat(40), text: DIFF } }); });
  await ctx.route(/\/api\/review-room\/SC-60\/turn$/, async (r) => { const b = JSON.parse(r.request().postData() || "{}"); S.turns.push(b);
    // Studio's rule (src/domain/review-room.ts start): the room's offer confirmed, or the room's agreement for this plan
    if (b.confirm !== S.room.offer.hash && !S.room.followUps?.current) return r.fulfill({ status: 409, json: { error: "confirm it", code: "confirm_required", offer: S.room.offer } });
    // Studio's answer to a confirmed question: a running turn and its card (src/domain/review-room.ts applyThread)
    const room = clone(S.room), n = room.turns.length + 1, L = room.lesson, th = b.thread;
    let t = th.n != null ? L.threads.find((x) => x.n === th.n) : null; const now = "t";
    if (!t) { const a = th.anchor, ch = room.turns[0].scenes[a.scene === "t1" ? 0 : Number(a.scene.split("-")[1]) - 1].chapter, key = `${ch}/${a.scene}/${a.kind}${a.item ? `/${a.item}` : ""}${a.part ? `#${a.part}` : ""}`;
      t = { n: Math.max(0, ...L.threads.map((x) => x.n)) + 1, key, anchor: { ...a, turn: 1, chapter: ch }, locator: { type: "text", section: key }, nodes: [], state: "open", at: now, resolvedAt: null, merged: null }; L.threads.push(t); }
    const parent = th.node ? t.nodes.find((x) => x.id === th.node) : null; let node;
    if (!parent) { node = { id: "n1", parent: null, rel: "root", chip: th.chip, q: th.q ?? null, versions: [n], code: null, at: now }; t.nodes.push(node); }
    else if (th.chip === "rephrase") { parent.versions.push(n); node = parent; }
    else { node = { id: `n${t.nodes.length + 1}`, parent: parent.id, rel: th.chip === "example" ? "side" : "below", chip: th.chip, q: th.q ?? null, versions: [n], code: null, at: now }; t.nodes.push(node); }
    if (th.chip === "rephrase") t.confused = true; t.state = "open"; t.merged = null;
    const auto = b.confirm !== room.offer.hash;
    if (b.consent === true && !auto) room.followUps = { on: true, at: now, current: true, used: 0, limit: 10 };
    else if (room.followUps && !auto) Object.assign(room.followUps, { used: 0, current: true });
    else if (room.followUps && auto) { room.followUps.used = (room.followUps.used ?? 0) + 1; room.followUps.current = room.followUps.used < 10; }
    room.turns.push({ n, action: "ask", text: "q", lang, status: "running", provider: "codex", model: "gpt-6", answer: "", head: "a".repeat(40), thread: { n: t.n, node: node.id }, ...(auto ? { follow: room.followUps.used } : {}) });
    room.running = n; room.progress = { turn: n, status: "running", said: o.said ?? "Reading src/recheck.ts to see when it asks again", tools: 2, at: null };
    S.room = room; r.fulfill({ json: room }); });
  await ctx.route(/\/api\/review-room\/SC-60\/lesson$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); S.lessons.push(b); const room = clone(S.room), L = room.lesson;
    if (b.op === "visit") { if (!L.visited.includes(b.scene)) L.visited.push(b.scene); S.room = room; return r.fulfill({ json: { visited: L.visited } }); }
    if (b.op === "resolve") { const t = L.threads.find((x) => x.n === b.n); t.state = b.on === false ? "open" : "resolved"; t.confused = b.on === false; if (b.on === false) t.merged = null; S.room = room; return r.fulfill({ json: room }); }
    if (b.op === "consent") { delete room.followUps; S.room = room; return r.fulfill({ json: room }); }
    if (b.op === "code") { let t = b.n != null ? L.threads.find((x) => x.n === b.n) : null; const a = b.anchor;
      if (!t) { const key = `${room.turns[0].scenes[a.scene === "t1" ? 0 : Number(a.scene.split("-")[1]) - 1].chapter}/${a.scene}/${a.kind}${a.item ? `/${a.item}` : ""}${a.part ? `#${a.part}` : ""}`; t = L.threads.find((x) => x.key === key);
        if (!t) { t = { n: Math.max(0, ...L.threads.map((x) => x.n)) + 1, key, anchor: { ...a, turn: 1, chapter: key.split("/")[0] }, locator: { type: "text", section: key }, nodes: [], state: "open", at: "t", resolvedAt: null, merged: null }; L.threads.push(t); } }
      const root = t.nodes.find((x) => x.rel === "root"); t.nodes.push(root ? { id: `n${t.nodes.length + 1}`, parent: root.id, rel: "below", chip: "code", q: null, versions: [], code: b.ref, at: "t" } : { id: "n1", parent: null, rel: "root", chip: "code", q: null, versions: [], code: b.ref, at: "t" });
      S.room = room; return r.fulfill({ json: room }); }
    // every answered question not said 還沒懂 (src/domain/review-room.ts tidy)
    if (b.op === "tidy") { let merged = 0; for (const t of L.threads) { if (t.merged || (t.confused && t.state === "open")) continue; const nd = t.nodes.find((x) => x.code || x.versions.some((v) => room.turns.find((y) => y.n === v)?.status === "done")); if (!nd) continue;
        const tn = nd.code ? null : room.turns.find((x) => x.n === nd.versions.at(-1)); t.merged = tn ? { at: "t", gist: tn.claims[0].text, cites: tn.claims[0].cites } : { at: "t", gist: `[${nd.code}]`, cites: [{ ref: nd.code, ok: true }] }; merged++; }
      S.room = room; return r.fulfill({ json: { merged, open: L.threads.filter((t) => !t.merged && t.state === "open").length, view: room } }); }
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
    ok(/未解 0/.test(t1.open) && /懂了 0/.test(t1.done) && /未解 0/.test(t5.open) && /懂了 1/.test(t5.done) && /未解 1/.test(end.open), "the map's badges count each chapter's questions not understood (as the reader said) and understood", JSON.stringify([t1, t5, end]));
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
    ok(pins.length === 5 && pins.every((x) => x.on) && pins.some((x) => x.inside) && pins.some((x) => !x.inside), "each question's numbered pin sits on its place: inside a sentence, at a drawing's part", JSON.stringify(pins));
    // the anchor's card branches beside it, joined to it
    const near = await p.evaluate(() => { const a = document.querySelector('[data-akey="what/t1/sentence#p0.s1"]').getBoundingClientRect(), c = document.querySelector('[data-tcard="1:n1"]').getBoundingClientRect(), ex = document.querySelector('[data-tcard="1:n2"]').getBoundingClientRect();
      return { right: c.left > a.right, level: Math.abs(c.top - a.top) < 60, side: ex.left > c.right && Math.abs(ex.top - c.top) < 4, line: document.querySelectorAll('[data-board-links] path[data-link="1"]').length }; });
    ok(near.right && near.level && near.side && near.line >= 2, "a question's card branches right beside its place, joined by a line; its example sits beside it", JSON.stringify(near));
    // 還沒懂 is only what the reader said: the confused question is red, an answered one is not; the outline counts cards
    const st = await p.evaluate(() => ({ q: [...document.querySelectorAll(".rb-card.q")].map((e) => e.dataset.thread), pin1: document.querySelector('[data-pin-for="what/t1/sentence#p0.s1"]')?.className, pin3: document.querySelector('[data-pin-for="lifecycle/t1-6/transition/B1-5#transition:3"]')?.className,
      counts: ["t1", "t1-6"].map((k) => document.querySelector(`[data-outline="${k}"] [data-outline-count]`)?.dataset.outlineCount) }));
    ok([...new Set(st.q)].join() === "3" && !/\bq\b/.test(st.pin1 || "") && /\bq\b/.test(st.pin3 || "") && JSON.stringify(st.counts) === '["3/0","2/1"]', "only the question the reader said they do not understand is 還沒懂 (red); the outline counts cards (則) and those", JSON.stringify(st));
    // a risk has its own 問
    await p.click('[data-outline="t1-9"]'); await settle(p); await p.click('[data-ask-risk="1"]', { timeout: 3000 }).catch(() => {}); await settle(p, 120);
    ok((await p.$eval(".rb-pop", (e) => e.dataset.boardPop).catch(() => null)) === "watch/t1-9/risk#p1.s0", "a risk has its own 問 button: it asks about that risk");
    await p.keyboard.press("Escape"); await p.click('[data-outline="t1"]'); await settle(p);
    await p.screenshot({ path: join(shots, "desktop-light-chapter.png") });
    // the popover: inside the screen, its chips and the free question
    const s1 = await p.$('[data-akey="what/t1/sentence#p1.s0"]'); const b1 = await s1.boundingBox(); await p.mouse.click(b1.x + b1.width - 4, b1.y + b1.height - 3); await p.waitForSelector(".rb-pop");
    const pop = await p.evaluate(() => { const r = document.querySelector(".rb-pop").getBoundingClientRect(); return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, chips: [...document.querySelectorAll(".rb-pop [data-chip]")].map((b) => b.textContent), input: !!document.querySelector(".rb-pop [data-pop-input]"), modal: !!document.querySelector("[data-room-confirm]"), focus: document.activeElement?.dataset?.chip ?? null }; });
    ok(pop.inside && JSON.stringify(pop.chips) === JSON.stringify(["詳細一點", "舉個例子", "為什麼這樣做", "看程式碼", "我不懂這句"]) && pop.input && !pop.modal && pop.focus === "deeper" && !(await p.$(".rb-pop .rb-popnote")), "a click on a sentence opens its popover inside the screen: 詳細一點, 舉個例子, 為什麼這樣做, 看程式碼, 我不懂這句 and a question of one's own (no paid disclosure repeated there)", JSON.stringify(pop));
    // a popover near the screen's right and bottom edges stays inside it
    const edge = await p.evaluate(() => { const B = window.crewReviewRoom.board.state, a = document.querySelector('[data-akey="what/t1/sentence#p0.s0"]'); B.pop = null; a.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: innerWidth - 20, clientY: innerHeight - 20 })); return true; });
    await settle(p, 120); const pr2 = await p.evaluate(() => { const r = document.querySelector(".rb-pop").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, W: innerWidth, H: innerHeight }; });
    ok(edge && pr2.l >= 0 && pr2.t >= 0 && pr2.r <= pr2.W && pr2.b <= pr2.H, "a popover opened at the screen's corner is moved inside it", JSON.stringify(pr2));
    await p.keyboard.press("Escape"); await settle(p, 80);
    ok(!(await p.$(".rb-pop")) && await p.evaluate(() => document.activeElement?.dataset?.akey === "what/t1/sentence#p0.s0"), "Escape closes the popover and gives the focus back to the place");
    // asking: the question waits in its card for the confirmation, inline; nothing is sent before it
    await p.mouse.click(b1.x + 8, b1.y + 6); await p.waitForSelector(".rb-pop"); await p.click('.rb-pop [data-chip="deeper"]'); await p.waitForSelector("[data-pending]", { timeout: 5000 }).catch(() => {});
    const pend = await p.evaluate(() => { const a = document.querySelector('[data-akey="what/t1/sentence#p1.s0"]').getBoundingClientRect(), c = document.querySelector("[data-pending]")?.getBoundingClientRect() ?? { left: -1 }; return { text: document.querySelector("[data-board-confirm]")?.textContent, consent: document.querySelector("[data-board-consent]")?.checked, label: document.querySelector(".rb-consent")?.textContent, right: c.left > a.right, modal: !!document.querySelector("[data-room-confirm], [role=dialog][aria-modal=true]"), pop: !!document.querySelector(".rb-pop") }; });
    ok(S.turns.length === 0 && /付費一回合：codex · gpt-6（high），不產生圖片/.test(pend.text) && pend.consent === true && /之後追問直接開始（這個房間）/.test(pend.label || "") && pend.right && !pend.modal && !pend.pop, "the room's first paid question shows its plan once in the new card beside its place (model, effort, paid, no picture), “之後追問直接開始（這個房間）” pre-checked; nothing is sent yet", JSON.stringify(pend));
    await p.click("[data-board-start]"); await p.waitForSelector("[data-thinking]", { timeout: 15000 }).catch(() => {});
    const sent = S.turns.at(-1), think = await p.evaluate(() => ({ thinking: document.querySelector("[data-thinking]")?.textContent, said: document.querySelector("[data-streaming]")?.textContent, card: document.querySelector("[data-thinking]")?.closest("[data-tcard]")?.dataset.tcard }));
    ok(sent?.confirm === "feedc0ffee654321" && sent.consent === true && !("images" in sent) && sent.thread?.chip === "deeper" && sent.thread.anchor?.scene === "t1" && sent.thread.anchor.kind === "sentence" && sent.thread.anchor.part === "p1.s0" && /同一筆付款只結算一次/.test(sent.thread.anchor.text) && !sent.action,
      "confirmed, the question is sent as the room's paid turn with the room's offer, the agreement and the place (scene, kind, part, its words), never asking for pictures", JSON.stringify(sent));
    ok(think.thinking === "思考中" && /Reading src\/recheck\.ts/.test(think.said || "") && think.card === "6:n1", "while the tutor works, its card says 思考中 and streams what it has said so far", JSON.stringify(think));
    // the answer arrives (the room's poll): text only
    S.room = clone(S.room); const tr = S.room.turns.at(-1); Object.assign(tr, { status: "done", answer: "x", claims: [{ text: "Both paths call settle(), whose CAS lets one win <img src=x onerror=\"window.__pwned=1\"> [diff:src/settle.ts:L8-30].", kind: "claim", basis: "cited", cites: [{ ref: "diff:src/settle.ts:L8-30", ok: true }] }] }); S.room.running = null; S.room.progress = null;
    await p.waitForFunction(() => /CAS lets one win/.test(document.querySelector('[data-tcard="6:n1"]')?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
    const done = await p.evaluate(() => ({ text: document.querySelector('[data-tcard="6:n1"] .rb-cbody')?.textContent, img: !!document.querySelector(".rb-card img"), pwned: !!window.__pwned, cite: !!document.querySelector('[data-tcard="6:n1"] [data-cite="diff:src/settle.ts:L8-30"]') }));
    await p.screenshot({ path: join(shots, "desktop-light-thread.png") });
    ok(/CAS lets one win <img src=x/.test(done.text || "") && !done.img && !done.pwned && done.cite, "the answer shows in its card as text (markup stays text), its citation a chip", JSON.stringify(done));
    // agreed: a follow-up on a card is one click; it starts at once, its card beside, marked paid; the place stays in view
    await p.click('[data-tcard="6:n1"] [data-follow="example"]'); await until(() => S.turns.length === 2); await p.waitForSelector('[data-tcard="6:n2"]', { timeout: 15000 }).catch(() => {}); await settle(p, 600);
    const side = await p.evaluate(() => { const vp = document.querySelector("[data-board-vp]").getBoundingClientRect(), a = document.querySelector('[data-tcard="6:n1"]').getBoundingClientRect(), c = document.querySelector('[data-tcard="6:n2"]')?.getBoundingClientRect(), s = document.querySelector('[data-akey="what/t1/sentence#p1.s0"]').getBoundingClientRect(), inside = (r) => r && r.left >= vp.left - 1 && r.right <= vp.right + 1 && r.top >= vp.top - 1 && r.bottom <= vp.bottom + 1;
      return { beside: !!c && c.left > a.right && Math.abs(c.top - a.top) < 4, pending: !!document.querySelector("[data-pending]"), anchor: s.right <= vp.right + 1 && s.right - 100 >= vp.left && s.top >= vp.top && s.bottom <= vp.bottom, card: inside(c ? { left: c.left, right: c.right, top: c.top, bottom: c.top + 40 } : null), paid: document.querySelector('[data-tcard="6:n1"] [data-paid-note]')?.textContent }; });
    const fu = S.turns.at(-1);
    ok(side.beside && !side.pending && fu.thread?.n === 6 && fu.thread.node === "n1" && fu.thread.chip === "example" && !("confirm" in fu) && /付費 · gpt-6/.test(side.paid || ""), "agreed for this plan, 例子 → on a card starts at once (one click, no confirmation sent), its card beside its parent, the card marked “付費 · gpt-6”", JSON.stringify([side, fu]));
    ok(side.anchor && side.card, "the camera shows the new card and keeps the place asked about in view (its end and pin)", JSON.stringify(side));
    Object.assign(S.room.turns.at(-1), { status: "done", claims: [{ text: "Order 7731 at 14:07.", kind: "claim", basis: null, cites: [] }] }); S.room.running = null; S.room = clone(S.room);
    await p.waitForFunction(() => !document.querySelector("[data-thinking]"), null, { timeout: 15000 }).catch(() => {});
    // the room's switch turns the agreement off: the next question asks again, in a card below its parent
    await p.click("[data-followups]"); await until(() => S.lessons.some((x) => x.op === "consent" && x.on === false)); await p.waitForFunction(() => !document.querySelector("[data-followups]"), null, { timeout: 15000 }).catch(() => {});
    await p.click('[data-tcard="6:n1"] [data-follow="deeper"]'); await p.waitForSelector("[data-pending]", { timeout: 5000 }).catch(() => {});
    const below = await p.evaluate(() => { const a = document.querySelector('[data-tcard="6:n1"]').getBoundingClientRect(), c = document.querySelector("[data-pending]")?.getBoundingClientRect(); return !!c && c.top > a.bottom && Math.abs(c.left - a.left) < 4; });
    await p.click("[data-board-cancel]").catch(() => {}); await settle(p, 80);
    ok(below && !(await p.$("[data-pending]")) && S.turns.length === 2, "the room's switch off, 更深 ↓ asks again in a card below its parent; cancelled, nothing is sent", JSON.stringify(below));
    // a rephrasing is a version tab of the same card
    await p.click('[data-outline="t1-5"]'); await settle(p); await p.click('[data-tchip="2"]'); await settle(p, 120);
    const tabs = await p.evaluate(() => [...document.querySelectorAll('[data-tcard="2:n1"] [data-version-tab]')].map((b) => [b.textContent, b.getAttribute("aria-pressed")]));
    await p.click('[data-tcard="2:n1"] [data-version-tab="0"]').catch(() => {});
    const v0 = await p.evaluate(() => document.querySelector('[data-tcard="2:n1"] .rb-cbody')?.textContent || "");
    const figs = await p.evaluate(() => document.querySelector('[data-tcard="2:n1"] [data-card-figures] [data-report-figure="B5-1"]') ? "B5-1" : null);
    ok(JSON.stringify(tabs) === '[["1","false"],["2","true"]]' && /兩邊都讀到 version 2/.test(v0), "換個說法 is a version of the same card: tabs 1 and 2, the latest shown, the first one a click away", JSON.stringify([tabs, v0.slice(0, 40)]));
    await p.click('[data-tcard="2:n1"] [data-version-tab="1"]').catch(() => {});
    ok(await p.evaluate(() => !!document.querySelector('[data-tcard="2:n1"] [data-card-figures] [data-report-figure="B5-1"] svg')), "a drawing the tutor made for an answer shows in that answer's card, drawn by Studio", String(figs));
    // show the code: free, no turn
    const turns0 = S.turns.length, tr0 = await p.$('[data-akey="lifecycle/t1-6/transition/B1-5#transition:0"]'); await p.click('[data-outline="t1-6"]'); await settle(p);
    await p.evaluate(() => document.querySelector('[data-akey="lifecycle/t1-6/transition/B1-5#transition:0"]').dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 600, clientY: 400 }))); await p.waitForSelector(".rb-pop");
    await p.click('.rb-pop [data-chip="code"]'); await p.waitForFunction(() => /getCharge/.test(document.querySelector('.rb-card[data-thread="7"][data-chip="code"]')?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
    const code = S.lessons.find((x) => x.op === "code");
    ok(tr0 && S.turns.length === turns0 && code?.ref === "diff:src/pay.ts:L40-58" && code.anchor?.kind === "transition" && code.anchor.part === "transition:0" && S.cites.includes("diff:src/pay.ts:L40-58") && await p.evaluate(() => /getCharge/.test(document.querySelector('.rb-card[data-thread="7"][data-chip="code"]')?.textContent || "")),
      "看程式碼 on a transition is free: no turn, a code card holding its citation, the diff read through the citation viewer", JSON.stringify({ code, cites: S.cites, turns: S.turns.length - turns0, cards: await p.evaluate(() => [...document.querySelectorAll('.rb-card[data-chip="code"]')].map((c) => c.dataset.tcard + ':' + c.textContent.slice(0, 80))) }));
    // understood: folded into a chip
    await p.click('[data-outline="t1"]'); await settle(p); await p.click('[data-tcard="1:n1"] [data-resolve="1"]'); await p.waitForSelector('[data-tchip="1"]', { timeout: 15000 }).catch(() => {});
    ok(S.lessons.some((x) => x.op === "resolve" && x.n === 1) && !(await p.$('[data-tcard="1:n1"]')) && /✓ #1 懂了/.test(await p.textContent('[data-tchip="1"]')), "懂了 ✓ marks the question understood: its cards fold into a chip “✓ #1 懂了”");
    // focus: frame the thread, dim the rest, Escape returns
    await p.click('[data-outline="t1-6"]'); await settle(p); const back = await cam(p); await p.$eval('[data-focus-thread="3"]', (b) => b.click()); await settle(p, 300);
    const foc = await p.evaluate(() => { const vp = document.querySelector("[data-board-vp]").getBoundingClientRect(), op = (e) => parseFloat(getComputedStyle(e).opacity);
      const mine = [...document.querySelectorAll('.rb-card[data-thread="3"]')], others = [...document.querySelectorAll('.rb-card:not([data-thread="3"])')];
      const ar = document.querySelector('[data-akey="lifecycle/t1-6/transition/B1-5#transition:3"]').getBoundingClientRect();
      return { anchor: ar.left >= vp.left && ar.right <= vp.right && ar.top >= vp.top && ar.bottom <= vp.bottom, bar: document.querySelector("[data-focus-bar]")?.textContent, inView: mine.every((e) => { const r = e.getBoundingClientRect(); return r.left >= vp.left && r.right <= vp.right && r.top >= vp.top && r.bottom <= vp.bottom; }), lit: mine.every((e) => op(e) === 1), dim: others.length > 0 && others.every((e) => op(e) < 0.5) }; });
    await p.screenshot({ path: join(shots, "desktop-light-focus.png") });
    await p.keyboard.press("Escape"); await settle(p, 300); const after = await cam(p);
    ok(/聚焦 #3/.test(foc.bar || "") && foc.inView && foc.anchor && foc.lit && foc.dim && Math.abs(after.x - back.x) < 1 && Math.abs(after.y - back.y) < 1 && Math.abs(after.s - back.s) < 0.001 && !(await p.$("[data-focus-bar]")),
      "⤢ frames the place asked about and the question's cards together, dims the rest; Escape returns the camera to where it was", JSON.stringify({ foc, back, after }));
    // a click on a card's empty area focuses its whole thread
    await p.click('[data-outline="t1"]'); await settle(p); await p.click('[data-tcard="6:n1"] .rb-anchor'); await settle(p, 300);
    ok(await p.$eval("[data-board-plane]", (e) => e.dataset.focus).catch(() => null) === "6", "a click on a card's empty area focuses its whole thread");
    await p.keyboard.press("Escape"); await settle(p, 200);
    // tidy: understood questions fold into their chapter; before / after
    await p.click('[data-outline="t1-5"]'); await settle(p); const runs0 = S.turns.length;
    await p.click("[data-board-tidy]"); await p.waitForSelector('[data-region="t1-5"] [data-absorbed]', { timeout: 15000 }).catch(() => {}); await settle(p, 200);
    const tidy = await p.evaluate(() => { const c = document.querySelector('[data-tchip="2"]'), cr = c?.getBoundingClientRect(), ar = document.querySelector('[data-akey="change/t1-5/sentence#p0.s0"]').getBoundingClientRect(), br = document.querySelector('[data-region="t1-5"] .rb-rbody').getBoundingClientRect();
      return { abs: [...document.querySelectorAll("[data-absorbed]")].map((e) => [e.closest("[data-region]").dataset.region, e.querySelector(".rb-abs-tag").textContent]), chip: c?.textContent, near: !!cr && Math.abs(cr.top - ar.top) < 40 && cr.left - br.right < 50, open: !!document.querySelector('[data-tcard="3:n1"]'), toast: document.querySelector("[data-board-toast]")?.textContent }; });
    await p.screenshot({ path: join(shots, "desktop-light-tidy-after.png") });
    ok(S.lessons.some((x) => x.op === "tidy") && S.turns.length === runs0 && tidy.abs.some(([k, t]) => k === "t1-5" && /↳ 併入你問的 #2/.test(t)) && tidy.abs.some(([k, t]) => k === "t1" && /#1、#5、#6/.test(t)) && /已併入 #2/.test(tidy.chip || "") && tidy.open && /已把 5 串問答併回章節/.test(tidy.toast || ""),
      "整理白板 folds every answered question that is not 還沒懂 into its chapter (5 of them, ↳ 併入你問的 #…) with no paid turn; the confused one stays on the board", JSON.stringify(tidy));
    ok(tidy.near, "a folded question's chip stays beside its place, not pushed away by the cards", JSON.stringify(tidy));
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
    ok(JSON.stringify(notes.side) === JSON.stringify([["1", "merged"], ["2", "merged"], ["3", "confused"], ["4", "merged"], ["5", "merged"], ["6", "merged"], ["7", "merged"]]) && notes.end === 7 && /問了 7 處/.test(notes.count || ""), "the notes panel lists every question with its state; the last region lists them too", JSON.stringify(notes));
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
    await p.fill("[data-pop-input]", "Why does the API wait?"); await p.press("[data-pop-input]", "Enter"); await p.waitForSelector("[data-pending]");
    await p.click("[data-board-start]"); await until(() => S.turns.length > 0); await p.waitForSelector('[data-region="t1-2"] .rb-pin[data-pin]', { timeout: 15000 }).catch(() => {}); const sent = S.turns.at(-1);
    ok(sent?.thread?.chip === "free" && sent.thread.q === "Why does the API wait?" && sent.thread.anchor?.kind === "edge" && sent.thread.anchor.item === "B1-1" && /^edge:/.test(sent.thread.anchor.part) && !!(await p.$('[data-region="t1-2"] .rb-pin[data-pin]')),
      "a question in one's own words on a drawing's line is sent with its place (the drawing, the line); its pin appears there", JSON.stringify(sent));
    await ctx.close(); }

  // ---------- the room's agreement: anchor to answer in two clicks; a new plan asks once again ----------
  { const room = boardRoom("zh-TW"); room.followUps = { on: true, at: "t", current: true };
    const { ctx, p, S } = await open(1440, "zh-TW", { room }); await p.click('[data-outline="t1-2"]'); await settle(p);
    const a = await p.$('[data-akey^="talks/t1-2/sentence#p0.s0"]'); const ab = await a.boundingBox(); await p.mouse.click(ab.x + 8, ab.y + 6); await p.waitForSelector(".rb-pop");
    await p.click('.rb-pop [data-chip="rephrase"]'); await until(() => S.turns.length === 1); await p.waitForSelector("[data-thinking]", { timeout: 15000 }).catch(() => {});
    const t = S.turns[0], st = await p.evaluate(() => ({ pending: !!document.querySelector("[data-pending]"), thinking: !!document.querySelector("[data-thinking]"), card: document.querySelector("[data-thinking]")?.closest(".rb-card")?.className }));
    ok(t?.thread?.chip === "rephrase" && !("confirm" in t) && !st.pending && st.thinking, "agreed for this plan, a place's question is two clicks: the place, then the chip; it starts at once (no confirmation sent)", JSON.stringify([t, st]));
    ok(/\bq\b/.test(st.card || ""), "我不懂這句 marks the question 還沒懂 (its card red)", st.card);
    await ctx.close(); }
  { const room = boardRoom("zh-TW"); room.followUps = { on: true, at: "t", current: false };
    const { ctx, p, S } = await open(1440, "zh-TW", { room });
    const a = await p.$('[data-akey="what/t1/sentence#p1.s0"]'); const ab = await a.boundingBox(); await p.mouse.click(ab.x + 8, ab.y + 6); await p.waitForSelector(".rb-pop");
    await p.click('.rb-pop [data-chip="why"]'); await p.waitForSelector("[data-pending]", { timeout: 5000 }).catch(() => {});
    const st = await p.evaluate(() => ({ pending: !!document.querySelector("[data-pending]"), consent: document.querySelector("[data-board-consent]")?.checked }));
    ok(st.pending && st.consent === true && S.turns.length === 0, "the plan changed since the room agreed (another model or effort): the next question shows the plan and asks once again", JSON.stringify(st));
    await ctx.close(); }

  // ---------- a long thread: a follow-up two cards below still keeps the place asked about on screen ----------
  { const room = boardRoom("zh-TW"), key = "what/t1/sentence#p1.s0", long = "工作每五分鐘撈到期的付款，逐筆問閘道；付了就結算，沒付才作廢。".repeat(6), nodes = [];
    room.followUps = { on: true, at: "t", current: true };
    for (let i = 0; i < 2; i++) { room.turns.push({ n: 200 + i, action: "how", text: "q", lang: "zh-TW", status: "done", provider: "codex", model: "gpt-6", answer: long, head: "a".repeat(40), claims: [{ text: long, kind: "claim", basis: null, cites: [] }], thread: { n: 30, node: `n${i + 1}` } });
      nodes.push({ id: `n${i + 1}`, parent: i ? `n${i}` : null, rel: i ? "below" : "root", chip: "deeper", q: null, versions: [200 + i], code: null, at: "t" }); }
    room.lesson.threads.push({ n: 30, key, anchor: { turn: 1, scene: "t1", chapter: "what", kind: "sentence", item: null, part: "p1.s0", text: "x", start: null, end: null }, locator: { type: "text", section: key }, nodes, state: "open", at: "t", resolvedAt: null, merged: null });
    const { ctx, p, S } = await open(1440, "zh-TW", { room }); await p.click('[data-outline="t1"]'); await settle(p);
    await p.evaluate(() => document.querySelector('[data-tcard="30:n2"] [data-follow="deeper"]')?.click()); await until(() => S.turns.length === 1).catch(() => {}); await p.waitForSelector('[data-tcard="30:n3"]', { timeout: 15000 }).catch(() => {}); await settle(p, 700);
    const kept = await p.evaluate((k) => { const vp = document.querySelector("[data-board-vp]").getBoundingClientRect(), s = document.querySelector(`[data-akey="${k}"]`).getBoundingClientRect(), c = document.querySelector('[data-tcard="30:n3"]')?.getBoundingClientRect();
      return { card: !!c && c.top < vp.bottom && c.bottom > vp.top, anchor: s.top >= vp.top - 1 && s.bottom <= vp.bottom + 1 && s.right <= vp.right + 1 && s.right - 100 >= vp.left }; }, key);
    ok(kept.card && kept.anchor, "a follow-up three cards down: the camera shows its card and keeps the place asked about in view", JSON.stringify(kept));
    await ctx.close(); }

  // ---------- the agreement's count: each card it started says so; after ten the room asks once more ----------
  { const room = boardRoom("zh-TW"); room.followUps = { on: true, at: "t", current: true, used: 9, limit: 10 };
    const { ctx, p, S } = await open(1440, "zh-TW", { room }); await p.click('[data-outline="t1"]'); await settle(p);
    await p.evaluate(() => document.querySelector('[data-tcard="1:n1"] [data-follow="example"]')?.click()); await until(() => S.turns.length === 1); await settle(p, 500);
    const tenth = await p.evaluate(() => [...document.querySelectorAll('[data-thread="1"] [data-paid-note]')].map((e) => e.textContent).find((x) => /已追問/.test(x)) ?? null);
    ok(!("confirm" in (S.turns[0] || {})) && /已追問 10 次 · 付費/.test(tenth || ""), "a follow-up the agreement started says so on its card: 已追問 n 次 · 付費", JSON.stringify([S.turns[0], tenth]));
    Object.assign(S.room.turns.at(-1), { status: "done", claims: [{ text: "Order 7731.", kind: "claim", basis: null, cites: [] }] }); S.room.running = null; S.room = clone(S.room);
    await p.waitForFunction(() => !document.querySelector("[data-thinking]"), null, { timeout: 15000 }).catch(() => {});
    await p.evaluate(() => document.querySelector('[data-tcard="1:n1"] [data-follow="deeper"]')?.click()); await p.waitForSelector("[data-pending]", { timeout: 5000 }).catch(() => {});
    const ask = await p.evaluate(() => ({ pending: !!document.querySelector("[data-pending]"), note: document.querySelector("[data-follow-limit]")?.textContent }));
    ok(ask.pending && S.turns.length === 1 && /10/.test(ask.note || ""), "after ten follow-ups the next one shows the plan and asks again, saying why", JSON.stringify(ask));
    await ctx.close(); }

  // ---------- sixty questions: the layout stays fast and nothing overlaps ----------
  { const room = boardRoom("zh-TW"), L = room.lesson, scenes = ["t1", "t1-2", "t1-4", "t1-5", "t1-6", "t1-9"], chapters = { t1: "what", "t1-2": "talks", "t1-4": "change", "t1-5": "change", "t1-6": "lifecycle", "t1-9": "watch" };
    for (let i = 0; i < 60; i++) { const sc = scenes[i % scenes.length], n = 100 + i, part = `p${i % 2}.s${i % 3}`, kind = sc === "t1-9" ? "risk" : "sentence", key = `${chapters[sc]}/${sc}/${kind}#${part}x${i}`;
      room.turns.push({ n, action: "ask", text: "q", lang: "zh-TW", status: "done", provider: "codex", model: "gpt-6", answer: "a", head: "a".repeat(40), claims: [{ text: `答案 ${i}：工作會再問一次閘道 [diff:src/recheck.ts:L10-30]。`, kind: "claim", basis: "cited", cites: [{ ref: "diff:src/recheck.ts:L10-30", ok: true }] }], thread: { n: 10 + i, node: "n1" } });
      L.threads.push({ n: 10 + i, key, anchor: { turn: 1, scene: sc, chapter: chapters[sc], kind, item: null, part: `${part}x${i}`, text: `問題 ${i}`, start: null, end: null }, locator: { type: "text", section: key }, nodes: [{ id: "n1", parent: null, rel: "root", chip: "deeper", q: null, versions: [n], code: null, at: "t" }], state: "open", at: "t", resolvedAt: null, merged: null }); }
    const { ctx, p } = await open(1440, "zh-TW", { room });
    const times = []; for (const k of ["t1-2", "t1-6", "t1"]) { await p.click(`[data-outline="${k}"]`); await settle(p, 200); times.push(await p.evaluate(() => window.crewReviewRoom.board.state.lastLayout)); }
    const g = await geo(p), bad = [];
    for (let i = 0; i < g.cards.length; i++) { for (let j = i + 1; j < g.cards.length; j++) if (hit(g.cards[i], g.cards[j])) bad.push(`${g.cards[i].id}×${g.cards[j].id}`); for (const b of g.bodies) if (hit(g.cards[i], b)) bad.push(`${g.cards[i].id}×${b.id}`); }
    ok(g.cards.length >= 64 && !bad.length, "sixty more questions on the board: no card overlaps another card or a region", JSON.stringify({ n: g.cards.length, bad: bad.slice(0, 6) }));
    ok(times.every((ms) => ms < 250), "a redraw with sixty more questions lays the board out without a stall (wall clock, loose: the layout count below is the guard)", JSON.stringify(times));
    // the layout reads every box before it writes any (the cards moved first, so a write left before a read would show): one forced layout, not one per card (Chromium's own count)
    const cdp = await ctx.newCDPSession(p); await cdp.send("Performance.enable");
    const layouts = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "LayoutCount")?.value ?? NaN;
    const l0 = await layouts(); await p.evaluate(() => { for (const c of document.querySelectorAll(".rb-card, .rb-tchip")) c.style.top = "0px"; window.crewReviewRoom.board.relayout("SC-60"); }); const forced = (await layouts()) - l0;
    ok(forced <= 2, "the layout reads every box before it writes any: sixty more questions force at most two layouts", String(forced));
    await ctx.close(); }

  // ---------- a pull request on GitHub: show the code goes through the room's citation opener (GitHub), never a card ----------
  { const room = boardRoom("zh-TW"); room.pr = { id: 318, url: "https://github.com/example/lumen-pay/pull/318" }; room.subject = { kind: "pr", room: "SC-60", url: room.pr.url, repository: "example/lumen-pay", number: 318 };
    const { ctx, p, S } = await open(1440, "zh-TW", { room }); await p.evaluate(() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push([String(u), t, f]); return null; }; });
    const cards0 = await p.$$eval('.rb-card[data-chip="code"]', (e) => e.length);
    await p.$eval('[data-akey="what/t1/sentence#p0.s0"]', (e) => e.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 500, clientY: 300 }))); await p.waitForSelector(".rb-pop");
    await p.click('.rb-pop [data-chip="code"]'); await until(async () => (await p.evaluate(() => window.__opened.length)) > 0 || S.cites.length > 0 || !!(await p.$("[data-cite-panel]")), 5000);
    const gh = await p.evaluate(() => ({ opened: window.__opened, panel: !!document.querySelector("[data-cite-panel]") }));
    ok(!S.lessons.some((x) => x.op === "code") && (await p.$$eval('.rb-card[data-chip="code"]', (e) => e.length)) === cards0 && gh.opened.length === 1 && /^https:\/\/github\.com\/example\/lumen-pay\/pull\/318\/files#diff-[0-9a-f]{64}R10-R30$/.test(gh.opened[0][0]) && gh.opened[0][1] === "_blank" && /noopener/.test(gh.opened[0][2]) && !gh.panel && !S.cites.length,
      "in a pull request's room 看程式碼 opens the pull request's files on GitHub at those lines in a new window, never an inline code card or Studio's panel", JSON.stringify({ gh, cites: S.cites, lessons: S.lessons }));
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
    const off = await p.evaluate(() => ({ paid: [...document.querySelectorAll('.rb-pop [data-chip]:not([data-chip="code"])')].map((b) => b.disabled), desk: document.querySelector("[data-ask-desktop]")?.textContent, code: !document.querySelector('.rb-pop [data-chip="code"]').disabled, input: !!document.querySelector(".rb-pop [data-pop-input]") }));
    ok(off.paid.length === 4 && off.paid.every(Boolean) && /在電腦上問/.test(off.desk || "") && off.code && !off.input && S.turns.length === 0, "a phone's paid chips are off, saying 在電腦上問 (a phone cannot start a paid round); show the code stays", JSON.stringify(off));
    await p.keyboard.press("Escape"); await p.click('[data-sheet="notes"]'); await settle(p, 200);
    const nt = await p.evaluate(() => ({ open: document.querySelector("[data-board-notes]").classList.contains("open"), n: document.querySelectorAll('[data-board-notes] [data-note-thread]').length, badge: document.querySelector('[data-sheet="notes"] b')?.textContent }));
    ok(nt.open && nt.n === 5 && nt.badge === "5", "標註 opens the questions as a sheet, its count on the button", JSON.stringify(nt));
    await p.click('[data-board-notes] [data-note-thread="1"]', { timeout: 3000 }).catch(() => {}); await settle(p, 300);
    const tap = await p.evaluate(() => ({ focus: document.querySelector("[data-board-plane]")?.dataset.focus, sheet: document.querySelector("[data-board-notes]")?.classList.contains("open") }));
    ok(tap.focus === "1" && !tap.sheet, "a tap on a question in the phone's sheet opens that thread (the sheet sits over its scrim)", JSON.stringify(tap));
    const cardOff = await p.evaluate(() => { const c = document.querySelector('[data-tcard="1:n1"]'); return { off: [...c.querySelectorAll("[data-follow]")].map((b) => b.disabled), desk: c.querySelector("[data-ask-desktop]")?.textContent }; });
    ok(cardOff.off.length === 3 && cardOff.off.every(Boolean) && /在電腦上問/.test(cardOff.desk || ""), "on a phone a card's follow-ups are off and the card says 在電腦上問", JSON.stringify(cardOff));
    await ctx.close(); }
  // a narrow window on this Mac is not a phone: the server says who is looking
  { const { ctx, p } = await open(390, "zh-TW", { viewer: "desktop" }); if (await p.$("[data-board-rail].open")) { await p.click('[data-outline="t1-6"]'); await settle(p, 300); }
    const a = await p.$('[data-region="t1-6"] [data-akind="sentence"]'); const ab = await a.boundingBox(); await p.mouse.click(ab.x + 10, ab.y + 6); await p.waitForSelector(".rb-pop", { timeout: 5000 }).catch(() => {});
    const on = await p.evaluate(() => ({ paid: [...document.querySelectorAll('.rb-pop [data-chip]:not([data-chip="code"])')].map((b) => b.disabled), desk: !!document.querySelector("[data-ask-desktop]") }));
    ok(on.paid.length === 4 && on.paid.every((d) => !d) && !on.desk, "a narrow window on the Mac is not a phone: its paid chips stay on", JSON.stringify(on));
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
