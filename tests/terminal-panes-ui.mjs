import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Tabs, split panes and keys on the terminal page in a real browser (public/terminals.js, public/term-keys.js,
// docs/units/web-terminal.md "Tabs, panes and keys"), a stub server with temporary data, login shells only:
//   as a Mac (iTerm2's keys): ⌘D and ⇧⌘D split, each new pane its own PTY; ⌥⌘arrows move the focus, ⌃⌘arrows resize,
//   ⇧⌘↩ zooms; a chord that is Studio's never reaches xterm, a plain key does (and reaches the shell); in a browser tab ⌥T
//   opens a tab, ⌘1 and ⇧⌘] switch, ⌥W closes the pane (the terminal keeps running), a double-click renames, ⇧⌘O finds, ⌘/ shows the
//   keys with the tab's struck-out chords; the layout survives render() and a reload; the banner offers a Studio window,
//   whose button asks the server for Chrome's app window (a stand-in open(1) records argv: no browser opens);
//   a Studio window (?window=studio, as the launch lands): no banner, hints show ⌘T, ⌘T itself opens a tab;
//   as Windows (Windows Terminal's keys): Alt+Shift+= and Alt+Shift+- split, Alt+arrows move, Ctrl+Shift+T and Ctrl+Alt+T
//   open tabs, Ctrl+Tab switches, Ctrl+Shift+W closes, Ctrl+Shift+P finds, Ctrl+Shift+/ shows Windows' chords; F1 and F2 stay the shell's.
//   TERMINAL_PANES_SHOTS=<dir>  also write screenshots there
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-terminal-panes-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data"), runtime = join(tmp, "runtime"), bin = join(tmp, "bin");
for (const d of [home, proj, state, data, bin, join(home, ".codex")]) mkdirSync(d, { recursive: true });
let pass = 0, fail = 0, browser, app; const errors = [], shots = process.env.TERMINAL_PANES_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const seen = async (loc, timeout = 8000) => { try { await loc.first().waitFor({ timeout }); return true; } catch { return false; } };
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };
const shot = async (p, name) => { if (shots) await p.screenshot({ path: join(shots, name) }); };
// open(1)'s stand-in: records each call's argv and says yes; the launch never reaches a real browser
const openLog = join(tmp, "open.log"), openStub = join(bin, "fake-open");
writeFileSync(openStub, `#!/bin/sh\nprintf '%s\\0' "$@" >> "${openLog}"\nprintf '\\036' >> "${openLog}"\nexit 0\n`); chmodSync(openStub, 0o755);
writeFileSync(join(data, "projects.json"), JSON.stringify([{ id: "demo", name: "Demo", path: proj, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true }]));
const BUN = process.versions.bun ? process.execPath : execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
const TOKEN = "terminal-panes-ui-session";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CREW_BROWSER", "CREW_APP_WINDOW"]) delete env[k];
const MAC = { platform: "MacIntel", uad: "macOS" }, WIN = { platform: "Win32", uad: "Windows" };
try {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  app = spawn(BUN, ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), PATH: `${dirname(BUN)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: "/bin/sh",
    CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data, CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub",
    CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_TERMINAL_IDLE_MS: "400", CREW_TERMINAL_MAX: "20", CREW_RUNTIME_DIR: runtime, CREW_OPEN_TOOL: openStub, CREW_DEFAULTS_TOOL: "/nonexistent/defaults",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: join(home, ".claude/projects") } });
  app.stdout.resume(); await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  const context = async (os) => { const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await ctx.addInitScript((os) => { Object.defineProperty(Navigator.prototype, "platform", { get: () => os.platform }); Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => ({ platform: os.uad }) });
      try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, os);
    return ctx; };
  const list = (p) => p.evaluate(() => fetch("/api/terminals").then((r) => r.json()).then((j) => j.terminals));
  const panes = (p) => p.$$eval(".wt-stage .wt-pane[data-pane]", (es) => es.map((e) => { const b = e.getBoundingClientRect(); return { pane: e.dataset.pane, term: e.dataset.termPane, focus: e.classList.contains("focus"), x: b.left, y: b.top, w: b.width, h: b.height }; }));
  const tabs = (p) => p.$$eval(".wt-tabs [data-term-tab]", (es) => es.map((e) => ({ id: e.dataset.termTab, sel: e.getAttribute("aria-selected") === "true", name: e.querySelector(".wt-tname")?.textContent })));
  const focused = async (p) => (await panes(p)).find((x) => x.focus);
  const rows = (p, term) => p.locator(`.wt-pane[data-term-pane="${term}"] .xterm-rows`).innerText().catch(() => "");
  // what reached xterm: every keydown its element saw, in the capture phase (a chord Studio takes never gets there)
  const spy = (p) => p.evaluate(() => { window.__xk = []; for (const t of document.querySelectorAll(".wt-xterm")) if (!t.__spied) { t.__spied = 1; t.addEventListener("keydown", (e) => window.__xk.push(e.code + (e.metaKey ? "+M" : "") + (e.altKey ? "+A" : "") + (e.ctrlKey ? "+C" : "")), true); } });
  const reached = (p) => p.evaluate(() => window.__xk);

  // ---------- as a Mac, in a browser tab ----------
  const ctx = await context(MAC), p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`mac: ${e}`));
  await p.goto(base + "/#/terminals"); await seen(p.locator("[data-preset=shell]"));
  await p.locator("[data-preset=shell]").click();
  ok(await until(async () => (await panes(p)).length === 1 && /#\/terminals\/T-/.test(p.url())), "a shell starts in a tab of its own");
  await seen(p.locator(".wt-xterm .xterm-rows"), 10000); await p.waitForTimeout(400);
  const t1 = (await focused(p)).term;
  ok(await p.locator("[data-term-appwin]").isVisible() && /⌥T ⌥W ⌥N/.test(await p.locator("[data-term-appwin]").innerText()), "in a browser tab a banner says ⌘T ⌘W ⌘N are the browser's and names ⌥T ⌥W ⌥N");
  ok(await p.locator('[data-hint="newTab"] kbd').innerText() === "⌥T" && await p.locator('[data-hint="splitRight"] kbd').innerText() === "⌘D" && await p.locator('[data-term-where="tab"]').isVisible(), "the hints show the chords that work in a tab (⌥T, ⌘D)");
  await p.locator(".wt-xterm").click(); await spy(p);
  await p.keyboard.press("Meta+KeyD");
  ok(await until(async () => (await panes(p)).length === 2), "⌘D splits: two panes");
  let ps = await panes(p);
  ok(ps.length === 2 && Math.abs(ps[0].y - ps[1].y) < 2 && ps[1].x > ps[0].x + 100 && ps[1].focus && ps[0].term === t1 && ps[1].term !== t1, "side by side, the new one on the right has the focus", JSON.stringify(ps));
  const t2 = ps[1].term;
  ok(await until(async () => (await list(p)).filter((t) => t.running).length === 2) && p.url().endsWith(encodeURIComponent(t2)), "the new pane is its own PTY (two terminals run), and the address names it");
  ok(!(await reached(p)).some((k) => k.startsWith("KeyD")), "the chord never reached xterm (the shell did not get a ⌘D)", JSON.stringify(await reached(p)));
  await seen(p.locator(`.wt-pane[data-term-pane="${t2}"] .xterm-rows`), 10000); await p.waitForTimeout(300);
  await p.keyboard.press("Shift+Meta+KeyD");
  ok(await until(async () => (await panes(p)).length === 3), "⇧⌘D splits down: three panes");
  ps = await panes(p); const t3 = ps.find((x) => x.focus).term, p2 = ps.find((x) => x.term === t2), p3 = ps.find((x) => x.term === t3);
  ok(p3 && p2 && Math.abs(p3.x - p2.x) < 2 && p3.y > p2.y + 50, "the new pane is below the one that had the focus", JSON.stringify(ps));
  await seen(p.locator(`.wt-pane[data-term-pane="${t3}"] .xterm-rows`), 10000); await p.waitForTimeout(300);
  // plain keys go to the shell in the focused pane
  await spy(p); await p.keyboard.type("echo pane-$((40+2))"); await p.keyboard.press("Enter");
  ok(await until(async () => /pane-42/.test(await rows(p, t3))), "typing reaches the focused pane's shell", await rows(p, t3));
  ok((await reached(p)).filter((k) => k.startsWith("Key") || k === "Enter").length >= 5, "plain keys reach xterm", JSON.stringify(await reached(p)));
  ok(!/pane-42/.test(await rows(p, t1)) && !/pane-42/.test(await rows(p, t2)), "and only that pane's");
  await p.keyboard.press("Alt+Meta+ArrowLeft");
  ok(await until(async () => (await focused(p))?.term === t1), "⌥⌘← moves the focus to the pane on the left");
  const w0 = (await panes(p)).find((x) => x.term === t1).w;
  await p.keyboard.press("Control+Meta+ArrowRight"); await p.waitForTimeout(250);
  const w1 = (await panes(p)).find((x) => x.term === t1).w;
  ok(w1 > w0 + 20, "⌃⌘→ widens the focused pane", `${w0} -> ${w1}`);
  await p.keyboard.press("Shift+Meta+Enter");
  ok(await until(async () => (await panes(p)).length === 1 && (await panes(p))[0].term === t1), "⇧⌘↩ zooms the focused pane");
  await p.keyboard.press("Shift+Meta+Enter");
  ok(await until(async () => (await panes(p)).length === 3), "and again restores the layout");
  await p.evaluate(() => render());
  ps = await panes(p);
  ok(ps.length === 3 && ps.find((x) => x.focus)?.term === t1 && (await tabs(p)).length === 1, "render() keeps the panes and the focus");
  await shot(p, "panes-mac-split.png");
  // tabs: ⌥T in a tab (⌘T is the browser's there), ⌘1, ⇧⌘]
  await p.keyboard.press("Alt+KeyT");
  ok(await until(async () => (await tabs(p)).length === 2 && (await tabs(p))[1].sel && (await panes(p)).length === 1), "⌥T opens a new tab with a shell");
  const t4 = (await focused(p)).term;
  await p.keyboard.press("Meta+Digit1");
  ok(await until(async () => (await tabs(p))[0].sel && (await panes(p)).length === 3), "⌘1 goes to the first tab");
  await p.keyboard.press("Shift+Meta+BracketRight");
  ok(await until(async () => (await tabs(p))[1].sel), "⇧⌘] goes to the next");
  // ⌥W closes the pane; its terminal keeps running (Stop is what stops it); the last pane closes its tab
  await p.keyboard.press("Alt+KeyW");
  ok(await until(async () => (await tabs(p)).length === 1 && (await tabs(p))[0].sel), "⌥W closes the last pane, and with it the tab");
  ok((await list(p)).some((t) => t.id === t4 && t.running), "the terminal it showed keeps running");
  await spy(p); await p.keyboard.press("F2"); await p.waitForTimeout(150);
  ok(!(await p.locator("#termName").count()) && (await reached(p)).includes("F2"), "F2 is the shell's (htop, mc), not a rename", JSON.stringify(await reached(p)));
  await p.locator('[data-term-tab][aria-selected="true"] .wt-tname').dblclick(); await seen(p.locator("#termName"));
  await p.locator("#termName").fill("build"); await p.keyboard.press("Enter");
  ok(await until(async () => (await tabs(p))[0].name === "build"), "a double-click renames the tab");
  await p.keyboard.press("Shift+Meta+KeyO"); await seen(p.locator("[data-term-picker] #termPickQ"));
  ok(await p.locator("[data-term-picker] [data-pick]").count() === 4, "⇧⌘O lists every terminal, the one off screen too");
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("Enter");
  ok(await until(async () => (await tabs(p)).length === 2 && (await focused(p))?.term === t4), "choosing it brings it back in a tab");
  await p.keyboard.press("Meta+Slash"); await seen(p.locator("[data-term-help]"));
  const help = await p.locator('[data-term-help] [data-help-act="newTab"]').innerText(), off = await p.locator('[data-term-help] [data-help-act="newTab"] kbd.off').innerText();
  ok(/⌘T/.test(help) && /⌥T/.test(help) && off === "⌘T" && /⇧⌘D/.test(await p.locator('[data-term-help] [data-help-act="splitDown"]').innerText()), "⌘/ shows iTerm2's keys; in a tab ⌘T is struck out for ⌥T", help);
  await shot(p, "panes-mac-help.png");
  await p.keyboard.press("Escape");
  ok(await until(async () => !(await p.locator("[data-term-help]").count())), "Esc closes it");
  // the layout is this viewer's own, kept across a reload
  await p.reload(); await seen(p.locator(".wt-stage .wt-pane"), 10000); await p.waitForTimeout(400);
  ok((await tabs(p)).length === 2 && (await tabs(p))[0].name === "build", "the tabs, their names and panes survive a reload", JSON.stringify(await tabs(p)));
  await p.locator('[data-term-tab]').first().click(); await p.waitForTimeout(200);
  ok((await panes(p)).length === 3, "the split tab still has its three panes after the reload");
  // the banner's button: the server opens Studio as Chrome's app window, through the launch's own private redirect
  rmSync(openLog, { force: true });
  await p.locator("[data-term-appwin-open]").click();
  const calls = await until(async () => existsSync(openLog) && readFileSync(openLog, "utf8").split("\x1e").filter(Boolean).map((c) => c.split("\0").slice(0, -1)));
  const c0 = calls?.[0] ?? [], f = c0[3]?.startsWith("--app=file://") ? decodeURIComponent(c0[3].slice(13)) : "";
  const link = f && existsSync(f) ? JSON.parse(/location\.replace\((".*?")\)/.exec(readFileSync(f, "utf8"))?.[1] ?? '""') : "";
  ok(c0[0] === "-na" && c0[1] === "Google Chrome" && c0[2] === "--args" && link === `${base}/session?t=${TOKEN}&w=app` && !JSON.stringify(calls).includes(TOKEN),
    "Open in a Studio window: open -na \"Google Chrome\" --args --app=<private file> whose link says &w=app (the token never in argv)", JSON.stringify(calls));
  ok(await seen(p.locator(".toast", { hasText: "Studio window" })), "the page says it opened");
  const s = await fetch(`${base}/session?t=${TOKEN}&w=app`, { redirect: "manual" });
  ok(s.status === 303 && s.headers.get("location") === "/?window=studio", "the session link of a Studio window lands on /?window=studio", `${s.status} ${s.headers.get("location")}`);
  await ctx.close();

  // ---------- as a Mac, in a Studio window (how the launch lands) ----------
  const ctxW = await context(MAC), w = await ctxW.newPage(); w.on("pageerror", (e) => errors.push(`window: ${e}`));
  await w.goto(`${base}/?window=studio#/terminals/${encodeURIComponent(t1)}`); await seen(w.locator(".wt-stage .wt-pane"), 10000); await w.waitForTimeout(400);
  ok(!(await w.locator("[data-term-appwin]").count()) && await w.locator('[data-term-where="window"]').isVisible() && await w.locator('[data-hint="newTab"] kbd').innerText() === "⌘T" && !w.url().includes("window=studio"),
    "a Studio window: no banner, the hints show ⌘T, and the address loses the flag", w.url());
  await w.locator(".wt-xterm").first().click();
  await w.keyboard.press("Meta+KeyT");
  ok(await until(async () => (await tabs(w)).length === 2), "⌘T opens a tab");
  await w.keyboard.press("Meta+KeyW");
  ok(await until(async () => (await tabs(w)).length === 1), "⌘W closes it");
  await spy(w); await w.keyboard.press("Alt+KeyT"); await w.keyboard.press("Alt+KeyW"); await w.waitForTimeout(200);
  ok((await tabs(w)).length === 1 && (await reached(w)).includes("KeyT+A") && (await reached(w)).includes("KeyW+A"), "in a Studio window ⌥T and ⌥W are the shell's (Option as Meta), not a tab", JSON.stringify(await reached(w)));
  await w.reload(); await w.waitForTimeout(400);
  ok(await w.locator('[data-term-where="window"]').isVisible(), "the window remembers it is a Studio window across a reload");
  await shot(w, "panes-studio-window.png");
  await ctxW.close();

  // ---------- as Windows (Windows Terminal's keys) ----------
  const ctx2 = await context(WIN), q = await ctx2.newPage(); q.on("pageerror", (e) => errors.push(`win: ${e}`));
  await q.goto(`${base}/#/terminals/${encodeURIComponent(t1)}`); await seen(q.locator(".wt-stage .wt-pane .xterm-rows"), 10000); await q.waitForTimeout(400);
  ok(await q.locator('[data-hint="newTab"] kbd').innerText() === "Ctrl+Alt+T" && await q.locator('[data-hint="splitRight"] kbd').innerText() === "Alt+Shift+=", "Windows: the hints show Ctrl+Alt+T and Alt+Shift+=");
  await q.locator(".wt-xterm").first().click(); await spy(q);
  await q.keyboard.press("Alt+Shift+Equal");
  ok(await until(async () => (await panes(q)).length === 2), "Alt+Shift+= splits right");
  await q.waitForTimeout(400);
  await q.keyboard.press("Alt+Shift+Minus");
  ok(await until(async () => (await panes(q)).length === 3 && (await panes(q))[2].y > (await panes(q))[1].y + 50), "Alt+Shift+- splits down");
  const qf = (await focused(q)).term;
  await q.keyboard.press("Alt+ArrowLeft");
  ok(await until(async () => (await focused(q))?.term !== qf && (await focused(q)).x < 200), "Alt+← moves the focus left");
  await q.keyboard.press("Control+Shift+KeyT");
  ok(await until(async () => (await tabs(q)).length === 2 && (await tabs(q))[1].sel), "Ctrl+Shift+T opens a tab");
  await q.keyboard.press("Control+Alt+KeyT");
  ok(await until(async () => (await tabs(q)).length === 3), "Ctrl+Alt+T too (the browser tab's second chord)");
  await q.keyboard.press("Control+Tab");
  ok(await until(async () => (await tabs(q))[0].sel), "Ctrl+Tab goes to the next tab (round to the first)");
  await q.keyboard.press("Control+Alt+Digit3");
  ok(await until(async () => (await tabs(q))[2].sel), "Ctrl+Alt+3 goes to the third");
  await q.keyboard.press("Control+Shift+KeyW");
  ok(await until(async () => (await tabs(q)).length === 2), "Ctrl+Shift+W closes the pane and its tab");
  ok(!(await reached(q)).some((k) => /^(Equal|Minus|KeyT|KeyW|Tab|Digit3)/.test(k)), "none of those chords reached xterm", JSON.stringify(await reached(q)));
  await spy(q); await q.keyboard.press("Control+KeyC"); await q.waitForTimeout(150);
  ok((await reached(q)).some((k) => k === "KeyC+C"), "Ctrl+C is the shell's: it reaches xterm", JSON.stringify(await reached(q)));
  // what has nothing to do, and AltGr's characters, go to the shell: no tab 9, Alt+← in a single pane (a word back), { typed
  // with AltGr (Ctrl+Alt on Windows): ~ on a French layout's 2 key, where Ctrl+Alt+2 would be tab 2
  await spy(q); await q.keyboard.press("Control+Alt+Digit9"); await q.waitForTimeout(150);
  ok((await reached(q)).some((k) => k === "Digit9+A+C") && (await tabs(q)).length === 2, "Ctrl+Alt+9 with two tabs reaches the shell", JSON.stringify(await reached(q)));
  await q.keyboard.press("Control+Alt+Digit2"); await until(async () => (await tabs(q))[1].sel); await q.waitForTimeout(200);
  ok((await panes(q)).length === 1, "the second tab has one pane");
  await spy(q); await q.keyboard.press("Alt+ArrowLeft"); await q.waitForTimeout(150);
  ok((await reached(q)).some((k) => k === "ArrowLeft+A"), "Alt+← in a single pane reaches the shell (a word back)", JSON.stringify(await reached(q)));
  await spy(q); const typed = await q.evaluate(() => { const ta = document.querySelector(".wt-pane.focus .wt-xterm textarea"); const e = new KeyboardEvent("keydown", { code: "Digit2", key: "~", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }); ta.dispatchEvent(e); return window.__xk; });
  ok(typed.includes("Digit2+A+C") && (await tabs(q))[1].sel, "AltGr+2 (~ on a French layout) reaches the shell, not tab 2", JSON.stringify(typed));
  await q.keyboard.press("Control+Shift+KeyP");
  ok(await seen(q.locator("[data-term-picker]")), "Ctrl+Shift+P opens Go to"); await q.keyboard.press("Escape");
  await spy(q); await q.keyboard.press("F1"); await q.waitForTimeout(150);
  ok(!(await q.locator("[data-term-help]").count()) && (await reached(q)).includes("F1"), "F1 is the shell's", JSON.stringify(await reached(q)));
  await q.keyboard.press("Control+Shift+Slash");
  ok(await seen(q.locator('[data-term-help="win"]')) && /Ctrl\+Shift\+T/.test(await q.locator('[data-term-help] [data-help-act="newTab"]').innerText()), "Ctrl+Shift+/ shows Windows Terminal's keys");
  await shot(q, "panes-win-help.png");
  await ctx2.close();

  // ---------- the terminal list does not load: the saved tabs are kept, not taken for gone ----------
  { const ctxE = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const saved = JSON.stringify({ tabs: [{ id: "t1", name: "kept", root: { t: "pane", id: "p1", term: t1 }, focus: "p1", zoom: null }], cur: 0, uid: 1 });
    await ctxE.addInitScript((saved) => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("crew.term.layout", saved); }
      localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, saved);
    let fail = true; await ctxE.route(/\/api\/terminals$/, (r) => (fail && r.request().method() === "GET" ? r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Studio is busy" }) }) : r.continue()));
    const pe = await ctxE.newPage(); pe.on("pageerror", (e) => errors.push(`list-error: ${e}`));
    await pe.goto(`${base}/#/terminals`); await seen(pe.locator("text=Studio is busy")); await pe.waitForTimeout(300);
    ok(JSON.parse(await pe.evaluate(() => localStorage.getItem("crew.term.layout")) || "{}").tabs?.[0]?.name === "kept", "a list that failed to load leaves the saved tabs as they were");
    fail = false; await pe.evaluate(() => dispatchEvent(new Event("focus")));
    ok(await until(async () => (await tabs(pe))[0]?.name === "kept" && (await panes(pe)).length === 1), "when the list loads, the tab is back with its pane");
    await ctxE.close(); }

  // ---------- after a reload: a tab not drawn yet, and a zoomed tab's hidden panes, show their terminals' output ----------
  { const ctxR = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    // what a resize cannot print again (a shell redraws its prompt on SIGWINCH): earlier lines, typed before the reload
    const lay = { tabs: [{ id: "t0", name: "zero", root: { t: "pane", id: "p0", term: t4 }, focus: "p0", zoom: null },
      { id: "t1", name: "one", root: { t: "pane", id: "p1", term: t1 }, focus: "p1", zoom: null },
      { id: "t3", name: "split", root: { t: "split", id: "s1", dir: "row", ratio: 0.5, a: { t: "pane", id: "p3", term: t2 }, b: { t: "pane", id: "p4", term: t3 } }, focus: "p3", zoom: "p3" }], cur: 1, uid: 4 };
    await ctxR.addInitScript(([os, lay]) => { Object.defineProperty(Navigator.prototype, "platform", { get: () => os.platform }); Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => ({ platform: os.uad }) });
      try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("crew.term.layout", JSON.stringify(lay)); }
        localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, [MAC, lay]);
    const r = await ctxR.newPage(); r.on("pageerror", (e) => errors.push(`reload: ${e}`));
    await r.goto(`${base}/?window=studio#/terminals/${encodeURIComponent(t1)}`); await seen(r.locator(`.wt-pane[data-term-pane="${t1}"] .xterm-rows`), 10000); await r.waitForTimeout(300);
    await r.locator(".wt-xterm").first().click(); await r.keyboard.type("echo first-mark-$((5*5))"); await r.keyboard.press("Enter");
    ok(await until(async () => /first-mark-25/.test(await rows(r, t1))), "a line typed in tab one before the reload");
    await r.keyboard.press("Meta+Digit1"); await until(async () => (await tabs(r))[0].sel);
    await r.reload(); await seen(r.locator(`.wt-pane[data-term-pane="${t4}"] .xterm-rows`), 10000); await r.waitForTimeout(500);
    ok((await tabs(r))[0].sel && !(await r.locator(`.wt-pane[data-term-pane="${t1}"]`).count()), "after the reload tab zero is drawn and tab one is not");
    await r.locator(".wt-xterm").first().click(); await r.keyboard.press("Shift+Meta+BracketRight");
    ok(await until(async () => (await tabs(r))[1].sel && /first-mark-25/.test(await rows(r, t1)), 5000), "⇧⌘] to the tab never drawn since the reload: its terminal shows its earlier output", await rows(r, t1));
    await r.keyboard.press("Meta+Digit3");
    ok(await until(async () => (await panes(r)).length === 1), "the zoomed tab shows only its focused pane");
    await r.keyboard.press("Shift+Meta+Enter");
    ok(await until(async () => (await panes(r)).length === 2 && /pane-42/.test(await rows(r, t3)), 5000), "unzoomed, the pane hidden since the reload shows its earlier output", await rows(r, t3));
    // a terminal the server will not show here (too many views): the pane says so, and the stream is asked for again
    await r.evaluate((id) => crewTerminals.mux.es.dispatchEvent(new MessageEvent("gone", { data: JSON.stringify({ id, code: "tooManyViews" }) })), t3);
    ok(await seen(r.locator(`[data-term-gone="${t3}"]`), 3000) && await r.locator(`[data-term-gone-retry="${t3}"]`).isVisible(), "a terminal refused for too many views says so on its pane, with Retry");
    ok(await until(async () => !(await r.locator(`[data-term-gone="${t3}"]`).count()), 10000), "and recovers by itself once the stream is opened again");
    ok(await r.evaluate(() => crewTerminals.resets) === 0, "opening the stream again reset no pane (each got only what followed)", String(await r.evaluate(() => crewTerminals.resets)));
    await ctxR.close(); }

  // ---------- eight panes: a browser keeps six connections to Studio, and typing needs one ----------
  { const ctx8 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx8.addInitScript((os) => { Object.defineProperty(Navigator.prototype, "platform", { get: () => os.platform }); Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => ({ platform: os.uad }) });
      try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {}
      // every event stream the page opens, to count the ones still open
      const ES = window.EventSource; window.__es = []; window.EventSource = class extends ES { constructor(...a) { super(...a); window.__es.push(this); } }; }, MAC);
    const e8 = await ctx8.newPage(); e8.on("pageerror", (e) => errors.push(`eight: ${e}`));
    await e8.goto(`${base}/?window=studio#/terminals/${encodeURIComponent(t1)}`); await seen(e8.locator(".wt-stage .wt-pane .xterm-rows"), 10000); await e8.waitForTimeout(300);
    await e8.locator(".wt-xterm").first().click();
    for (let i = 1; i < 8; i++) { await e8.keyboard.press(i % 2 ? "Meta+KeyD" : "Shift+Meta+KeyD"); await until(async () => (await panes(e8)).length === i + 1, 10000); await e8.waitForTimeout(250); }
    const ps8 = await panes(e8);
    ok(ps8.length === 8 && new Set(ps8.map((x) => x.term)).size === 8, "eight panes, eight terminals", String(ps8.length));
    await until(async () => (await e8.locator(".wt-stage .xterm-rows").count()) === 8, 10000); await e8.waitForTimeout(600);
    const open = await e8.evaluate(() => window.__es.filter((x) => x.readyState !== 2).map((x) => new URL(x.url).pathname));
    ok(open.length <= 2 && open.includes("/api/terminals/mux"), "the page holds two event streams in all: its own and one for every pane", JSON.stringify(open));
    let typed = 0;
    for (const [i, x] of ps8.entries()) {
      await e8.locator(`.wt-pane[data-pane="${x.pane}"] .wt-xterm`).click(); await e8.keyboard.type(`echo mux-${i}-$((${i}*7))`); await e8.keyboard.press("Enter");
      if (await until(async () => new RegExp(`mux-${i}-${i * 7}`).test(await rows(e8, x.term)), 6000)) typed++;
    }
    ok(typed === 8, "typing reaches the shell in every one of the eight panes", `${typed} of 8`);
    ok(await e8.evaluate(() => crewTerminals.resets) === 0 && /mux-0-0/.test(await rows(e8, ps8[0].term)), "adding seven panes reset none of the others: the first pane keeps what it had", String(await e8.evaluate(() => crewTerminals.resets)));
    await shot(e8, "panes-eight.png");
    await ctx8.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  try { await browser?.close(); } catch {}
  try { app?.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true });
}
console.log(`terminal-panes-ui: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
