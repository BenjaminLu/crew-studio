import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room's right-hand pane (public/review-room.js crewRoomPane, review-room.css .rr-split, review-board.css): the board's
// questions and the skill's chat read wider by default (the chat 440 px or more at 1440, the questions 340), the room uses the whole
// screen on a wide one; the splitter before the pane is a focusable separator the arrow keys, Home and End move within its
// bounds, dragging resizes it, the width is kept per view across a reload, a double-click goes back to the default; long chat
// scrolls inside the pane (never the page), its citations stay on one line each; a phone and a narrow window never scroll
// sideways and show no splitter. The rooms are answered by the test from invented data: nothing paid runs.
//        node tests/review-room-pane-ui.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { boardRoom } from "./lib/review-board-fixture.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-pane-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-pane-ui-")), data = join(tmp, "data"); mkdirSync(data);
const port = await freePort();
const sha = (b) => createHash("sha256").update(b).digest("hex");
// a made-up pull request's room shown by a made-up skill: one version on disk (its page served by Studio), follow-ups answered
const REPO = "sample-org/money-kit", ID = `PR-${sha(REPO).slice(0, 12)}-7`, H = "a".repeat(40), B = "b".repeat(40);
const prDir = join(data, "review-room", "pr"), xdir = join(prDir, `${ID}-explain`); mkdirSync(join(xdir, "v1"), { recursive: true });
writeFileSync(join(prDir, `${ID}.json`), JSON.stringify({ schema: 1, run: "", card: ID, node: "", head: H, base: B, turns: [], board: [], sources: [], check: { questions: [] },
  subject: { kind: "pr", room: ID, url: `https://github.com/${REPO}/pull/7`, repository: REPO, number: 7, project: null, task: null },
  pr: { title: "Add percent", body: "", state: "open", merged: false, mergedAt: null, closedAt: null, draft: false, author: "someone", headRef: "percent", headRepo: REPO, baseRef: "main", head: H, base: B, files: [], notes: [], checkedAt: "2026-11-01T10:00:00Z", truncated: false } }));
const page = "<!doctype html><html><head><meta charset=\"utf-8\"><title>percent</title></head><body><h1>How percent works</h1><p>It rounds once, at the end.</p></body></html>";
writeFileSync(join(xdir, "v1", "index.html"), page);
const versions = [{ n: 1, run: 1, skill: { id: "walkthrough", v: 1, name: "walkthrough" }, at: "2026-11-01T10:01:00Z", entry: "index.html", kind: "html", files: [{ path: "index.html", bytes: Buffer.byteLength(page), sha256: sha(page) }], summary: "One page: percent", from: null }];
writeFileSync(join(xdir, "state.json"), JSON.stringify({ schema: 1, selected: { id: "walkthrough", v: 1 }, runs: [], versions }));
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
const ROOM = { card: { id: ID, run: "R-050", node: "review", title: { en: "Pull request #7: Add percent", "zh-TW": "Pull request #7：Add percent" }, status: "open" }, task: { id: "R-050", title: "Add percent" }, pr: { id: "7", url: `https://github.com/${REPO}/pull/7` }, summary: null,
  subject: { kind: "pr", room: ID, url: `https://github.com/${REPO}/pull/7`, repository: REPO, number: 7 }, head: H, base: B, open: true, running: null, diffstat: { files: [{ path: "src/percent.ts", added: 4, removed: 0 }], total: { files: 1, added: 4, removed: 0 }, from: "git" },
  offer: null, actions: [], board: [], turns: [], sources: [], check: { questions: [] }, tutors: [], prState: { state: "open", draft: false, approved: false, checkedAt: "2026-11-01T10:00:00Z", headRepo: REPO, verdicts: [] } };
const run = (n, kind, extra = {}) => ({ n, kind, skill: { id: "walkthrough", v: 1, name: "walkthrough", sha256: "x" }, status: "done", by: "captain", at: "2026-11-01T10:00:00Z", ended: "2026-11-01T10:04:00Z", provider: "claude", model: "claude-opus-5", effort: null, confirm: "c", limitMin: 120, rounds: [], cost: { usd: 0.42 }, error: null, progress: [], from: null, version: null, ...extra });
const ANSWER = "Rounding happens once, at the end: percent() multiplies the part by 100 first and only then divides by the total, so no intermediate value is truncated.\n\nThe old code rounded twice, once inside ratio() and once in format(), and the two could disagree by one.";
const X = (asks) => ({ selected: { id: "walkthrough", v: 1 }, skills: [{ id: "walkthrough", name: "walkthrough", description: "x", v: 1, own: true }], versions, running: null, consent: null, log: [], settings: { limitMin: 120 }, busy: false,
  runs: [run(1, "generate", { version: 1 }), ...Array.from({ length: asks }, (_, i) => run(i + 2, "ask", { question: `Why does 2.5 round up here (${i + 1})?`, answer: ANSWER, cites: ["src/percent.ts:L3-L9", "src/percent.test.ts:L12", "commit:abc1234", "a/very/long/path/that/goes/on/and/on/percent-helpers.ts:L120-L180"] }))] });

