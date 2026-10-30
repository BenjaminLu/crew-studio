import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Typing into a web terminal in a real browser (public/terminals.js, docs/units/web-terminal.md, "Typing"), a stub server
// with temporary data and a plain command only (no agent CLI, no model). What the page POSTs to /api/terminals/<id>/input is
// what reaches the PTY, so the test reads those bodies:
//   an input method (Chromium's own, driven over CDP: Input.imeSetComposition, Input.insertText) composing 中文 in steps
//   (ㄓ → 中 → 中ㄨ → 中文) sends 中文 exactly once; an input method that commits the front of what it composes while the
//   rest goes on composing (中 committed, 文 still open, as Zhuyin and Pinyin do when the buffer fills or a word is
//   confirmed) sends each character once, not the whole word again (xterm.js 5.5.0's own composition helper did);
//   two words in a row each arrive once.
// Not covered: the operating system's own Zhuyin keyboard (macOS) - CDP drives Chromium's input-method layer, not the OS's.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-terminal-input-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data");
for (const d of [home, proj, state, data, join(home, ".codex")]) mkdirSync(d, { recursive: true });
let pass = 0, fail = 0, browser, app; const errors = [];
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };

writeFileSync(join(data, "projects.json"), JSON.stringify([{ id: "demo", name: "Demo", path: proj, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true }]));
const BUN = process.versions.bun ? process.execPath : execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
const TOKEN = "terminal-input-ui-session";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
try {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  app = spawn(BUN, ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), PATH: `${dirname(BUN)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: "/bin/bash",
    CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data, CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub",
    CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_TERMINAL_IDLE_MS: "400",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: join(home, ".claude/projects") } });
  app.stdout.resume(); await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(String(e)));
  const sent = []; p.on("request", (r) => { if (/\/api\/terminals\/[^/]+\/input$/.test(r.url())) sent.push(JSON.parse(r.postData()).data); });
  const cdp = await ctx.newCDPSession(p);
  const rows = () => p.locator(".wt-xterm .xterm-rows").innerText();
  // a terminal started the way the page starts one (the desktop page's cookie), then shown and focused
  const open = async (body) => {
    await p.goto(base + "/#/terminals"); await p.waitForFunction(() => window.crewTerminals?.list !== null);
    const id = await p.evaluate(async (b) => { const r = await fetch("/api/terminals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: "demo", cols: 100, rows: 30, ...b }) }); return (await r.json()).terminal.id; }, body);
    await p.goto(`${base}/#/terminals/${encodeURIComponent(id)}`); await p.locator(`.wt-pane[data-term-pane="${id}"] .xterm-rows`).waitFor({ timeout: 10000 });
    const hide = p.locator('[data-term-appwin] button[aria-label="Hide"]'); if (await hide.count()) await hide.click();
    await p.locator(`.wt-pane[data-term-pane="${id}"] .xterm-screen`).click(); await p.waitForTimeout(300);
    return id;
  };
  const comp = async (text) => { await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length }); await p.waitForTimeout(40); };
  const typed = async () => { await p.waitForTimeout(400); const s = sent.join(""); sent.length = 0; return s; };

  // ---------- an input method ----------
  await open({ command: "cat >/dev/null" }); sent.length = 0;
  await comp("ㄓ"); await comp("中"); await comp("中ㄨ"); await comp("中文");
  ok((await typed()) === "", "while composing, nothing is sent");
  await comp("中文"); await cdp.send("Input.insertText", { text: "中文" });
  let s = await typed();
  ok(s === "中文", "ㄓ → 中 → 中ㄨ → 中文, then committed: 中文 is sent exactly once", JSON.stringify(s));

  // the front committed while the rest goes on composing: one keystroke, so both reach the page before any timer
  await comp("ㄓ"); await comp("中"); await comp("中ㄨ"); await comp("中文");
  await Promise.all([cdp.send("Input.insertText", { text: "中" }), cdp.send("Input.imeSetComposition", { text: "文", selectionStart: 1, selectionEnd: 1 })]);
  await p.waitForTimeout(150); await cdp.send("Input.insertText", { text: "文" });
  s = await typed();
  ok(s === "中文", "中 committed while 文 still composes, then 文 committed: 中文, not 中文文", JSON.stringify(s));

  // a longer run: three commits of the front, each one keystroke with the next composition
  await comp("ㄊ"); await comp("台"); await comp("台ㄨ"); await comp("台灣"); await comp("台灣ㄓ"); await comp("台灣中"); await comp("台灣中文");
  for (const [c, rest] of [["台", "灣中文"], ["灣", "中文"], ["中", "文"]]) {
    await Promise.all([cdp.send("Input.insertText", { text: c }), cdp.send("Input.imeSetComposition", { text: rest, selectionStart: rest.length, selectionEnd: rest.length })]); await p.waitForTimeout(80); }
  await cdp.send("Input.insertText", { text: "文" });
  s = await typed();
  ok(s === "台灣中文", "台灣中文 committed a character at a time while the rest composes: each character once", JSON.stringify(s));

  // two words in a row, each committed whole, with plain keys between
  await comp("ㄋ"); await comp("你"); await comp("你好"); await cdp.send("Input.insertText", { text: "你好" }); await p.waitForTimeout(80);
  await p.keyboard.type(" ok "); await comp("ㄕ"); await comp("世"); await comp("世界"); await cdp.send("Input.insertText", { text: "世界" });
  s = await typed();
  ok(s === "你好 ok 世界", "two words with plain keys between them: each once", JSON.stringify(s));

  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  try { await browser?.close(); } catch {}
  try { app?.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true });
}
console.log(`terminal-input-ui: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
