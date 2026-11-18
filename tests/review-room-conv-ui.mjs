import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The lesson board's conversation pane (public/review-board.js convPane, review-board.css .rb-conv): the questions asked on the
// board and the tutor's whole answers are read in the right-hand pane, at full size (14 px), scrolling inside it with the newest at
// the bottom and the ask box at its foot; the canvas keeps the chapters, their drawings and the numbered pins, no answer card, so
// the camera frames a chapter whole at 0.9 or more at 1440 (0.88 at 1280). The pane keeps the room's splitter (dragged or moved
// with the keyboard, its width kept across a reload). A question picked in the pane flies the camera to its chapter with its place
// lit; a chapter picked in the rail scrolls the pane to its questions. A phone reads the conversation in a sheet, a narrow window
// over the board, never scrolling sideways. Invented rooms (tests/lib/review-board-fixture.mjs): nothing paid runs.
//        node tests/review-room-conv-ui.mjs            (SHOTS=<dir> also saves screenshots at 1280, 1440 and 1920, light and dark, en and zh-TW)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { boardRoom } from "./lib/review-board-fixture.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-conv-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-conv-ui-")), data = join(tmp, "data"); mkdirSync(data);
const port = await freePort(), SHOTS = process.env.SHOTS || "";
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

/** the board on the invented lesson, at a width, in a language and a theme; the page asks nothing of a model */
async function open(width, o = {}) {
  const phone = width <= 760, lang = o.lang || "en";
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: o.dark ? "dark" : "light", reducedMotion: "reduce", hasTouch: phone && width < 600 });
  await ctx.addInitScript((lg) => { try { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("crew.lang", lg); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); sessionStorage.setItem("seeded", "1"); } } catch {}
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak: () => {}, cancel: () => {} } }); window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; }, lang);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/api\/remote\/me$/, (r) => r.fulfill({ json: { kind: "desktop", device: null } }));
  const room = boardRoom(lang);
  await ctx.route(/\/api\/review-room\/SC-60(\?open=1)?$/, (r) => r.fulfill({ json: room }));
  await ctx.route(/\/api\/review-room\/SC-60\/explain$/, (r) => r.fulfill({ json: { selected: null, skills: [], versions: [], runs: [] } }));
  await ctx.route(/\/api\/review-room\/SC-60\/lesson$/, (r) => r.fulfill({ json: { visited: room.lesson.visited } }));
  await ctx.route(/\/api\/review-room\/SC-60\/arrive$/, (r) => r.fulfill({ json: {} }));
  await ctx.route(/\/api\/review-room\/SC-60\/cite\?/, (r) => r.fulfill({ json: { kind: "diff", text: "@@ -40,3 +40,6 @@\n-  if (age > 30 * MIN) expire(p)\n+  if (age > 30 * MIN) {\n+    if (await askAgain(p)) return settle(p)\n+    expire(p)\n+  }" } }));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width} ${lang}: ${e.message}`));
  await p.goto(`${base}/#/room/SC-60`);
  await p.waitForSelector("[data-board-vp] [data-region]", { timeout: 15000 }); await p.waitForTimeout(500);
  return { ctx, p };
}
const LIST = "[data-board-notes] [data-conv-list]";
/** the newest answer in the pane: its text size and whether it is whole in the pane's scrolling list */
const newest = (p) => p.evaluate((sel) => { const list = document.querySelector(sel); if (!list) return null; const cards = [...list.querySelectorAll(".rb-card[data-thread]:not([data-pending])")], c = cards.at(-1); if (!c) return { n: 0 };
  const lr = list.getBoundingClientRect(), cr = c.getBoundingClientRect(), para = c.querySelector(".rb-cbody p") || c.querySelector(".rb-cbody");
  return { n: cards.length, thread: c.dataset.thread, font: parseFloat(getComputedStyle(para).fontSize), whole: cr.top >= lr.top - 1 && cr.bottom <= lr.bottom + 1 && cr.left >= lr.left - 1 && cr.right <= lr.right + 1, scrolls: getComputedStyle(list).overflowY,
    text: para.textContent.slice(0, 40) }; }, LIST);
