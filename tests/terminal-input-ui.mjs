import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Typing into a web terminal in a real browser (public/terminals.js, docs/units/web-terminal.md, "Typing"), a stub server
// with temporary data and plain shells only (no agent CLI, no model). What the page POSTs to /api/terminals/<id>/input is
// what reaches the PTY, so the test reads those bodies:
//   an input method (Chromium's own, driven over CDP: Input.imeSetComposition, Input.insertText) composing 中文 in steps
//   (ㄓ → 中 → 中ㄨ → 中文) sends 中文 exactly once; an input method that commits the front of what it composes while the
//   rest goes on composing (中 committed, 文 still open, as Zhuyin and Pinyin do when the buffer fills or a word is
//   confirmed) sends each character once, not the whole word again (xterm.js 5.5.0's own composition helper did);
//   two words in a row each arrive once; Tab reaches the PTY as "\t", the focus stays in the terminal, and the shell
//   completes the command with it; the colours drawn (public/term-theme.js): dim bright black, blue and dim default text
//   reach 4.5:1 against the terminal's background in the light and the dark theme.
// Not covered: the operating system's own Zhuyin keyboard (macOS) - CDP drives Chromium's input-method layer, not the OS's.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
writeFileSync(join(home, ".bashrc"), "PS1='$ '\n");
writeFileSync(join(home, ".zshrc"), "PS1='%% '\n");
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

  // ---------- Tab ----------
  const shell = await open({ preset: "shell" });
  await until(async () => /\$ $/m.test(await rows()), 8000); sent.length = 0;
  await p.keyboard.type("ech"); await p.keyboard.press("Tab"); await p.keyboard.type("tab-done-$((40+2))"); await p.keyboard.press("Enter");
  s = await typed();
  ok(s.startsWith("ech\t"), "Tab reaches the PTY as \\t", JSON.stringify(s));
  ok(await p.evaluate((id) => !!document.activeElement?.closest(`.wt-pane[data-term-pane="${id}"]`) && document.activeElement.classList.contains("xterm-helper-textarea"), shell), "the focus stays in the terminal after Tab");
  ok(await until(async () => /tab-done-42/.test(await rows())), "the shell completed ech to echo with it (tab-done-42 printed)", await rows());
  // zsh, macOS's login shell, with no completion system loaded (compinit): its own completion still runs on Tab
  if (existsSync("/bin/zsh")) {
    await open({ command: "exec /bin/zsh -i" });
    await until(async () => /% $/m.test(await p.locator(".wt-pane.focus .xterm-rows").innerText()), 8000);
    await p.keyboard.type("ech"); await p.keyboard.press("Tab"); await p.keyboard.type("tab-zsh-$((40+4))"); await p.keyboard.press("Enter");
    ok(await until(async () => /tab-zsh-44/.test(await p.locator(".wt-pane.focus .xterm-rows").innerText())), "zsh completes ech to echo on Tab too", await p.locator(".wt-pane.focus .xterm-rows").innerText());
  }
  // started from the launcher's Shell button, typed into without a click: the new terminal has the focus, Tab is its own
  await p.goto(base + "/#/terminals"); await p.locator("[data-term-new]").click(); await p.locator('[data-preset="shell"]').click();
  await until(async () => (await p.locator(".wt-pane.focus .xterm-rows").count()) && /\$ $/m.test(await p.locator(".wt-pane.focus .xterm-rows").innerText()), 10000);
  await p.waitForTimeout(300); sent.length = 0;
  const where = () => p.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}.${a.className}` : "none"; });
  const w0 = await where();
  await p.keyboard.type("ech"); await p.keyboard.press("Tab"); const w1 = await where(); await p.keyboard.type("tab-two-$((40+3))"); await p.keyboard.press("Enter");
  s = await typed();
  ok(s.startsWith("ech\t") && /xterm-helper-textarea/.test(w0) && /xterm-helper-textarea/.test(w1), "a terminal just started from the launcher has the focus, and Tab goes to it", JSON.stringify({ s, w0, w1 }));
  ok(await until(async () => /tab-two-43/.test(await p.locator(".wt-pane.focus .xterm-rows").innerText())), "and the shell completes with it");
  // a click on the pane around the terminal (its bar, the frame's padding) or the page around it, then Tab
  for (const [what, sel, pos] of [["the pane's bar", ".wt-pane.focus .wt-pbar b", null], ["the frame's padding", ".wt-pane.focus .wt-xterm", { x: 2, y: 2 }]]) {
    await p.locator(sel).first().click(pos ? { position: pos } : {}); await p.waitForTimeout(150); sent.length = 0;
    const before = await where(); await p.keyboard.press("Tab"); const after = await where(); const t = await typed();
    ok(t === "\t" && /xterm-helper-textarea/.test(after), `a click on ${what}, then Tab: \\t reaches the terminal, the focus stays in it`, JSON.stringify({ t, before, after }));
  }
  // ---------- the colours drawn, in both themes ----------
  for (const theme of ["dark", "light"]) {
    await p.evaluate((t) => setTheme(t), theme); // Settings' own switch (app.js)
    const id = await open({ command: "printf '\\033[2;90mDIMHINT\\033[0m \\033[34mBLUETXT\\033[0m \\033[2mDIMFG\\033[0m \\033[90mHINTTXT\\033[0m\\n'; exec cat >/dev/null" });
    await until(async () => /HINTTXT/.test(await rows()));
    const got = await p.evaluate((id) => {
      const TT = window.crewTermTheme, host = document.querySelector(`[data-term-host="${CSS.escape(id)}"]`);
      const hex = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const a = m[3] ?? 1; return { rgb: m.slice(0, 3), a }; };
      const bgc = getComputedStyle(host.querySelector(".xterm-viewport")).backgroundColor, bg = hex(bgc).rgb;
      const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
      const out = { bg: toHex(bg), theme: document.documentElement.dataset.theme || "" };
      for (const w of ["DIMHINT", "BLUETXT", "DIMFG", "HINTTXT"]) {
        const span = [...host.querySelectorAll(".xterm-rows span")].find((s) => s.textContent.includes(w[0]) && s.closest("div").textContent.includes(w)) ;
        const all = [...host.querySelectorAll(".xterm-rows span")].filter((s) => w.includes(s.textContent.trim()) && s.textContent.trim());
        const el = all[0] || span; if (!el) { out[w] = null; continue; }
        const c = hex(getComputedStyle(el).color), mixed = c.rgb.map((v, i) => v * c.a + bg[i] * (1 - c.a)); // what the eye sees
        out[w] = { color: toHex(mixed), ratio: +TT.contrast(toHex(mixed), toHex(bg)).toFixed(2) };
      }
      return out;
    }, id);
    const words = ["DIMHINT", "BLUETXT", "DIMFG", "HINTTXT"];
    ok(got.theme === theme && got.bg === (theme === "dark" ? "#1c2029" : "#f2f4f7"), `${theme} theme: the terminal is drawn on that theme's surface`, JSON.stringify(got));
    ok(words.every((w) => got[w] && got[w].ratio >= 4.5), `${theme} theme: dim bright black, blue, dim default text and bright black are drawn at 4.5:1 or more`, JSON.stringify(got));
  }
  await p.evaluate(() => setTheme("system"));
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  try { await browser?.close(); } catch {}
  try { app?.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true });
}
console.log(`terminal-input-ui: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
