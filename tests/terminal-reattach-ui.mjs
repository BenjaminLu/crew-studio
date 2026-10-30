import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Closing and reopening Studio's page, and ended shells, in a real browser (public/terminals.js, src/terminals.ts,
// docs/units/web-terminal.md "Bounds, lifetime, record"), a stub server with temporary data and plain shells only:
//   a shell keeps running when its page closes; a new page (the app window reopened) gets its tab back, the output it had
//   (a marker) replayed, and typing reaches the same shell (the same $$); the replay is bounded (CREW_TERMINAL_SCROLLBACK)
//   and says what it dropped; `exit` in a shell closes its tab and takes it off the list, and a reload lists live shells
//   only; a shell ending while the captain types in the go-to picker or a tab's name leaves that field alone (same element,
//   text, caret) and its tab goes once the field closes; Stop ends the shell (its process is gone) and it leaves too; a
//   shell that fails (an rc file that exits 3) stays,
//   with its last output and its exit code, until removed; a shell that exits 0 with a commit beyond main stays with Send
//   for review, one with uncommitted changes stays, one with nothing to review leaves; a Studio restart ends every shell:
//   the next page says so once ("ended when Studio restarted"), shows no dead tab and lists none of them, and a second
//   load says nothing;
//   with two windows open through a restart, each drops the tab of the command the restart ended, a command that had
//   finished before (kept, as an agent is for review) keeps its tab, and the toast counts only the one.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { checkedTempDir } from "./lib/git-hygiene.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-terminal-reattach-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data");
for (const d of [home, proj, state, data, join(home, ".codex")]) mkdirSync(d, { recursive: true });
let pass = 0, fail = 0, browser, app; const errors = [];
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// a git project (Send for review needs a branch with commits beyond its base), and one whose shell's rc file fails
// the repository lives in a checked temp folder (tests/lib/git-hygiene.mjs)
const ck = checkedTempDir("crew-terminal-reattach-repo-"), repo = join(ck, "repo"), broken = join(tmp, "broken"); for (const d of [repo, broken]) mkdirSync(d, { recursive: true });
const G = ["-c", "user.name=T", "-c", "user.email=t@example.invalid"];
execFileSync("git", ["init", "-q", "-b", "main", repo]); writeFileSync(join(repo, "README.md"), "fixture\n");
execFileSync("git", [...G, "add", "README.md"], { cwd: repo }); execFileSync("git", [...G, "commit", "-q", "-m", "init"], { cwd: repo });
writeFileSync(join(broken, ".broken"), "");
// a repository just made (no commit yet, so no HEAD), and one whose configured base does not exist
const fresh = join(ck, "fresh"), nobase = join(ck, "nobase"); for (const d of [fresh, nobase]) mkdirSync(d, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main", fresh]);
execFileSync("git", ["init", "-q", "-b", "main", nobase]); writeFileSync(join(nobase, "README.md"), "fixture\n");
execFileSync("git", [...G, "add", "README.md"], { cwd: nobase }); execFileSync("git", [...G, "commit", "-q", "-m", "init"], { cwd: nobase });
const P = (id, path, base = "main") => ({ id, name: id, path, base, sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true });
writeFileSync(join(data, "projects.json"), JSON.stringify([P("demo", proj), P("repo", repo), P("broken", broken), P("fresh", fresh), P("nobase", nobase, "trunk")]));
writeFileSync(join(home, ".bash_profile"), "PS1='$ '\nif [ -f .broken ]; then echo 'rc: this setup is broken'; exit 3; fi\n");
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
  const listed = (p) => p.evaluate(async () => (await (await fetch("/api/terminals")).json()).terminals.map((t) => ({ id: t.id, running: t.running, kind: t.kind, exitCode: t.exitCode, signal: t.signal })));
  const startShell = (p, project = "demo") => p.evaluate(async (project) => { const r = await fetch("/api/terminals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project, preset: "shell", cols: 100, rows: 30 }) }); return (await r.json()).terminal.id; }, project);
  const dismiss = (p, id) => p.evaluate(async (id) => (await fetch(`/api/terminals/${id}/dismiss`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).ok, id);
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

  // a shell that ends in the background while the captain types in a field of the page (the go-to picker, the tab's
  // name): the field is not redrawn (the same element keeps the focus, the text and the caret); the tab goes once it is left
  for (const [what, act, sel] of [["the go-to picker", "goto", "#termPickQ"], ["the tab's name", "renameTab", "#termName"]]) {
    const live = await startShell(p), gone = await startShell(p); await show(p, live); await show(p, gone);
    await p.evaluate((act) => window.crewTerminals.run(act), act);
    await p.locator(sel).waitFor(); await p.locator(sel).click(); await p.keyboard.press("End"); await p.keyboard.type(" typed");
    const before = await p.evaluate((sel) => { const el = document.querySelector(sel); el.dataset.mark = "kept"; return el.value; }, sel);
    await p.evaluate(async (id) => fetch(`/api/terminals/${id}/input`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "exit\r" }) }), gone);
    await until(async () => !(await listed(p)).some((t) => t.id === gone)); await p.waitForTimeout(600);
    const after = await p.evaluate(() => { const a = document.activeElement; return { mark: a?.dataset?.mark ?? null, value: a?.value ?? null, caret: a?.selectionStart ?? null, len: a?.value?.length ?? null }; });
    ok(after.mark === "kept" && after.value === before && before.endsWith(" typed") && after.caret === after.len, `a shell ending while the captain types in ${what}: the same field keeps the focus, the text and the caret`, JSON.stringify({ before, after }));
    await p.keyboard.press("Escape");
    ok(await until(async () => !(await p.locator(`.wt-pane[data-term-pane="${gone}"]`).count()) && !(await p.locator(sel).count())), `and once ${what} closes, the ended shell's tab is gone`);
    await p.evaluate(async (id) => fetch(`/api/terminals/${id}/kill`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), live);
    await until(async () => !(await listed(p)).some((t) => t.id === live));
  }

  // Stop ends the shell: its process is gone, and it leaves too
  const c = await startShell(p); await show(p, c); const pidC = await pidOf(p, c, "PIDC");
  await p.locator(`[data-term-kill="${c}"]`).click();
  ok(await until(async () => !alive(pidC), 6000), "Stop ends the shell (its process is gone)", String(pidC));
  ok(await until(async () => !(await listed(p)).some((t) => t.id === c) && !(await p.locator(`.wt-pane[data-term-pane="${c}"]`).count())), "and it leaves the list and its tab");

  // a shell that fails stays, with its exit code and its last words: one whose rc file exits 3 dies as it starts
  const e = await startShell(p, "broken");
  await p.goto(`${base}/#/terminals/${encodeURIComponent(e)}`);
  ok(await until(async () => (await listed(p)).some((t) => t.id === e && !t.running)), "a shell whose rc file exits 3 ends at once");
  await p.waitForTimeout(800);
  ok((await listed(p)).some((t) => t.id === e) && (await p.locator(`.wt-pane[data-term-pane="${e}"]`).count()) === 1, "it stays listed and in its tab: an error is not cleaned away");
  ok(await until(async () => { const r = await rowsOf(p, e); return /rc: this setup is broken/.test(r) && /process ended: exit 3/.test(r); }), "its pane shows its last output and exit 3", await rowsOf(p, e));
  ok(await until(async () => /Exited 3/.test(await p.locator(`.wt-pane[data-term-pane="${e}"] .wt-pbar, [data-term-detail="${e}"] .wt-dhead`).allInnerTexts().then((x) => x.join(" ")))), "and its badge says Exited 3");
  ok(await dismiss(p, e) && await until(async () => !(await listed(p)).some((t) => t.id === e)), "the captain removes it");

  // a shell that exits 0 with work to send for review stays, with Send for review; one with nothing to review leaves
  const r1 = await startShell(p, "repo"); await show(p, r1);
  await say(p, `git checkout -q -b work && git ${G.join(" ")} commit -q --allow-empty -m work && exit`);
  ok(await until(async () => (await listed(p)).some((t) => t.id === r1 && !t.running)), "a shell that committed on a branch exits 0");
  await p.waitForTimeout(800);
  ok((await listed(p)).some((t) => t.id === r1), "it stays listed: it has a commit beyond main to send for review");
  ok(await until(async () => (await p.locator(`[data-term-send="${r1}"]:not([disabled])`).count()) === 1), "with Send for review, ready");
  await dismiss(p, r1); execFileSync("git", ["checkout", "-q", "main"], { cwd: repo });
  const r2 = await startShell(p, "repo"); await show(p, r2);
  await say(p, "echo draft > notes.txt; exit");
  await p.waitForTimeout(1500);
  ok((await listed(p)).some((t) => t.id === r2 && !t.running), "a shell that leaves uncommitted work behind stays listed (the tree is not clean)");
  await dismiss(p, r2); rmSync(join(repo, "notes.txt"), { force: true });
  const r3 = await startShell(p, "repo"); await show(p, r3);
  await say(p, "exit");
  ok(await until(async () => !(await listed(p)).some((t) => t.id === r3) && !(await p.locator(`.wt-pane[data-term-pane="${r3}"]`).count())), "a shell in the repository with nothing beyond main and a clean tree leaves on exit 0");
  // where git cannot show there is nothing to review, the shell stays: a repository with no commit yet and a new file in
  // it, and a clean branch whose base does not exist (its commit count unknown)
  for (const [project, what, line] of [["fresh", "a just-initialised repository with an untracked file", "echo draft > notes.txt; exit"], ["nobase", "a clean checkout whose base (trunk) does not exist", "exit"]]) {
    const id = await startShell(p, project); await show(p, id); await say(p, line);
    await until(async () => !(await listed(p)).some((t) => t.id === id && t.running)); await p.waitForTimeout(1200);
    ok((await listed(p)).some((t) => t.id === id && !t.running), `a shell in ${what} stays listed on exit 0: git cannot show there is nothing to review`);
    await dismiss(p, id);
  }

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

  // ---------- a restart, with two windows open and a finished agent kept for review ----------
  // a command that finished before the restart (kept listed, as an agent is for Send for review) keeps its tab; the one
  // that was running when the windows last saw it, and died with the restart, leaves both windows' tabs; the toast counts it
  const startCmd = (q, command) => q.evaluate(async (command) => (await (await fetch("/api/terminals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: "demo", command, cols: 100, rows: 30 }) })).json()).terminal.id, command);
  const kept = await startCmd(p, "echo finished-before-restart"), died = await startCmd(p, "exec cat");
  await until(async () => (await listed(p)).some((t) => t.id === kept && !t.running));
  for (const id of [kept, died]) { await p.goto(`${base}/#/terminals/${encodeURIComponent(id)}`); await p.locator(`.wt-pane[data-term-pane="${id}"] .xterm-rows`).waitFor({ timeout: 10000 }); }
  const p2 = await page(); await p2.goto(`${base}/#/terminals/${encodeURIComponent(died)}`); await p2.locator(`.wt-pane[data-term-pane="${died}"] .xterm-rows`).waitFor({ timeout: 10000 });
  const panes = (q) => q.evaluate(() => { const out = []; const walk = (n) => { if (!n) return; if (n.t === "pane") out.push(n.term); else { walk(n.a); walk(n.b); } }; for (const t of window.crewTerminals.lay.tabs) walk(t.root); return out; });
  ok((await panes(p)).includes(kept) && (await panes(p)).includes(died) && (await panes(p2)).includes(died), "two windows show the running command; the first also the finished one", JSON.stringify({ p: await panes(p), p2: await panes(p2) }));
  const toasts = []; for (const [n, q] of [["first", p], ["second", p2]]) await q.exposeFunction(`__toast_${n}`, (t) => toasts.push(`${n}: ${t}`)).catch(() => {});
  for (const [n, q] of [["first", p], ["second", p2]]) await q.evaluate((n) => { new MutationObserver((ms) => { for (const m of ms) for (const el of m.addedNodes) if (el.classList?.contains("toast")) window[`__toast_${n}`](el.textContent); }).observe(document.body, { childList: true }); }, n);
  app.kill("SIGTERM"); await new Promise((r) => app.once("exit", r));
  app = await boot();
  { const s = await ctx.newPage(); await s.goto(`${base}/session?t=${encodeURIComponent(TOKEN)}`); await s.close(); }
  // neither window is reloaded: each sees the new run on its own stream and cleans its own tabs
  for (const [n, q] of [["first", p], ["second", p2]]) {
    ok(await until(async () => !(await panes(q)).includes(died) && !(await q.locator(`.wt-pane[data-term-pane="${died}"]`).count()), 15000), `the ${n} window drops the tab of the command the restart ended, without a reload`, JSON.stringify(await panes(q)));
  }
  ok((await panes(p)).includes(kept), "the finished command, kept for review, keeps its tab", JSON.stringify(await panes(p)));
  ok(await until(async () => toasts.some((t) => /^(first|second): A terminal session ended when Studio restarted$/.test(t))), "the toast counts the one session the restart ended, not the finished one", JSON.stringify(toasts));
  await p2.close();
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  try { await browser?.close(); } catch {}
  try { app?.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true }); rmSync(ck, { recursive: true, force: true });
}
console.log(`terminal-reattach-ui: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
