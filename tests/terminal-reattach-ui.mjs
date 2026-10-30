import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Closing and reopening Studio's page, and ended shells, in a real browser (public/terminals.js, src/terminals.ts,
// docs/units/web-terminal.md "Bounds, lifetime, record"), a stub server with temporary data and plain shells only:
//   a shell keeps running when its page closes; a new page (the app window reopened) gets its tab back, the output it had
//   (a marker) replayed, and typing reaches the same shell (the same $$); the replay is bounded (CREW_TERMINAL_SCROLLBACK)
//   and says what it dropped; `exit` in a shell closes its tab and takes it off the list, and a reload lists live shells
//   only; Stop ends the shell (its process is gone) and it leaves too; a Studio restart ends every shell: the next page
//   says so once ("ended when Studio restarted"), shows no dead tab and lists none of them, and a second load says nothing.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-terminal-reattach-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data");
for (const d of [home, proj, state, data, join(home, ".codex")]) mkdirSync(d, { recursive: true });
let pass = 0, fail = 0, browser, app; const errors = [];
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

writeFileSync(join(data, "projects.json"), JSON.stringify([{ id: "demo", name: "Demo", path: proj, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true }]));
writeFileSync(join(home, ".bashrc"), "PS1='$ '\n");
const BUN = process.versions.bun ? process.execPath : execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
const TOKEN = "terminal-reattach-ui-session", CAP = 65536;
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const boot = async () => {
  const a = spawn(BUN, ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), PATH: `${dirname(BUN)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: "/bin/bash",
    CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data, CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub",
    CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_TERMINAL_IDLE_MS: "400", CREW_TERMINAL_SCROLLBACK: String(CAP),
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: join(home, ".claude/projects") } });
  a.stdout.resume(); await waitUp(base, a); return a;
};
try {
  app = await boot();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
  const page = async () => { const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(String(e))); return p; };
  const rowsOf = (p, id) => p.locator(`.wt-pane[data-term-pane="${id}"] .xterm-rows`).innerText().catch(() => "");
  const tabsOf = (p) => p.locator(".wt-tabs [data-term-tab]").count();
  const listed = (p) => p.evaluate(async () => (await (await fetch("/api/terminals")).json()).terminals.map((t) => ({ id: t.id, running: t.running, kind: t.kind })));
  const startShell = (p) => p.evaluate(async () => { const r = await fetch("/api/terminals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: "demo", preset: "shell", cols: 100, rows: 30 }) }); return (await r.json()).terminal.id; });
  const show = async (p, id) => { await p.goto(`${base}/#/terminals/${encodeURIComponent(id)}`); await p.locator(`.wt-pane[data-term-pane="${id}"] .xterm-rows`).waitFor({ timeout: 10000 });
    const hide = p.locator('[data-term-appwin] button[aria-label="Hide"]'); if (await hide.count()) await hide.click();
    await p.locator(`.wt-pane[data-term-pane="${id}"] .xterm-screen`).click(); await until(async () => /\$ $/m.test(await rowsOf(p, id))); };
  const say = async (p, line) => { await p.keyboard.type(line); await p.keyboard.press("Enter"); };
  const pidOf = async (p, id, tag) => { await say(p, `echo ${tag}=$$`); const m = await until(async () => new RegExp(`^${tag}=(\\d+)`, "m").exec(await rowsOf(p, id))); return m ? +m[1] : null; };

  // ---------- a shell outlives its page ----------
  let p = await page(); await p.goto(base + "/#/terminals"); await p.waitForFunction(() => window.crewTerminals?.list !== null);
  const a = await startShell(p); await show(p, a);
  await say(p, "echo MARK-$((6*7))");
  ok(await until(async () => /^MARK-42/m.test(await rowsOf(p, a))), "the shell runs and prints a marker");
  const pid1 = await pidOf(p, a, "PIDA");
  ok(pid1 && alive(pid1), "the shell's pid is known and alive", String(pid1));
  await p.close();
  await new Promise((r) => setTimeout(r, 800));
  ok(alive(pid1), "with its page closed, the shell keeps running");
  p = await page(); await p.goto(base + "/#/terminals");
  ok(await until(async () => (await tabsOf(p)) === 1 && (await p.locator(`.wt-pane[data-term-pane="${a}"]`).count()) === 1), "a new page gets the shell's tab back", String(await tabsOf(p)));
  ok(await until(async () => /^MARK-42/m.test(await rowsOf(p, a))), "with the output it had replayed (the marker)");
  await p.locator(`.wt-pane[data-term-pane="${a}"] .xterm-screen`).click();
  const pid2 = await pidOf(p, a, "PIDB");
  ok(pid2 === pid1, "typing reaches the same shell: the same $$", JSON.stringify({ pid1, pid2 }));

  // ---------- the replay is bounded ----------
  await say(p, `head -c ${CAP * 3} /dev/zero | tr '\\0' x; echo; echo BIG-DONE`);
  await until(async () => /^BIG-DONE/m.test(await rowsOf(p, a)), 10000);
  const replay = await p.evaluate(async (id) => {
    const ac = new AbortController(), r = await fetch(`/api/terminals/${id}/stream`, { signal: ac.signal }), rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    while (!/event: replay\ndata: .*\n/.test(buf)) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); }
    ac.abort(); const d = JSON.parse(/event: replay\ndata: (.*)\n/.exec(buf)[1]); return { bytes: atob(d.b64).length, dropped: d.dropped };
  }, a);
  ok(replay.bytes <= CAP && replay.bytes > CAP / 2 && replay.dropped > 0, `the replay is at most CREW_TERMINAL_SCROLLBACK (${CAP} bytes) and says what it dropped`, JSON.stringify(replay));

  // ---------- an ended shell leaves ----------
  const b = await startShell(p); await show(p, b);
  await say(p, "exit");
  ok(await until(async () => !(await p.locator(`.wt-pane[data-term-pane="${b}"]`).count()) && !(await p.locator(`[data-term-tab]`).filter({ has: p.locator(`[data-term-pane="${b}"]`) }).count())), "`exit` in a shell closes its tab");
  ok(await until(async () => !(await listed(p)).some((t) => t.id === b)), "and takes it off the list");
  ok(await until(async () => !(await p.locator(`[data-term-row="${b}"]`).count())), "the page lists it nowhere");
  await p.reload(); await p.waitForFunction(() => window.crewTerminals?.list !== null); await p.waitForTimeout(500);
  const afterReload = await listed(p);
  ok(afterReload.length === 1 && afterReload[0].id === a && afterReload[0].running && (await tabsOf(p)) === 1, "a reload lists the live shell only, in its one tab", JSON.stringify(afterReload));

  // Stop ends the shell: its process is gone, and it leaves too
  const c = await startShell(p); await show(p, c); const pidC = await pidOf(p, c, "PIDC");
  await p.locator(`[data-term-kill="${c}"]`).click();
  ok(await until(async () => !alive(pidC), 6000), "Stop ends the shell (its process is gone)", String(pidC));
  ok(await until(async () => !(await listed(p)).some((t) => t.id === c) && !(await p.locator(`.wt-pane[data-term-pane="${c}"]`).count())), "and it leaves the list and its tab");

  // a browser with no tabs saved (another profile, cleared site data) gets a tab for every running terminal, not just one
  const d = await startShell(p);
  {
    const c2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await c2.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
    const q = await c2.newPage(); q.on("pageerror", (e) => errors.push(String(e))); await q.goto(base + "/#/terminals");
    ok(await until(async () => (await tabsOf(q)) === 2), "a browser with no tabs saved opens a tab for each running terminal", String(await tabsOf(q)));
    for (const id of [a, d]) { await q.locator(".wt-tabs [data-term-tab]").nth(id === a ? 0 : 1).click(); ok(await until(async () => (await q.locator(`.wt-pane[data-term-pane="${id}"]`).count()) === 1), `its tab ${id === a ? 1 : 2} shows that terminal`); }
    await c2.close();
  }

  // ---------- a Studio restart ends every shell ----------
  await p.close();
  app.kill("SIGTERM"); await new Promise((r) => app.once("exit", r));
  ok(await until(async () => !alive(pid1), 5000), "Studio stopping ends the shell (a restart cannot keep a PTY)");
  app = await boot();
  { const s = await ctx.newPage(); await s.goto(`${base}/session?t=${encodeURIComponent(TOKEN)}`); await s.close(); }
  p = await page(); await p.goto(base + "/#/terminals"); await p.waitForFunction(() => window.crewTerminals?.list !== null);
  const toast = await until(async () => { const t = await p.locator(".toast, [role=status]").allInnerTexts(); return t.find((x) => /ended when Studio restarted/i.test(x)); }, 6000);
  ok(!!toast, "the next page says once that the sessions ended when Studio restarted", String(toast));
  ok(await until(async () => (await tabsOf(p)) === 0 && !(await p.locator(".wt-pane[data-term-pane]").count())), "and shows no dead tab", String(await tabsOf(p)));
  ok(!(await listed(p)).length && !(await p.locator("[data-term-row]").count()), "and lists none of the ended shells", JSON.stringify(await listed(p)));
  await p.reload(); await p.waitForFunction(() => window.crewTerminals?.list !== null); await p.waitForTimeout(1500);
  ok(!(await p.locator(".toast, [role=status]").allInnerTexts()).some((x) => /ended when Studio restarted/i.test(x)), "a second load says nothing more");
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  try { await browser?.close(); } catch {}
  try { app?.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true });
}
console.log(`terminal-reattach-ui: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