/** a page on a room; mode: "board" (the tutor's lesson board) or "explain" (a skill's output and its chat) */
async function open(mode, width, o = {}) {
  const phone = width < 600, ctx = o.ctx ?? await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: o.dark ? "dark" : "light", reducedMotion: "reduce" });
  if (!o.ctx) {
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); sessionStorage.setItem("seeded", "1"); } } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed"));
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak: () => {}, cancel: () => {} } }); window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route(/\/api\/remote\/me$/, (r) => r.fulfill({ json: { kind: phone ? "phone" : "desktop", device: null } }));
    const room = boardRoom("en");
    await ctx.route(/\/api\/review-room\/SC-60(\?open=1)?$/, (r) => r.fulfill({ json: room }));
    await ctx.route(/\/api\/review-room\/SC-60\/explain$/, (r) => r.fulfill({ json: { selected: null, skills: [], versions: [], runs: [] } }));
    await ctx.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
    await ctx.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
    await ctx.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: X(o.asks ?? 2) }));
  }
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${mode} ${width}: ${e.message}`));
  await p.goto(`${base}/#/room/${mode === "board" ? "SC-60" : ID}`);
  await p.waitForSelector(mode === "board" ? "[data-board-vp]" : "[data-x-msgs] [data-explain-answer]", { timeout: 15000 }); await p.waitForTimeout(400);
  return { ctx, p };
}
const PANE = { board: ".rb-view > .rb-notes", explain: ".rx-body > .rx-chat" };
const paneW = (p, mode) => p.$eval(PANE[mode], (e) => Math.round(e.getBoundingClientRect().width));
const split = (mode) => `[data-pane-split="${mode}"]`;
const MIN = { board: 300, explain: 320 };
// the default at 1440 and at 1920: the chat reads at 60 to 75 characters a line; the questions panel leaves the board the width
// its camera needs to show a card and the follow-up beside it (tests/review-room-board-ui.mjs)
const AT1440 = { board: 340, explain: 440 }, AT1920 = { board: 450, explain: 540 };