/** the camera on the region in view: its scale, and whether the region is whole across the board */
const framed = (p) => p.evaluate(() => { const id = "SC-60", B = window.crewReviewRoom.board, L = B.layoutOf(id), cur = document.querySelector("[data-board]").dataset.scene, r = L?.R[cur], cam = B.camOf(id), vp = document.querySelector("[data-board-vp]").getBoundingClientRect();
  if (!r) return { cur }; const left = vp.left + cam.x + r.x * cam.s, right = left + r.W * cam.s; return { cur, s: Math.round(cam.s * 1000) / 1000, whole: left >= vp.left - 1 && right <= vp.right + 1, W: r.W, vp: Math.round(vp.width) }; });
const settle = (p, ms = 600) => p.waitForTimeout(ms);

try {
  // ---------- 1280, 1440, 1920: the conversation in the pane, the board alone on the canvas ----------
  for (const width of [1280, 1440, 1920]) {
    const { ctx, p } = await open(width);
    const nw = await newest(p);
    ok(nw && nw.n >= 4 && nw.thread === "5" && nw.font >= 13 && nw.whole && nw.scrolls === "auto", `${width}: the newest answer is at the bottom of the pane, whole and at ${nw?.font} px (13 or more)`, JSON.stringify(nw));
    const canvas = await p.evaluate(() => ({ cards: document.querySelectorAll("[data-board-vp] .rb-card, [data-board-vp] .rb-tchip, [data-board-vp] [data-board-links]").length,
      pins: document.querySelectorAll("[data-board-vp] .rb-pin").length, pane: document.querySelectorAll("[data-board-notes] .rb-card").length }));
    ok(canvas.cards === 0 && canvas.pins > 0 && canvas.pane >= 4, `${width}: no answer card on the canvas (its pins stay); the cards are in the pane`, JSON.stringify(canvas));
    // every chapter, flown to from the rail, is whole across the board at a readable scale
    const want = width >= 1440 ? 0.9 : 0.88, seen = [];
    for (const key of await p.$$eval("[data-board-rail] [data-outline]", (els) => els.map((e) => e.dataset.outline).filter((k) => k !== "end"))) {
      await p.click(`[data-board-rail] [data-outline="${key}"]`); await settle(p, 250); seen.push({ key, ...(await framed(p)) }); }
    const bad = seen.filter((x) => !(x.s >= want && x.whole));
    ok(seen.length >= 8 && !bad.length, `${width}: every chapter flown to is whole on the board at ${want} or more`, JSON.stringify(bad.length ? bad : seen.map((x) => x.s)));
    if (width === 1440) { await p.click('[data-board-rail] [data-outline="t1"]'); await settle(p, 250); const f = await framed(p); ok(f.s >= 0.9, "1440: the board's default zoom is 0.9 or more", JSON.stringify(f)); }
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no sideways scroll`);
    await ctx.close();
  }

  // ---------- picking: a question flies the camera to its place; a chapter scrolls the pane to its questions ----------
  {
    const { ctx, p } = await open(1440);
    await p.click('[data-board-notes] [data-note-thread="3"]'); await settle(p, 800);
    const f = await p.evaluate(() => { const B = window.crewReviewRoom.board, L = B.layoutOf("SC-60"), cam = B.camOf("SC-60"), vp = document.querySelector("[data-board-vp]").getBoundingClientRect(), a = document.querySelector("[data-board-vp] [data-akey].lit");
      const ar = a?.getBoundingClientRect(), r = L.R["t1-6"], left = vp.left + cam.x + r.x * cam.s;
      return { scene: document.querySelector("[data-board]").dataset.scene, focus: document.querySelector("[data-board-plane]").dataset.focus, lit: a?.dataset.akey, inView: !!ar && ar.top >= vp.top && ar.bottom <= vp.bottom && ar.left >= vp.left && ar.right <= vp.right,
        whole: left >= vp.left - 1 && left + r.W * cam.s <= vp.right + 1, s: cam.s, entry: document.querySelector('[data-conv-thread="3"]')?.classList.contains("lit") }; });
    ok(f.scene === "t1-6" && f.focus === "3" && /lifecycle\/t1-6\/transition/.test(f.lit || "") && f.inView && f.whole && f.s >= 0.9 && f.entry, "a question picked in the pane flies the camera to its chapter, its place lit and in view", JSON.stringify(f));
    await p.keyboard.press("Escape"); await settle(p, 300);
    ok(await p.evaluate(() => !document.querySelector("[data-board-plane]").dataset.focus && !document.querySelector("[data-board-vp] [data-akey].lit")), "Escape leaves the focus");
    // the pane at its newest; the first chapter picked in the rail: its questions scroll into the pane
    await p.evaluate((sel) => { const l = document.querySelector(sel); l.scrollTop = l.scrollHeight; }, LIST); await settle(p, 100);
    await p.click('[data-board-rail] [data-outline="t1-2"]'); await settle(p, 300);
    await p.click('[data-board-rail] [data-outline="t1"]'); await settle(p, 500);
    const sc = await p.evaluate((sel) => { const l = document.querySelector(sel), e = l.querySelector('[data-conv-scene="t1"]'), lr = l.getBoundingClientRect(), er = e.getBoundingClientRect();
      return { top: Math.round(er.top - lr.top), here: [...l.querySelectorAll(".rb-thread.here")].map((x) => x.dataset.convThread) }; }, LIST);
    ok(sc.top >= 0 && sc.top < 40 && JSON.stringify(sc.here) === '["1","5"]', "a chapter picked in the rail scrolls the pane to its questions and marks them", JSON.stringify(sc));
    // the chapter's question badge opens the conversation on them
    await p.click('[data-board-rail] [data-outline="t1-6"]'); await settle(p, 400);
    await p.click('[data-region-questions="t1-6"]'); await settle(p, 300);
    const bd = await p.evaluate((sel) => { const l = document.querySelector(sel), e = l.querySelector('[data-conv-scene="t1-6"]'), lr = l.getBoundingClientRect(), er = e.getBoundingClientRect(); return Math.round(er.top - lr.top); }, LIST);
    ok(bd >= 0 && bd < 40, "a chapter's question badge scrolls the pane to its questions", String(bd));
    // a pin on the board scrolls the pane to its thread
    await p.evaluate((sel) => { document.querySelector(sel).scrollTop = 0; }, LIST);
    await p.click('[data-board-rail] [data-outline="t1"]'); await settle(p, 400);
    await p.click('[data-pin-for="what/t1/sentence#p0.s0"]'); await settle(p, 600);
    const pin = await p.evaluate((sel) => { const l = document.querySelector(sel), e = l.querySelector('[data-conv-thread="5"]'), lr = l.getBoundingClientRect(), er = e.getBoundingClientRect(); return { top: Math.round(er.top - lr.top), bottom: Math.round(er.bottom - lr.top), h: Math.round(lr.height), lit: e.classList.contains("lit") }; }, LIST);
    ok(pin.top >= 0 && pin.bottom <= pin.h + 1 && pin.lit, "a pin on the board scrolls the pane to its question", JSON.stringify(pin));
    await p.keyboard.press("Escape");

    // ---------- the splitter: the pane's width changes and is kept; its text stays readable ----------
    const w0 = await p.$eval("[data-board-notes]", (e) => Math.round(e.getBoundingClientRect().width));
    const r = await p.$eval('[data-pane-split="board"]', (e) => e.getBoundingClientRect().toJSON()), cy = r.y + r.height / 2;
    await p.mouse.move(r.x + r.width / 2, cy); await p.mouse.down(); await p.mouse.move(r.x + r.width / 2 - 140, cy, { steps: 6 }); await p.mouse.up(); await settle(p, 700);
    const w1 = await p.$eval("[data-board-notes]", (e) => Math.round(e.getBoundingClientRect().width));
    await p.reload(); await p.waitForSelector("[data-board-notes] [data-conv-list]", { timeout: 15000 }); await settle(p, 500);
    const w2 = await p.$eval("[data-board-notes]", (e) => Math.round(e.getBoundingClientRect().width)), nw = await newest(p);
    ok(Math.abs(w1 - (w0 + 140)) <= 2 && Math.abs(w2 - w1) <= 2 && nw.font >= 13 && nw.whole, "the splitter widens the conversation; the width is kept across a reload, the newest answer still whole", JSON.stringify({ w0, w1, w2, nw }));
    await p.dblclick('[data-pane-split="board"]'); await settle(p, 300);

    // ---------- the ask box: a follow-up on the question in focus waits for its confirmation in the pane ----------
    await p.click('[data-board-notes] [data-note-thread="3"]'); await settle(p, 600);
    const to = await p.textContent("[data-conv-ask] .rb-convto");
    await p.fill("[data-conv-q]", "Why thirty and not sixty?"); await p.press("[data-conv-q]", "Enter"); await settle(p, 400);
    const pend = await p.evaluate((sel) => { const l = document.querySelector(sel), c = l.querySelector("[data-pending]"), lr = l.getBoundingClientRect(), cr = c?.getBoundingClientRect();
      return { thread: c?.closest("[data-conv-thread]")?.dataset.convThread, label: c?.querySelector(".rb-cq")?.textContent, visible: !!cr && cr.top < lr.bottom && cr.bottom > lr.top, onCanvas: !!document.querySelector("[data-board-vp] [data-pending]") }; }, LIST);
    ok(/#3/.test(to) && pend.thread === "3" && /Why thirty and not sixty\?/.test(pend.label || "") && pend.visible && !pend.onCanvas, "the ask box follows up on the question in focus: its card waits for the confirmation in the pane", JSON.stringify({ to, pend }));
    await ctx.close();
  }

  // ---------- a card with versions (say it another way) and a drawing its answer made: whole in the pane; the drawing opens whole ----------
  {
    const { ctx, p } = await open(1440);
    await p.click('[data-board-notes] [data-tchip="2"]'); await settle(p, 400);
    const st = await p.evaluate((sel) => { const l = document.querySelector(sel).getBoundingClientRect(), c = document.querySelector('[data-board-notes] [data-tcard="2:n1"]'), cr = c.getBoundingClientRect();
      const btns = [...c.querySelectorAll(".rb-acts button")].map((b) => b.getBoundingClientRect()), head = c.querySelector(".rb-ch").getBoundingClientRect(), fig = c.querySelector('[data-card-figure="B5-1"] .rp-fig'), svg = fig?.querySelector("svg")?.getBoundingClientRect();
      return { display: getComputedStyle(c).display, inPane: cr.left >= l.left - 1 && cr.right <= l.right + 1, btns: btns.length, btnsIn: btns.every((b) => b.left >= cr.left && b.right <= cr.right + 1), head: Math.round(head.height), tabs: c.querySelectorAll("[data-version-tab]").length,
        fig: svg ? Math.round(svg.width) : 0, whole: !!fig && fig.scrollHeight <= fig.clientHeight + 1 && fig.scrollWidth <= fig.clientWidth + 1 }; }, LIST);
    ok(st.display === "block" && st.inPane && st.btns >= 4 && st.btnsIn && st.head < 40 && st.tabs === 2, "a card with versions reads as one block in the pane: its head on one line, its version tabs, every button inside it", JSON.stringify(st));
    ok(st.fig >= 200 && st.whole, "a drawing an answer made shows whole at the pane's width", JSON.stringify(st));
    await p.click('[data-board-notes] [data-card-figure="B5-1"] .rp-fig', { timeout: 3000 }).catch(() => {}); await settle(p, 300);
    const v = await p.evaluate(() => { const d = document.querySelector('[data-fig-viewer="B5-1"]'); return { open: !!d, svg: !!d?.querySelector("svg") }; });
    await p.keyboard.press("Escape"); await settle(p, 200);
    ok(v.open && v.svg && !(await p.$("[data-fig-viewer]")), "a click on that drawing opens it whole in the room's figure viewer; Escape closes it", JSON.stringify(v));
    await ctx.close();
  }

  // ---------- a sentence's pin opens the pane on its question: on a desktop with the pane closed, on a narrow window, on a phone ----------
  for (const width of [1440, 1000, 390]) {
    const { ctx, p } = await open(width);
    if (width <= 760 && await p.$(".rb-rail.open")) { await p.keyboard.press("Escape"); await settle(p, 300); }
    if (width > 1180) { await p.click("[data-notes-toggle]"); await settle(p, 300); }
    const closed = await p.evaluate(() => { const n = document.querySelector("[data-board-notes]"); return !n || !n.getClientRects().length || (n.getBoundingClientRect().top >= innerHeight - 1) || !n.closest(".rb-view") || getComputedStyle(n).transform !== "none" && !n.classList.contains("open"); });
    await p.evaluate(() => document.querySelector('[data-board-vp] .rb-s .rb-pin[data-pin-for="what/t1/sentence#p0.s0"]').click()); await settle(p, 600);
    const o = await p.evaluate((sel) => { const l = document.querySelector(sel), lr = l?.getBoundingClientRect(), e = l?.querySelector('[data-conv-thread="5"]'), er = e?.getBoundingClientRect();
      return { pane: !!lr && lr.width > 200 && lr.height > 100 && lr.left < innerWidth && lr.top < innerHeight, entry: !!er && er.top >= lr.top - 1 && er.top < lr.bottom, lit: !!e?.classList.contains("lit") }; }, LIST);
    ok(closed && o.pane && o.entry && o.lit, `${width}: a sentence's pin opens the closed conversation on its question`, JSON.stringify({ closed, o }));
    await ctx.close();
  }

  // ---------- 1280: a chapter's drawing is never smaller on screen than beside the follow-up column (main: 337 to 368 px) ----------
  {
    const { ctx, p } = await open(1280), sizes = [];
    for (const key of ["t1-2", "t1-6", "t1-7", "t1-8"]) { await p.click(`[data-board-rail] [data-outline="${key}"]`); await settle(p, 300);
      sizes.push(await p.evaluate((k) => { const s = document.querySelector(`[data-region="${k}"] .rb-illus .rp-figbody svg`) || document.querySelector(`[data-region="${k}"] .rb-illus .rp-fig`); return { key: k, w: s ? Math.round(s.getBoundingClientRect().width) : 0 }; }, key)); }
    ok(sizes.every((x) => x.w >= 368), "1280: every chapter's drawing is 368 px or wider on screen (as wide as beside the old follow-up column, or wider)", JSON.stringify(sizes));
    await ctx.close();
  }

  // ---------- zh-TW and dark: the same pane ----------
  {
    const { ctx, p } = await open(1440, { lang: "zh-TW", dark: true });
    const nw = await newest(p), head = await p.textContent("[data-board-notes] .rb-convhead h3");
    const bg = await p.evaluate(() => { const c = getComputedStyle(document.querySelector("[data-board-notes] .rb-card")); return { bg: c.backgroundColor, ink: c.color }; });
    ok(nw.whole && nw.font >= 13 && head === "問答" && bg.bg !== "rgb(255, 255, 255)", "zh-TW, dark: the conversation reads in the dark theme", JSON.stringify({ nw, head, bg }));
    await ctx.close();
  }

  // ---------- narrow: a phone's sheet, a narrow window's overlay; never sideways ----------
  for (const width of [390, 760, 1000]) {
    const { ctx, p } = await open(width);
    // a phone opens on its outline sheet: closed first (Escape), then the conversation's sheet from the bar
    if (width <= 760) { if (await p.$(".rb-rail.open")) { await p.keyboard.press("Escape"); await settle(p, 300); } await p.click('[data-sheet="notes"]'); } else await p.click("[data-notes-toggle]");
    await settle(p, 500);
    const n = await p.evaluate((sel) => { const l = document.querySelector(sel), lr = l?.getBoundingClientRect(), c = l?.querySelector(".rb-card .rb-cbody p");
      return { hscroll: document.documentElement.scrollWidth > innerWidth, list: !!lr && lr.width > 200 && lr.height > 150 && lr.right <= innerWidth + 1, font: c ? parseFloat(getComputedStyle(c).fontSize) : 0, split: [...document.querySelectorAll('[data-pane-split="board"]')].some((s) => s.getBoundingClientRect().width > 0) }; }, LIST);
    ok(!n.hscroll && n.list && n.font >= 13 && !n.split, `${width}: the conversation opens ${width <= 760 ? "as a sheet" : "over the board"}, readable, no sideways scroll, no splitter`, JSON.stringify(n));
    await ctx.close();
  }

  // ---------- screenshots (SHOTS=<dir>) ----------
  if (SHOTS) for (const lang of ["en", "zh-TW"]) for (const dark of [false, true]) for (const width of [1280, 1440, 1920]) {
    const { ctx, p } = await open(width, { lang, dark }); await settle(p, 400);
    await p.screenshot({ path: join(SHOTS, `after-${width}-${dark ? "dark" : "light"}-${lang}.png`) }); await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-2000)); }
finally { await browser.close().catch(() => {}); app.kill(); }
console.log(`review-room-conv-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
