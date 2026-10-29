import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The terminal page's focus mode in a real browser (public/app.js pageFocus, public/terminals.js, docs/units/web-terminal.md),
// a stub server with temporary data and a plain shell command only (no agent CLI, no model):
//   the sidebar has a Terminals item with its icon, in the full sidebar and in the rail, current on the page;
//   on #/terminals/<id> the side bar is the 64 px rail, the chat panel and its button are gone, and the terminal takes the
//   rest of the window (>= 90 % of the width beside the rail, most of the height); the PTY follows a window resize
//   (stty size inside it); the sessions strip, Stop and New stay; all of it survives render(); leaving gives back the
//   sidebar and chat the captain had, without writing crew.side or crew.chatOpen; a toggle made during focus is kept;
//   at 390 px the terminal is the width of the screen with no sideways scroll.
//   TERMINAL_FOCUS_SHOTS=<dir>  also write screenshots there
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-terminal-focus-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data");
for (const d of [home, proj, state, data, join(home, ".codex")]) mkdirSync(d, { recursive: true });
let pass = 0, fail = 0, browser, app; const errors = [], shots = process.env.TERMINAL_FOCUS_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const seen = async (loc, timeout = 8000) => { try { await loc.first().waitFor({ timeout }); return true; } catch { return false; } };
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };
const shot = async (p, name) => { if (shots) await p.screenshot({ path: join(shots, name) }); };