try {
  for (const mode of ["board", "explain"]) {
    // ---------- the default: a comfortable reading width at 1440; the room fills a wide screen ----------
    const { ctx, p } = await open(mode, 1440);
    const def = await paneW(p, mode);
    ok(def >= AT1440[mode] && def <= 600, `${mode}: the right-hand pane is ${AT1440[mode]} px or more by default at 1440 (it was 272 / 340)`, String(def));
    const sp = await p.evaluate((sel) => { const e = document.querySelector(sel); return e && { role: e.getAttribute("role"), orient: e.getAttribute("aria-orientation"), tab: e.tabIndex, label: e.getAttribute("aria-label"), now: Number(e.getAttribute("aria-valuenow")), min: Number(e.getAttribute("aria-valuemin")), max: Number(e.getAttribute("aria-valuemax")), r: e.getBoundingClientRect().toJSON() }; }, split(mode));
    ok(sp && sp.role === "separator" && sp.orient === "vertical" && sp.tab === 0 && !!sp.label && sp.r.width > 0 && sp.r.height > 100, `${mode}: a focusable vertical separator sits before the pane`, JSON.stringify(sp));
    ok(sp && Math.abs(sp.now - def) <= 1 && sp.min === MIN[mode] && sp.max > sp.min && sp.max <= 720, `${mode}: the separator says its width and bounds`, JSON.stringify(sp));

    // ---------- the keyboard: arrows (Shift for more), Home and End, Enter resets ----------
    await p.focus(split(mode));
    await p.keyboard.press("ArrowLeft"); await p.keyboard.press("ArrowLeft"); await p.waitForTimeout(80);
    const k1 = await paneW(p, mode);
    await p.keyboard.press("Shift+ArrowLeft"); await p.waitForTimeout(80); const k2 = await paneW(p, mode);
    await p.keyboard.press("ArrowRight"); await p.waitForTimeout(80); const k3 = await paneW(p, mode);
    ok(Math.abs(k1 - (def + 32)) <= 2 && Math.abs(k2 - (k1 + 64)) <= 2 && Math.abs(k3 - (k2 - 16)) <= 2, `${mode}: ← widens the pane, Shift+← by more, → narrows it`, JSON.stringify([def, k1, k2, k3]));
    await p.keyboard.press("Home"); await p.waitForTimeout(80); const lo = await paneW(p, mode);
    await p.keyboard.press("End"); await p.waitForTimeout(80); const hi = await paneW(p, mode);
    const bounds = await p.evaluate((sel) => { const e = document.querySelector(sel); return [Number(e.getAttribute("aria-valuemin")), Number(e.getAttribute("aria-valuemax")), Number(e.getAttribute("aria-valuenow"))]; }, split(mode));
    ok(Math.abs(lo - MIN[mode]) <= 1 && Math.abs(hi - bounds[1]) <= 1 && hi <= 720 && Math.abs(bounds[2] - hi) <= 1, `${mode}: Home and End go to the bounds; the separator follows`, JSON.stringify({ lo, hi, bounds }));
    await p.keyboard.press("Enter"); await p.waitForTimeout(80);
    ok(Math.abs(await paneW(p, mode) - def) <= 1, `${mode}: Enter goes back to the default width`);
    // the room redraws (the board on a settled width, a live update): the splitter keeps the keyboard
    await p.keyboard.press("ArrowLeft"); await p.waitForTimeout(600);
    if (mode === "board") await p.evaluate(() => window.crewReviewRoom.board && dispatchEvent(new Event("resize"))); await p.waitForTimeout(400);
    ok(await p.evaluate((sel) => document.activeElement?.matches(sel), split(mode)), `${mode}: after the room redraws, the splitter still has the keyboard`, await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
    if (mode === "board") {
      // the board lays its scenes out for the width it has beside the pane
      const fit = async () => p.evaluate(() => { const vp = document.querySelector("[data-board-vp]"), w = [...document.querySelectorAll(".rb-region")].map((r) => r.offsetWidth); return { vp: vp.clientWidth, first: w[0] }; });
      await p.keyboard.press("Enter"); await p.waitForTimeout(700); const a = await fit();
      await p.keyboard.press("End"); await p.waitForTimeout(700); const b = await fit();
      ok(a.first <= a.vp && b.first < a.first, "board: a scene is as wide as the board beside the pane, and narrows when the pane widens", JSON.stringify({ a, b }));
    }
    await p.keyboard.press("Enter"); await p.waitForTimeout(700);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${mode}: resizing never scrolls the page sideways`);

    // ---------- dragging: within the bounds; kept across a reload; double-click resets ----------
    const r = await p.$eval(split(mode), (e) => e.getBoundingClientRect().toJSON()), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx - 60, cy, { steps: 4 }); await p.mouse.move(cx - 120, cy, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(80);
    const dragged = await paneW(p, mode);
    ok(Math.abs(dragged - (def + 120)) <= 2, `${mode}: dragging the splitter 120 px left widens the pane by as much`, JSON.stringify({ def, dragged }));
    const r2 = await p.$eval(split(mode), (e) => e.getBoundingClientRect().toJSON());
    await p.mouse.move(r2.x + 6, cy); await p.mouse.down(); await p.mouse.move(40, cy, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(80);
    const far = await paneW(p, mode);
    const r3 = await p.$eval(split(mode), (e) => e.getBoundingClientRect().toJSON());
    await p.mouse.move(r3.x + 6, cy); await p.mouse.down(); await p.mouse.move(1430, cy, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(80);
    const near = await paneW(p, mode);
    ok(far <= 720 && Math.abs(far - bounds[1]) <= 1 && Math.abs(near - MIN[mode]) <= 1, `${mode}: a drag past either end stops at the bounds`, JSON.stringify({ far, near, bounds }));
    const r4 = await p.$eval(split(mode), (e) => e.getBoundingClientRect().toJSON());
    await p.mouse.move(r4.x + 6, cy); await p.mouse.down(); await p.mouse.move(r4.x + 6 - 150, cy, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(80);
    const kept = await paneW(p, mode);
    await p.reload(); await p.waitForSelector(PANE[mode], { timeout: 15000 }); await p.waitForTimeout(400);
    const after = await paneW(p, mode);
    ok(kept > MIN[mode] + 60 && Math.abs(after - kept) <= 2, `${mode}: the captain's width is kept across a reload`, JSON.stringify({ kept, after }));
    await p.dblclick(split(mode)); await p.waitForTimeout(80);
    ok(Math.abs(await paneW(p, mode) - def) <= 1 && await p.evaluate((k) => { try { return localStorage.getItem(k) == null; } catch { return false; } }, `crew.roomPane.${mode}`), `${mode}: a double-click goes back to the default and forgets the width`);
    await ctx.close();

    // ---------- a wide screen: the room uses its width, the pane its full default ----------
    const w = await open(mode, 1920);
    const wide = await w.p.evaluate((sel) => ({ room: Math.round(document.querySelector(".rr-room").getBoundingClientRect().width), main: Math.round(innerWidth - (document.querySelector(".side")?.getBoundingClientRect().width || 0)), pane: Math.round(document.querySelector(sel).getBoundingClientRect().width) }), PANE[mode]);
    ok(wide.room >= wide.main - 2 && wide.pane >= AT1920[mode], `${mode}: at 1920 the room fills the screen and the pane is ${AT1920[mode]} px or more`, JSON.stringify(wide));
    await w.ctx.close();
  }

  // ---------- the chat's text: long follow-ups scroll inside the pane; citations stay on one line ----------
  {
    const { ctx, p } = await open("explain", 1440, { asks: 12 });
    const m = await p.evaluate(() => { const list = document.querySelector("[data-x-msgs]"), cites = [...document.querySelectorAll(".rx-cite")];
      return { scrolls: list.scrollHeight > list.clientHeight + 50, overflow: getComputedStyle(list).overflowY, page: document.documentElement.scrollHeight <= innerHeight + 1 && document.scrollingElement.scrollTop === 0,
        oneLine: cites.every((c) => c.getBoundingClientRect().height <= 22), inside: cites.every((c) => c.getBoundingClientRect().right <= c.closest(".rx-m").getBoundingClientRect().right + 0.5),
        font: parseFloat(getComputedStyle(document.querySelector("[data-explain-answer] p")).fontSize), lh: parseFloat(getComputedStyle(document.querySelector("[data-explain-answer]")).lineHeight) / parseFloat(getComputedStyle(document.querySelector("[data-explain-answer]")).fontSize) }; });
    ok(m.scrolls && m.overflow === "auto" && m.page, "a long conversation scrolls inside the chat, never the page", JSON.stringify(m));
    ok(m.oneLine && m.inside, "each citation chip stays on one line, inside its message", JSON.stringify(m));
    ok(m.font >= 14 && m.lh >= 1.55, "the chat reads at 14 px with roomy line height", JSON.stringify(m));
    await ctx.close();
  }

  // ---------- narrow: no sideways scroll, no splitter ----------
  for (const mode of ["board", "explain"]) for (const width of [390, 760, 1000]) {
    const { ctx, p } = await open(mode, width);
    // the board's questions are closed by default on a narrow window: opened, they are an overlay with no splitter
    if (mode === "board" && width > 760) { await p.click("[data-notes-toggle]"); await p.waitForSelector("[data-board-notes]"); await p.waitForTimeout(200); }
    const n = await p.evaluate((sel) => { const s = document.querySelector(sel); return { hscroll: document.documentElement.scrollWidth > innerWidth, split: !!s && s.getBoundingClientRect().width > 0 }; }, split(mode));
    const wantSplit = mode === "explain" && width > 900;
    ok(!n.hscroll && n.split === wantSplit, `${mode} at ${width}: no sideways scroll; ${wantSplit ? "the splitter stays" : "no splitter"}`, JSON.stringify(n));
    await ctx.close();
  }
  // ---------- dark: the splitter uses the theme's tokens ----------
  {
    const { ctx, p } = await open("explain", 1440, { dark: true });
    await p.focus(split("explain"));
    const c = await p.evaluate((sel) => { const s = getComputedStyle(document.querySelector(sel), "::after"), t = document.createElement("i"); t.style.color = "var(--accent)"; document.body.append(t); const accent = getComputedStyle(t).color; t.remove();
      return { bg: s.backgroundColor, accent, op: s.opacity, dark: matchMedia("(prefers-color-scheme: dark)").matches }; }, split("explain"));
    ok(c.dark && c.op === "1" && c.bg === c.accent, "dark: the focused splitter shows the dark theme's accent line", JSON.stringify(c));
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-2000)); }
finally { await browser.close().catch(() => {}); app.kill(); }
console.log(`review-room-pane-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
