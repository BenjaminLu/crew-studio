import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The terminal page's chrome in a real browser (public/terminals.js, public/term-keys.js, docs/units/web-terminal.md
// "Tabs, panes and keys"): one slim strip of tabs (a title and a state dot each) and a ⋯ menu, and the terminal is the rest.
//   no pane has a bar or a button; the terminal is at least the window's height less 48 px at 1440 x 900;
//   every action the page once had a button for is a ⌘ chord on a Mac (Launch, Stop, Restart, Remove, Send for review,
//   Retry, Open in a Studio window, new and close tab, split, zoom, clear, close pane, go to, keys, the menu itself), and
//   each is an item of the ⋯ menu that does the same; the menu's ? lists the keys; plain keys and Ctrl chords reach the shell;
//   at 390 px the menu fits with no sideways scroll; in Traditional Chinese the menu speaks it.
// Stub server, temporary data, login shells and plain commands only (a stand-in claude prints a Remote Control link).
//   TERMINAL_CHROME_SHOTS=<dir>  also write screenshots there
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { checkedTempDir } from "./lib/git-hygiene.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-terminal-chrome-ui-"));
const home = join(tmp, "home"), state = join(tmp, "state"), data = join(tmp, "data"), runtime = join(tmp, "runtime"), bin = join(tmp, "bin");
for (const d of [home, state, data, bin, join(home, ".codex")]) mkdirSync(d, { recursive: true });
writeFileSync(join(home, ".profile"), "PS1='\\W$ '\n");
let pass = 0, fail = 0, browser, app; const errors = [], shots = process.env.TERMINAL_CHROME_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const seen = async (loc, timeout = 8000) => { try { await loc.first().waitFor({ timeout }); return true; } catch { return false; } };
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };
const shot = async (p, name) => { if (shots) await p.screenshot({ path: join(shots, name) }); };
// the project is a git repository (Send for review), in a checked temp folder
const ck = checkedTempDir("crew-terminal-chrome-ui-repo-"), repo = join(ck, "orbit-app"); mkdirSync(repo, { recursive: true });
const G = ["-c", "user.name=T", "-c", "user.email=t@example.invalid"];
execFileSync("git", ["init", "-q", "-b", "main", repo]); writeFileSync(join(repo, "README.md"), "fixture\n");
execFileSync("git", [...G, "add", "README.md"], { cwd: repo }); execFileSync("git", [...G, "commit", "-q", "-m", "init"], { cwd: repo });
writeFileSync(join(data, "projects.json"), JSON.stringify([{ id: "orbit", name: "orbit-app", path: repo, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true }]));
// open(1)'s stand-in for Open in a Studio window: records each call, opens nothing
const openLog = join(tmp, "open.log"), openStub = join(bin, "fake-open");
writeFileSync(openStub, `#!/bin/sh\nprintf '%s\\0' "$@" >> "${openLog}"\nprintf '\\036' >> "${openLog}"\nexit 0\n`); chmodSync(openStub, 0o755);
// a stand-in claude that prints a Remote Control link and echoes what it reads
writeFileSync(join(bin, "claude"), `#!/bin/sh
if [ "$1" = "--help" ]; then echo "  --remote-control [name]   Start an interactive session with Remote Control enabled"; exit 0; fi
for a in "$@"; do [ "$a" = "--remote-control" ] && printf '/remote-control is active \\302\\267 Continue here, on your phone, or at https://claude.ai/code/rc-CHROMEFAKE42\\r\\n'; done
while :; do printf '\\r\\n> '; IFS= read -r line || exit 0; printf 'you said %s\\r\\n' "$line"; done
`); chmodSync(join(bin, "claude"), 0o755);
const BUN = process.versions.bun ? process.execPath : execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
const TOKEN = "terminal-chrome-ui-session";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CREW_BROWSER", "CREW_APP_WINDOW"]) delete env[k];
const MAC = { platform: "MacIntel", uad: "macOS" };
try {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  app = spawn(BUN, ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), PATH: `${bin}:${dirname(BUN)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: "/bin/sh",
    CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data, CREW_FM_STATE: state, CREW_MAIN_PROJECT: repo, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub",
    CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_TERMINAL_IDLE_MS: "400", CREW_TERMINAL_MAX: "30", CREW_RUNTIME_DIR: runtime, CREW_OPEN_TOOL: openStub, CREW_DEFAULTS_TOOL: "/nonexistent/defaults",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: join(home, ".claude/projects") } });
  app.stdout.resume(); await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  const context = async ({ width = 1440, height = 900, lang = "en" } = {}) => { const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript(([os, lang]) => { Object.defineProperty(Navigator.prototype, "platform", { get: () => os.platform }); Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => ({ platform: os.uad }) });
      try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, [MAC, lang]);
    return ctx; };
  const list = (p) => p.evaluate(() => fetch("/api/terminals").then((r) => r.json()).then((j) => j.terminals));
  const panes = (p) => p.$$eval(".wt-stage .wt-pane[data-pane]", (es) => es.map((e) => ({ pane: e.dataset.pane, term: e.dataset.termPane, focus: e.classList.contains("focus") })));
  const tabs = (p) => p.$$eval(".wt-tabs [data-term-tab]", (es) => es.map((e) => ({ id: e.dataset.termTab, sel: e.getAttribute("aria-selected") === "true", state: e.querySelector("[data-term-state]")?.dataset.termState })));
  const focused = async (p) => (await panes(p)).find((x) => x.focus);
  const urlId = (p) => decodeURIComponent(p.url().split("/terminals/")[1]?.split("?")[0] || "");
  const rows = (p, term) => p.locator(`.wt-pane[data-term-pane="${term}"] .xterm-rows`).innerText().catch(() => "");
  const spy = (p) => p.evaluate(() => { window.__xk = []; for (const t of document.querySelectorAll(".wt-xterm")) if (!t.__spied) { t.__spied = 1; t.addEventListener("keydown", (e) => window.__xk.push(e.code + (e.metaKey ? "+M" : "") + (e.altKey ? "+A" : "") + (e.ctrlKey ? "+C" : "")), true); } });
  const reached = (p) => p.evaluate(() => window.__xk);
  const menu = async (p) => { if ((await p.locator("[data-term-menu]").getAttribute("aria-expanded")) !== "true") await p.locator("[data-term-menu]").click(); await seen(p.locator("[data-term-menu-pop]"), 3000); };
  const items = async (p) => { await menu(p); const v = await p.$$eval("[data-term-menu-pop] [data-term-mi]", (es) => es.map((e) => e.dataset.termMi)); await p.keyboard.press("Escape"); return v; };
  const viaMenu = async (p, act) => { await menu(p); await p.locator(`[data-term-menu-pop] [data-term-mi="${act}"]`).click(); };
  const settle = async (p, term) => { await seen(p.locator(`.wt-pane[data-term-pane="${term}"] .xterm-rows`), 10000); await p.waitForTimeout(350); };
  // each former button, done twice: by its chord and by its ⋯ menu item
  const both = async (p, label, chord, act, check, prep) => { for (const how of ["key", "menu"]) { const ctx = prep ? await prep() : null;
    if (how === "key") await p.keyboard.press(chord); else await viaMenu(p, act);
    ok(await until(() => check(ctx), 10000), `${label}: ${how === "key" ? chord : `⋯ › ${act}`}`,
      process.env.DEBUG ? JSON.stringify({ ctx, url: p.url(), focus: await focused(p), page: await p.evaluate(() => crewTerminals.list.map((t) => [t.id, t.running, t.state])), api: (await list(p)).map((t) => [t.id, t.running]) }) : ""); } };

  // ---------- a Mac, in a Studio window (every ⌘ chord reaches the page), 1440 x 900 ----------
  const ctx = await context(), p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`mac: ${e}`));
  await p.goto(`${base}/?window=studio#/terminals`); await seen(p.locator("[data-preset=shell]"));
  await p.locator("[data-preset=shell]").click();
  ok(await until(async () => (await panes(p)).length === 1), "a shell starts in a tab of its own");
  const t1 = (await focused(p)).term; await settle(p, t1);

  // the chrome: one strip (tabs and ⋯), no pane bar, no header, no hints, no banner
  const chrome = await p.evaluate(() => ({ paneButtons: document.querySelectorAll(".wt-pane button, .wt-pane a, .wt-pane select, .wt-pane input:not(.xterm-helper-textarea)").length,
    bars: document.querySelectorAll(".wt-pbar, .wt-dhead, .wt-status, .wt-appwin, .wt-tools, [data-term-status], [data-term-appwin]").length,
    stripButtons: [...document.querySelectorAll(".wt-full button")].filter((b) => !b.closest(".wt-launch, .wt-veil, .wt-pop")).map((b) => b.textContent.trim()),
    tab: [...document.querySelectorAll(".wt-tabs [data-term-tab]")].map((e) => [...e.children].map((c) => c.className)) }));
  ok(chrome.paneButtons === 0 && chrome.bars === 0, "no pane has a bar or a button; no header, key hints or banner over the terminal", JSON.stringify(chrome));
  ok(chrome.stripButtons.length === 1 && chrome.stripButtons[0] === "⋯", "the only button on the page is ⋯", JSON.stringify(chrome.stripButtons));
  ok(JSON.stringify(chrome.tab) === JSON.stringify([["wt-dot working", "wt-tname"]]), "a tab is a state dot and a title", JSON.stringify(chrome.tab));
  const area = await p.evaluate(() => { const x = document.querySelector(".wt-xterm").getBoundingClientRect(), side = document.querySelector(".side").getBoundingClientRect(); return { h: x.height, w: x.width, vh: innerHeight, beside: innerWidth - side.width }; });
  ok(area.h >= area.vh - 48, `the terminal is the window's height less at most 48 px (${Math.round(area.h)} of ${area.vh})`, JSON.stringify(area));
  ok(area.w >= area.beside - 24, `and the width beside the rail less at most 24 px (${Math.round(area.w)} of ${area.beside})`, JSON.stringify(area));
  await shot(p, "chrome-1440.png");

  // plain keys and Ctrl chords are the shell's
  await p.locator(".wt-xterm").click(); await spy(p);
  await p.keyboard.type("echo plain-$((6*7))"); await p.keyboard.press("Enter");
  ok(await until(async () => /plain-42/.test(await rows(p, t1))), "typing reaches the shell", await rows(p, t1));
  for (const k of ["Control+KeyR", "Control+KeyC", "Control+KeyK", "Control+KeyW", "Control+KeyL", "Control+KeyX", "Control+KeyS", "Alt+KeyB", "Alt+Period", "Shift+Slash", "Period"]) await p.keyboard.press(k);
  await p.waitForTimeout(200); const got = await reached(p);
  ok(["KeyR+C", "KeyC+C", "KeyK+C", "KeyW+C", "KeyL+C", "KeyX+C", "KeyS+C", "KeyB+A", "Period+A", "Slash", "Period"].every((k) => got.includes(k)) && (await panes(p)).length === 1 && (await tabs(p)).length === 1 && !(await p.locator("[data-term-menu-pop], .wt-veil").count()),
    "plain keys, ? and Ctrl/Option chords reach xterm and do nothing on the page", JSON.stringify(got));
  await p.keyboard.press("Control+KeyC");

  // ⌘. opens the menu with its first item focused; arrows move; Esc gives the keys back to the terminal
  await p.keyboard.press("Meta+Period");
  ok(await seen(p.locator("[data-term-menu-pop]"), 3000) && await p.evaluate(() => document.activeElement?.dataset.termMi === "newTab"), "⌘. opens the ⋯ menu, its first item (New tab) focused");
  await p.keyboard.press("ArrowDown");
  ok(await p.evaluate(() => document.activeElement?.dataset.termMi) === "splitRight", "↓ moves to the next item (Split right)");
  const order = await p.$$eval("[data-term-menu-pop] [data-term-mi]", (es) => es.map((e) => e.dataset.termMi));
  ok(order.at(-1) === "kill" && order.indexOf("kill") > order.indexOf("help") && order.indexOf("launch") > order.indexOf("closeTab"), "Stop is the last item, past a separator; pane and tab actions come first", JSON.stringify(order));
  await shot(p, "chrome-menu-1440.png");
  await p.keyboard.press("Escape");
  ok(await until(async () => !(await p.locator("[data-term-menu-pop]").count()) && await p.evaluate(() => !!document.activeElement?.closest(".wt-xterm"))), "Esc closes it and the terminal has the keys again");
  // Tab out of the open menu closes it: its keys never act from elsewhere
  await p.keyboard.press("Meta+Period"); await seen(p.locator("[data-term-menu-pop]"), 3000);
  await p.evaluate(() => document.querySelector(".wt-xterm textarea").focus());
  ok(await until(async () => !(await p.locator("[data-term-menu-pop]").count())), "a focus that leaves the open menu closes it");
  // after choosing an item (by keys, by a click) the keys go back to the shell
  for (const how of ["keys", "click"]) {
    await p.locator(".wt-xterm").click();
    if (how === "keys") { await p.keyboard.press("Meta+Period"); await seen(p.locator("[data-term-menu-pop]"), 3000);
      while (await p.evaluate(() => document.activeElement?.dataset.termMi) !== "clear") await p.keyboard.press("ArrowDown");
      await p.keyboard.press("Enter"); }
    else { await menu(p); await p.locator('[data-term-menu-pop] [data-term-mi="clear"]').click(); }
    await p.waitForTimeout(150);
    await p.keyboard.type(`echo after-${how}-$((3*3))`); await p.keyboard.press("Enter");
    ok(await until(async () => new RegExp(`after-${how}-9`).test(await rows(p, t1))), `choose Clear in the menu by ${how}, then type: the shell gets it`, await p.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));
  }
  // a shell with no commit beyond main: nothing about Send for review in its menu, no dot on ⋯
  await menu(p);
  ok(!(await p.locator("[data-term-menu-pop] [data-term-review], [data-term-menu-pop] [data-term-send]").count()) && !(await p.locator("[data-term-menu-ready]").count()), "0 commits beyond main: no review line, no Send for review, no dot on ⋯");
  ok(await p.evaluate(() => { const c = document.querySelector("[data-term-menu-pop] .wt-cmd"); return c && c.scrollWidth > c.clientWidth - 1 && getComputedStyle(c).whiteSpace === "nowrap" && /\n/.test(c.title); }), "the command and folder are one line, in full in its title");
  await p.keyboard.press("Escape");
  // the menu's ? lists every key, the new ones too
  await menu(p); await p.keyboard.press("Shift+Slash");
  ok(await seen(p.locator("[data-term-help]"), 3000), "? in the menu opens the key table");
  const helpActs = await p.$$eval("[data-term-help] [data-help-act]", (es) => es.map((e) => e.dataset.helpAct));
  ok(["menu", "launch", "kill", "restart", "dismiss", "review", "retry", "newTab", "closeTab", "splitRight", "splitDown", "zoom", "closePane", "clear", "goto", "appWindow", "help"].every((a) => helpActs.includes(a)), "the table lists every action with its key", JSON.stringify(helpActs));
  ok(/⌥⌘X/.test(await p.locator('[data-term-help] [data-help-act="kill"]').innerText()) && /⌥⌘N/.test(await p.locator('[data-term-help] [data-help-act="launch"]').innerText()), "Stop is ⌥⌘X, Launch ⌥⌘N");
  await p.keyboard.press("Escape"); await until(async () => !(await p.locator("[data-term-help]").count()));

  // every former button is a key and a menu item, each doing the same
  const has = await items(p);
  ok(["launch", "kill", "restart", "newTab", "splitRight", "splitDown", "zoom", "clear", "closePane", "closeTab", "renameTab", "goto", "sidebar", "help"].every((a) => has.includes(a)) && !has.includes("appWindow") && !has.includes("dismiss"),
    "the menu of a running shell in a Studio window: Launch, Stop, Restart, tabs and panes, Go to, Keys (no Remove while it runs, no Studio window in one)", JSON.stringify(has));
  await p.locator(".wt-xterm").click();
  const count = async () => { await p.waitForTimeout(300); return (await panes(p)).length; };
  await both(p, "split right", "Meta+KeyD", "splitRight", async (n) => (await panes(p)).length === n + 1, count);
  await both(p, "split down", "Shift+Meta+KeyD", "splitDown", async (n) => (await panes(p)).length === n + 1, count);
  await p.waitForTimeout(400);
  ok(!(await reached(p)).some((k) => k.startsWith("KeyD")), "no chord reached the shell");
  const before = (await panes(p)).length;
  await both(p, "zoom", "Shift+Meta+Enter", "zoom", async (z) => (await panes(p)).length === (z ? before : 1), async () => (await panes(p)).length === 1);
  let f0;
  await both(p, "clear", "Meta+KeyK", "clear", async () => !/clear-me/.test(await rows(p, f0)), async () => { f0 = (await focused(p)).term; await p.locator(`.wt-pane[data-term-pane="${f0}"] .wt-xterm`).click(); await settle(p, f0);
    await p.keyboard.type("echo clear-me"); await p.keyboard.press("Enter"); await until(async () => /clear-me/.test(await rows(p, f0))); await p.waitForTimeout(150); });
  let np;
  await both(p, "close pane (its terminal keeps running)", "Meta+KeyW", "closePane", async () => (await panes(p)).length === np - 1, async () => { np = (await panes(p)).length; await p.locator(".wt-xterm").first().click(); });
  ok((await list(p)).filter((t) => t.running).length >= 5, "the closed panes' terminals still run");
  let nt;
  await both(p, "new tab", "Meta+KeyT", "newTab", async () => (await tabs(p)).length === nt + 1 && (await tabs(p)).at(-1).sel, async () => { nt = (await tabs(p)).length; await p.waitForTimeout(300); });
  await p.waitForTimeout(400);
  await p.keyboard.press("Meta+Digit1");
  ok(await until(async () => (await tabs(p))[0].sel), "⌘1 goes to the first tab");
  await both(p, "close tab", "Alt+Shift+Meta+KeyW", "closeTab", async () => (await tabs(p)).length === nt - 1, async () => { nt = (await tabs(p)).length; await p.waitForTimeout(200); });
  await both(p, "go to", "Shift+Meta+KeyO", "goto", async () => { const v = await p.locator("[data-term-picker]").count(); if (v) await p.keyboard.press("Escape"); return v; });
  await both(p, "keys", "Meta+Slash", "help", async () => { const v = await p.locator("[data-term-help]").count(); if (v) await p.keyboard.press("Escape"); return v; });
  ok(await p.locator('.wt-tabs [data-term-tab]').count() >= 1, "a tab is left");
  // rename (a double-click before, still): an item of the menu too
  await viaMenu(p, "renameTab"); await seen(p.locator("#termName"), 3000); await p.locator("#termName").fill("ops"); await p.keyboard.press("Enter");
  ok(await until(async () => (await p.locator('.wt-tabs [aria-selected="true"] .wt-tname').innerText()) === "ops"), "⋯ › Rename tab renames it");

  // the terminal's own actions: Launch, Send for review, Restart, Remove, Stop, Retry
  let lid = null;
  await p.keyboard.press("Alt+Meta+KeyN");
  ok(await until(async () => (await p.locator(".wt-new #termCmd").count()) && await p.evaluate(() => document.activeElement?.id === "termCmd")), "launch: Alt+Meta+KeyN opens the launcher, its command field focused");
  // and it keeps the focus: no terminal takes it back a frame later
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));
  await p.keyboard.type("abc");
  ok(await p.evaluate(() => document.activeElement?.id === "termCmd" && document.activeElement.value === "abc"), "two frames and 300 ms later the field still has it, and what is typed lands there");
  await p.locator("#termCmd").fill("");
  await p.keyboard.press("Alt+Meta+KeyN");
  ok(await until(async () => !(await p.locator(".wt-new").count())), "and again closes it");
  await viaMenu(p, "launch");
  ok(await until(async () => (await p.locator(".wt-new #termCmd").count()) && await p.evaluate(() => document.activeElement?.id === "termCmd")), "launch: ⋯ › launch opens it too");
  const GC = "git -c user.name=A -c user.email=a@example.invalid";
  await p.locator("#termCmd").fill(`${GC} checkout -q -b agent/chrome && echo x > f.txt && ${GC} add f.txt && ${GC} commit -q -m 'feat: f' && echo COMMITTED`);
  await p.locator("#termCmd").press("Enter");
  ok(await until(async () => { lid = urlId(p); return lid && (await list(p)).some((t) => t.id === lid && !t.running && t.git?.end?.commits === 1); }, 15000), "a command run from the launcher commits on a branch and ends");
  ok(await until(async () => (await tabs(p)).find((x) => x.sel)?.state === "done"), "its tab's dot says done");
  const dot = await p.evaluate(() => { const d = document.querySelector('.wt-tabs [aria-selected="true"] .wt-dot'); return { label: d.getAttribute("aria-label"), check: getComputedStyle(d, "::before").content }; });
  ok(/Done/.test(dot.label) && /✓/.test(dot.check), "done is a check mark with its word as the label, not a colour alone", JSON.stringify(dot));
  ok(await until(async () => (await p.locator('[data-term-menu-ready="review"]').count()) === 1), "Send for review is ready: a dot on ⋯ says so");
  const after = await items(p);
  ok(["dismiss", "restart", "review"].every((a) => after.includes(a)) && !after.includes("kill"), "an ended terminal's menu: Remove, Restart, Send for review (no Stop)", JSON.stringify(after));
  await menu(p);
  ok(/agent\/chrome · 1 commit\(s\) beyond main/.test(await p.locator(`[data-term-menu-pop] [data-term-review="${lid}"]`).innerText()) && /done|Done/.test(await p.locator("[data-term-menu-pop] .wt-mtitle").innerText()), "the menu's head names the branch and the state");
  await p.keyboard.press("Escape");
  // this Studio has no approved crew for code-firstmate: Send for review is refused, and the reason stays over the terminal
  await both(p, "send for review", "Alt+Meta+KeyS", "review", async () => (await p.locator(`[data-term-review-error="${lid}"]`).count()) && /^Send for review was refused: \S/.test(await p.locator(`[data-term-review-error="${lid}"]`).innerText()),
    async () => { await p.evaluate(() => crewTerminals.refused.clear()); await p.evaluate(() => render()); });
  let rid = lid;
  await both(p, "restart", "Alt+Meta+KeyR", "restart", async (was) => urlId(p) && urlId(p) !== was, async () => { const was = urlId(p); await until(async () => (await list(p)).some((t) => t.id === was && !t.running)); return was; });
  rid = urlId(p); await until(async () => (await list(p)).some((t) => t.id === rid && !t.running), 10000);
  // a fresh terminal in a tab of its own, focused, as the page itself lists it (the menu draws from that list)
  const fresh = async (how, running) => { const was = urlId(p), n = (await tabs(p)).length; await how();
    await until(async () => urlId(p) !== was && (await tabs(p)).length === n + 1, 10000); const id = urlId(p);
    await until(() => p.evaluate(([id, running]) => crewTerminals.list.some((t) => t.id === id && t.running === running), [id, running]), 10000); await p.waitForTimeout(300); return id; };
  const echoed = () => fresh(async () => { await p.keyboard.press("Alt+Meta+KeyN"); await seen(p.locator("#termCmd")); await p.locator("#termCmd").fill("echo bye"); await p.locator("#termCmd").press("Enter"); }, false);
  await both(p, "remove an ended terminal", "Alt+Meta+Backspace", "dismiss", async (was) => !(await list(p)).some((t) => t.id === was), echoed);
  await p.waitForTimeout(300);
  await both(p, "stop", "Alt+Meta+KeyX", "kill", async (id) => (await list(p)).some((t) => t.id === id && !t.running), () => fresh(() => p.keyboard.press("Meta+KeyT"), true));
  await both(p, "retry the output stream", "Alt+Meta+KeyG", "retry", async (es) => p.evaluate((old) => crewTerminals.mux.es && crewTerminals.mux.es !== window[old], es),
    // once the stream the last retry opened has replayed (its replay clears a notice): then a refusal of this terminal
    async () => { const id = urlId(p); await until(() => p.evaluate(() => crewTerminals.mux.es?.readyState === 1 && !crewTerminals.gone.size)); await p.waitForTimeout(800);
      await p.evaluate((id) => { window.__es0 = crewTerminals.mux.es; crewTerminals.mux.es.dispatchEvent(new MessageEvent("gone", { data: JSON.stringify({ id, code: "tooManyViews" }) })); }, id);
      await seen(p.locator(`[data-term-gone="${id}"]`), 3000); return "__es0"; });
  ok(await until(async () => !(await p.locator("[data-term-gone]").count()), 10000), "the pane's notice goes once the stream is open again");

  // "needs you" stands out: a shell idle at its prompt (the server's "waiting") gets a plain dot and no tint; a program that
  // asks gets the ring and the tinted name
  const mark = () => p.evaluate(() => { const tab = document.querySelector('.wt-tabs [aria-selected="true"]'), d = tab.querySelector(".wt-dot"), n = tab.querySelector(".wt-tname");
    return { state: d.dataset.termState, asks: d.dataset.termAsks ?? null, cls: d.className, ring: getComputedStyle(d).boxShadow, name: getComputedStyle(n).color,
      plain: getComputedStyle(document.querySelector(".wt-tabs .wt-tab:not([aria-selected='true']) .wt-tname") || n).color, human: getComputedStyle(document.documentElement).getPropertyValue("--human").trim(), label: d.getAttribute("aria-label") }; });
  const idleId = await fresh(() => p.keyboard.press("Meta+KeyT"), true);
  const idle = await until(async () => { const m = await mark(); return m.state === "waiting" ? m : null; }, 10000);
  ok(idle && !idle.asks && /\bidle\b/.test(idle.cls) && idle.ring === "none" && /Idle/.test(idle.label), "an idle shell at its prompt: a plain dot, no ring, labelled idle", JSON.stringify(idle));
  const askId = await fresh(async () => { await p.keyboard.press("Alt+Meta+KeyN"); await seen(p.locator("#termCmd")); await p.locator("#termCmd").fill("printf 'Apply the migration? [y/N] '; read a"); await p.locator("#termCmd").press("Enter"); }, true);
  const asks = await until(async () => { const m = await mark(); return m.asks === "1" ? m : null; }, 10000);
  ok(asks && /\bwaiting\b/.test(asks.cls) && asks.ring !== "none" && asks.name !== idle?.name && /Waiting for you/.test(asks.label), "a program that asks: the ring, the tinted name, labelled waiting for you", JSON.stringify(asks));
  await shot(p, "chrome-idle-vs-asking.png");
  ok(idleId !== askId, "two different terminals");
  await ctx.close();

  // ---------- a Mac in a browser tab: Open in a Studio window; Remote Control's link ----------
  const ctxT = await context(), q = await ctxT.newPage(); q.on("pageerror", (e) => errors.push(`tab: ${e}`));
  await q.goto(`${base}/#/terminals`); await seen(q.locator(".wt-stage .wt-pane"), 10000); await q.waitForTimeout(300);
  ok((await items(q)).includes("appWindow"), "in a browser tab the menu offers Open in a Studio window");
  await menu(q);
  ok(await q.locator('[data-term-menu-pop] [data-term-mi="newTab"] kbd').innerText() === "⌥T", "and shows the chord that works in a tab (⌥T for a new tab)");
  await q.keyboard.press("Escape"); await q.locator(".wt-xterm").first().click();
  let calls = 0;
  await both(q, "open in a Studio window", "Alt+Meta+KeyO", "appWindow", async () => existsSync(openLog) && readFileSync(openLog, "utf8").split("\x1e").filter(Boolean).length === calls + 1,
    async () => { calls = existsSync(openLog) ? readFileSync(openLog, "utf8").split("\x1e").filter(Boolean).length : 0; if (calls) await q.waitForTimeout(5200); }); // Studio opens one window per 5 s
  await q.keyboard.press("Alt+Meta+KeyN"); await seen(q.locator('[data-preset="claude"]'));
  await q.locator('[data-preset="claude"]').click();
  ok(await until(async () => (await items(q)).includes("remote"), 10000), "Claude Code with Remote Control: the menu has its link");
  await viaMenu(q, "remote");
  ok(await seen(q.locator("[data-term-remote-sheet] [data-term-remote-url]"), 3000) && (await q.locator("[data-term-remote-url]").innerText()) === "https://claude.ai/code/rc-CHROMEFAKE42" && await q.locator("[data-term-remote-sheet] .wt-qr svg").count() === 1, "⋯ › Remote Control link shows the link and its QR code");
  await shot(q, "chrome-remote.png");
  await q.keyboard.press("Escape");
  ok(await until(async () => !(await q.locator("[data-term-remote-sheet]").count())), "Esc closes it");
  await ctxT.close();

  // ---------- 390 px, and Traditional Chinese ----------
  const ctxP = await context({ width: 390, height: 844, lang: "zh-TW" }), r = await ctxP.newPage(); r.on("pageerror", (e) => errors.push(`phone: ${e}`));
  await r.goto(`${base}/#/terminals`); await seen(r.locator(".wt-stage .wt-pane"), 10000); await r.waitForTimeout(300);
  await menu(r);
  const fit = await r.evaluate(() => { const m = document.querySelector("[data-term-menu-pop]").getBoundingClientRect(); return { l: m.left, r: m.right, vw: innerWidth, sw: document.documentElement.scrollWidth }; });
  ok(fit.l >= 0 && fit.r <= fit.vw && fit.sw <= fit.vw + 1, "at 390 px the open menu fits the screen, no sideways scroll", JSON.stringify(fit));
  ok(/停止/.test(await r.locator('[data-term-menu-pop] [data-term-mi="kill"]').innerText()) && /快捷鍵/.test(await r.locator('[data-term-menu-pop] [data-term-mi="help"]').innerText()), "the menu speaks Traditional Chinese");
  await r.locator('[data-term-menu-pop] [data-term-mi="splitRight"]').click();
  ok(await until(async () => (await panes(r)).length === 2), "and its items work on a narrow screen");
  await shot(r, "chrome-390-zh.png");
  await ctxP.close();
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  try { await browser?.close(); } catch {}
  const exited = app && app.exitCode === null && app.signalCode === null ? new Promise((r) => { const t = setTimeout(r, 15000); app.once("exit", () => { clearTimeout(t); r(); }); }) : null;
  try { app?.kill("SIGTERM"); } catch {}
  await exited; rmSync(tmp, { recursive: true, force: true });
}
console.log(`terminal-chrome-ui: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