writeFileSync(join(data, "projects.json"), JSON.stringify([{ id: "demo", name: "Demo", path: proj, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true }]));
const BUN = process.versions.bun ? process.execPath : execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
const TOKEN = "terminal-focus-ui-session";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
try {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  app = spawn(BUN, ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), PATH: `${dirname(BUN)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: "/bin/sh",
    CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data, CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub",
    CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_TERMINAL_IDLE_MS: "400",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: join(home, ".claude/projects") } });
  app.stdout.resume(); await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  const prep = (ctx, prefs) => ctx.addInitScript((prefs) => { try { if (sessionStorage.getItem("prepped")) return; sessionStorage.setItem("prepped", "1");
    localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v); } catch {} }, prefs);
  const layout = (p) => p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { w: b.width, h: b.height, x: b.left, y: b.top, shown: b.width > 0 && b.height > 0 && getComputedStyle(e).display !== "none" }; };
    return { vw: innerWidth, vh: innerHeight, focus: document.body.dataset.focus ?? null, collapsed: document.body.classList.contains("side-collapsed"), chatClosed: document.body.classList.contains("chat-closed"),
      side: r(".side"), chat: r("#chat"), fab: r(".fab"), xterm: r(".wt-xterm"), launcher: r(".wt-new"), tabs: r(".wt-tabs"), scrollW: document.documentElement.scrollWidth,
      store: { side: localStorage.getItem("crew.side"), chat: localStorage.getItem("crew.chatOpen") } };
  });

  // ---------- desktop: an open sidebar and an open chat ----------
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await prep(ctx, { "crew.side": "open", "crew.chatOpen": "1" });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`desktop: ${e}`));
  await p.goto(base + "/#/board"); await seen(p.locator(".nav-item[data-view=board]")); await p.waitForTimeout(400);
  let L = await layout(p);
  ok(!L.focus && !L.collapsed && !L.chatClosed && L.chat?.shown && L.side.w > 200, "the board: the full sidebar and the chat panel, as the captain left them", JSON.stringify(L));
  const navT = p.locator('.nav > .nav-item[data-view="terminals"]');
  ok(await navT.isVisible() && await navT.locator("svg.ic path").count() > 0 && /Terminals/.test(await navT.innerText()), "the sidebar has a Terminals item with its icon");
  const views = await p.$$eval(".nav > .nav-item", (bs) => bs.filter((b) => !b.hidden && getComputedStyle(b).display !== "none").map((b) => b.dataset.view));
  ok(views.indexOf("terminals") === views.indexOf("firstmate") + 1, "it sits right after Firstmate", JSON.stringify(views));
  await shot(p, "focus-board-before.png");
  await navT.click();
  ok(await until(async () => p.url().endsWith("#/terminals") && await navT.getAttribute("aria-current") === "page"), "clicking it opens the Terminals page and marks it current", p.url());
  ok(await seen(p.locator("#termCmd")), "with nothing running, the launcher is open");
  await p.waitForTimeout(400); // the sidebar's width transition
  L = await layout(p);
  ok(L.focus === "terminal" && L.collapsed && L.chatClosed && !L.chat?.shown && !L.fab?.shown && L.side.w <= 64, "on the page: the rail, no chat panel and no chat button", JSON.stringify(L));
  ok(await navT.isVisible() && (await navT.boundingBox()).width <= 44 && await navT.locator("svg.ic").isVisible(), "the Terminals item is in the rail too, as its icon");
  ok(L.store.side === "open" && L.store.chat === "1", "focus writes neither crew.side nor crew.chatOpen", JSON.stringify(L.store));

  // a shell that prints the PTY's size on every Enter
  await p.locator("#termCmd").fill("while IFS= read -r l; do printf 'size:'; stty size; done");
  await p.locator("[data-term-run]").click();
  ok(await until(async () => /#\/terminals\/T-/.test(p.url())), "Run opens the new terminal", p.url());
  const id = decodeURIComponent(p.url().split("/terminals/")[1] || "");
  ok(await seen(p.locator(".wt-xterm .xterm-rows"), 10000), "xterm.js draws it");
  ok(await until(async () => !(await p.locator(".wt-new").count())), "the launcher closes once the terminal starts");
  const check = async (when) => {
    const L = await layout(p);
    const avail = L.vw - L.side.w;
    ok(L.focus === "terminal" && L.collapsed && L.chatClosed && !L.chat?.shown && L.side.w <= 64, `${when}: the side bar is the rail, the chat is gone`, JSON.stringify(L));
    ok(L.xterm && L.xterm.w >= 0.9 * avail, `${when}: the terminal is >= 90 % of the width beside the rail (${Math.round(L.xterm?.w)} of ${avail})`, JSON.stringify(L.xterm));
    ok(L.xterm && L.xterm.h >= L.vh - 200, `${when}: and the window's height but for the tabs, its header and the key hints, at most 200 px (${Math.round(L.xterm?.h)} of ${L.vh})`, JSON.stringify(L.xterm));
    ok(L.scrollW <= L.vw + 1, `${when}: no sideways scroll`);
    ok(await p.locator('.wt-tabs [data-term-tab][aria-selected="true"]').isVisible() && await p.locator(`.wt-pane.focus[data-term-pane="${id}"]`).isVisible() && await p.locator(`[data-term-kill="${id}"]`).isVisible() && await p.locator("[data-term-new]").isVisible(),
      `${when}: the tabs (this one current, its pane focused), Stop and Launch stay`);
    return L;
  };
  await p.locator('[data-term-appwin] button[aria-label="Hide"]').click(); await p.waitForTimeout(200);
  await check("a terminal shown");
  await shot(p, "focus-terminal-after.png");
  const host0 = await p.locator(".wt-xterm").elementHandle();
  await p.evaluate(() => render());
  await check("after render()");
  ok(await host0.evaluate((e) => e.isConnected && !!e.querySelector(".xterm-rows")), "render() keeps the same xterm (the session is not redrawn)");

  // the PTY follows the window: xterm's fit addon and the resize POST
  const sizeNow = async () => { await p.locator(".wt-xterm").click(); await p.keyboard.press("Enter");
    const t = await until(async () => { const m = [...(await p.locator(".wt-xterm .xterm-rows").innerText()).matchAll(/size:\s*(\d+) (\d+)/g)].at(-1); return m ? { rows: +m[1], cols: +m[2], n: m.index } : null; }); return t; };
  await p.waitForTimeout(600); const s1 = await sizeNow(); // after the first fit has reached the PTY
  await p.setViewportSize({ width: 1000, height: 700 }); await p.waitForTimeout(600);
  const before = s1 ? s1.cols : 0;
  const s2 = await until(async () => { const s = await sizeNow(); return s && s.cols < before && s.rows < s1.rows ? s : null; }, 6000);
  ok(s1 && s2 && s2.cols < s1.cols && s2.rows < s1.rows, "a smaller window: the PTY gets fewer columns and rows (stty size inside it)", JSON.stringify({ s1, s2 }));
  await check("at 1000 x 700");
  await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(400);

  // New opens the launcher in place and closes it again; the state lives in the page's model, not the DOM
  await p.locator("[data-term-new]").click();
  ok(await seen(p.locator(".wt-new #termCmd")) && await p.locator("[data-term-new]").getAttribute("aria-expanded") === "true", "Launch opens the launcher above the terminal");
  await p.evaluate(() => render());
  ok(await p.locator(".wt-new #termCmd").isVisible(), "an open launcher survives render()");
  await p.locator("[data-term-new]").click();
  ok(await until(async () => !(await p.locator(".wt-new").count())), "Launch again closes it");

  // leaving gives back what the captain had
  await p.locator('.nav > .nav-item[data-view="board"]').click(); await p.waitForTimeout(300);
  L = await layout(p);
  ok(!L.focus && !L.collapsed && !L.chatClosed && L.chat?.shown && L.side.w > 200 && L.store.side === "open" && L.store.chat === "1", "leaving: the full sidebar and the chat panel are back, the stored prefs untouched", JSON.stringify(L));
  await p.goBack(); await p.waitForTimeout(300);
  L = await layout(p);
  ok(L.focus === "terminal" && L.collapsed && L.chatClosed && L.xterm?.w >= 0.9 * (L.vw - L.side.w), "Back to the terminal: focus again, the terminal full size", JSON.stringify(L));
  // a sidebar toggle the captain makes on the page is what they get back
  await p.locator("#sideTog").click(); await p.waitForTimeout(250);
  ok(!(await layout(p)).collapsed, "the rail's toggle still expands the sidebar on the page");
  await p.locator("#sideTog").click(); await p.waitForTimeout(250);
  await p.locator('.nav > .nav-item[data-view="board"]').click(); await p.waitForTimeout(300);
  L = await layout(p);
  ok(!L.focus && L.collapsed && L.store.side === "collapsed" && !L.chatClosed, "a toggle made during focus is kept on leaving (collapsed, as clicked), the chat comes back", JSON.stringify(L));
  await ctx.close();

  // ---------- desktop: a collapsed sidebar and a closed chat stay so ----------
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await prep(ctx2, { "crew.side": "collapsed", "crew.chatOpen": "0" });
  const p2 = await ctx2.newPage(); p2.on("pageerror", (e) => errors.push(`desktop2: ${e}`));
  await p2.goto(`${base}/#/terminals/${encodeURIComponent(id)}`); await seen(p2.locator(".wt-xterm .xterm-rows"), 10000);
  L = await layout(p2);
  ok(L.focus === "terminal" && L.xterm?.w >= 0.9 * (L.vw - L.side.w), "a cold load of a terminal's link opens in focus", JSON.stringify(L));
  await p2.locator('.nav > .nav-item[data-view="board"]').click(); await p2.waitForTimeout(300);
  L = await layout(p2);
  ok(!L.focus && L.collapsed && L.chatClosed && L.store.side === "collapsed" && L.store.chat === "0", "leaving: still collapsed and closed, as the captain had it", JSON.stringify(L));
  await ctx2.close();

  // ---------- a phone-width window ----------
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } }); await prep(ctx3, {});
  const q = await ctx3.newPage(); q.on("pageerror", (e) => errors.push(`phone: ${e}`));
  await q.goto(`${base}/#/terminals/${encodeURIComponent(id)}`); await seen(q.locator(".wt-xterm .xterm-rows"), 10000); await q.waitForTimeout(300);
  L = await layout(q);
  ok(L.focus === "terminal" && !L.chat?.shown && !L.fab?.shown && L.xterm?.w >= 0.9 * L.vw && L.xterm?.h >= 0.5 * L.vh && L.scrollW <= L.vw + 1, "at 390 px: the terminal is the screen's width and most of its height, no chat button, no sideways scroll", JSON.stringify(L));
  ok(await q.locator('.nav > .nav-item[data-view="terminals"]').isVisible() && await q.locator(`[data-term-kill="${id}"]`).isVisible(), "the top bar keeps the way back, and the terminal keeps Stop");
  await shot(q, "focus-terminal-phone.png");
  await q.locator(`[data-term-kill="${id}"]`).click();
  ok(await seen(q.locator(`.wt-detail [data-term-state="exited"], .wt-detail [data-term-state="done"]`), 8000), "Stop ends it");
  await ctx3.close();
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  try { await browser?.close(); } catch {}
  try { app?.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true });
}
console.log(`terminal-focus-ui: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
