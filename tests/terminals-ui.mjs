import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Web terminals in a real browser (public/terminals.js, docs/units/web-terminal.md), stub CLIs only:
//   the desktop page: the unsandboxed warning with the project's path, presets, a custom command started in xterm.js,
//   "waiting for you" in the terminal's badge, the sidebar's Terminals item and the Firstmate panel's Terminals tab,
//   typing answers it; Claude Code's Remote Control link and its QR code in the header;
//   a paired phone: the same list and states, the output drawn read only (no input element, no launcher, no controls,
//   no link), at 390 px without a horizontal scroll; and with an xterm stub, the page asks xterm for no input on a phone.
//   The vendored xterm.js files equal the pinned packages.
//   TERMINALS_UI_SHOTS=<dir>  also write screenshots there
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { checkedTempDir } from "./lib/git-hygiene.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-terminals-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data"), bin = join(tmp, "bin");
for (const d of [home, proj, state, data, bin, join(home, ".codex")]) mkdirSync(d, { recursive: true });
let pass = 0, fail = 0, browser, app; const errors = [], shots = process.env.TERMINALS_UI_SHOTS;
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const seen = async (loc, timeout = 8000) => { try { await loc.first().waitFor({ timeout }); return true; } catch { return false; } };
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };

// the vendored copies are the pinned packages, byte for byte
{
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies;
  ok(pkg["@xterm/xterm"] === "5.5.0" && pkg["@xterm/addon-fit"] === "0.10.0", "xterm.js and its fit addon are pinned exactly");
  const same = (a, b) => readFileSync(join(root, a)).equals(readFileSync(join(root, b)));
  ok(same("public/vendor/xterm-5.5.0.min.js", "node_modules/@xterm/xterm/lib/xterm.js") && same("public/vendor/xterm-5.5.0.css", "node_modules/@xterm/xterm/css/xterm.css")
    && same("public/vendor/xterm-addon-fit-0.10.0.min.js", "node_modules/@xterm/addon-fit/lib/addon-fit.js"), "public/vendor holds the packages' own files (bun scripts/vendor-xterm.ts)");
  ok(/xterm\.js 5\.5\.0/.test(readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8")) && /MIT/.test(readFileSync(join(root, "public/vendor/xterm-LICENSE.txt"), "utf8")), "THIRD_PARTY_NOTICES.md and the license file name it");
}

// a project that is a git repository, for Send for review (the repository lives in a checked temp folder)
const ck = checkedTempDir("crew-terminals-ui-repo-"), repoDir = join(ck, "repo"); mkdirSync(repoDir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main", repoDir]);
writeFileSync(join(repoDir, "README.md"), "fixture\n");
execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "add", "README.md"], { cwd: repoDir });
execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "init"], { cwd: repoDir });
writeFileSync(join(data, "projects.json"), JSON.stringify([{ id: "demo", name: "Demo", path: proj, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true },
  { id: "repo", name: "Repo", path: repoDir, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true }]));
// a terminal that ended before Studio (re)started: its record alone, as a redeploy leaves it
const seededHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
mkdirSync(join(data, "terminals"), { recursive: true, mode: 0o700 });
writeFileSync(join(data, "terminals", "T-seeded-before1.json"), JSON.stringify({ id: "T-seeded-before1", project: { id: "repo", name: "Repo", path: repoDir, base: "main" }, preset: null, kind: "custom", label: "seeded",
  command: "echo seeded", by: "desktop", startedAt: "2026-10-20T10:00:00.000Z", endedAt: "2026-10-20T10:01:00.000Z", exitCode: 0, signal: null, cols: 100, rows: 30,
  git: { start: { branch: "main", head: seededHead, commits: 0, base: "main" }, end: { branch: "agent/seeded", head: seededHead, commits: 1, base: "main" } }, review: null, transcript: null, transcriptBytes: 0, transcriptTruncated: false, remoteControl: null, sandboxed: false, evidence: false }));
writeFileSync(join(bin, "claude"), `#!/bin/sh
if [ "$1" = "--help" ]; then echo "  --remote-control [name]   Start an interactive session with Remote Control enabled"; exit 0; fi
for a in "$@"; do [ "$a" = "--remote-control" ] && printf 'Remote Control active: https://claude.ai/code/rc-UIFAKE789\\r\\n'; done
while :; do printf '\\r\\n> '; IFS= read -r line || exit 0; printf 'you said %s\\r\\n' "$line"; done
`); chmodSync(join(bin, "claude"), 0o755);
const BUN = process.versions.bun ? process.execPath : execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
const TOKEN = "terminals-ui-session", TAILNET = "studio.tail-termui.ts.net";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
const post = (port, path, body, headers = {}) => new Promise((resolve) => { const d = JSON.stringify(body ?? {});
  const r = httpRequest({ host: "127.0.0.1", port, method: "POST", path, agent: false, headers: { host: `127.0.0.1:${port}`, "x-crew-session": TOKEN, "content-type": "application/json", "content-length": Buffer.byteLength(d), ...headers } }, (res) => {
    const parts = []; res.on("data", (c) => parts.push(c)); res.on("end", () => { let j = null; try { j = JSON.parse(Buffer.concat(parts).toString()); } catch {} resolve(j); }); });
  r.on("error", () => resolve(null)); r.write(d); r.end(); });
try {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  app = spawn(BUN, ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), PATH: `${bin}:${dirname(BUN)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: "/bin/sh",
    CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data, CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub",
    CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_TAILNET_NAME: TAILNET, CREW_TERMINAL_IDLE_MS: "400",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: join(home, ".claude/projects") } });
  app.stdout.resume(); await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP ${TAILNET} 127.0.0.1`] }), base, TOKEN);
  const init = (lang) => ({ lang });
  const prep = async (ctx, lang = "en") => ctx.addInitScript(({ lang }) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, init(lang));

  // ---------- the desktop page ----------
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await prep(ctx);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`desktop: ${e}`));
  await p.goto(base + "/#/terminals");
  ok(await seen(p.locator("[data-term-warning]")), "the Terminals page opens on the desktop");
  ok((await p.locator("[data-term-warning]").innerText()).includes(`full permissions in ${proj}`) && /Not sandboxed/.test(await p.locator("[data-term-warning]").innerText()), "it says, before anything starts: not sandboxed, full permissions, in the project's path");
  ok(await p.locator('[data-preset="claude"]').count() === 1 && await p.locator('[data-preset="shell"]').count() === 1 && await p.locator('[data-preset="aider"]').count() === 0, "presets: the CLIs on PATH and the shell");
  ok(await p.locator("#termRc").isChecked(), "Claude Code's Remote Control toggle is on by default");
  // a terminal that ended before Studio started is listed from its record, marked, and can still be sent for review
  await p.goto(base + "/#/terminals/T-seeded-before1");
  ok(await seen(p.locator('[data-term-row-restored="T-seeded-before1"]')) && await seen(p.locator('[data-term-restored="ended"]')), "a terminal from before the restart is listed and marked as such");
  ok(await seen(p.locator('[data-term-send="T-seeded-before1"]:not([disabled])')) && await p.locator('[data-term-restart="T-seeded-before1"]').count() === 0
    && /agent\/seeded · 1 commit\(s\) beyond main/.test(await p.locator('[data-term-review="T-seeded-before1"]').innerText()), "it keeps its git end and Send for review; no Restart in place");
  await p.goto(base + "/#/terminals");
  await p.locator("#termCmd").fill("printf 'Proceed with deploy? [y/N] '; read a; echo answer:$a; sleep 1");
  await p.locator("[data-term-run]").click();
  ok(await until(async () => /#\/terminals\/T-(?!seeded)/.test(p.url())), "Run opens the new terminal", p.url());
  const firstId = decodeURIComponent(p.url().split("/terminals/")[1] || "");
  ok(await seen(p.locator(".wt-xterm .xterm-rows"), 10000), "xterm.js draws it");
  ok(await until(async () => (await p.locator(".wt-xterm .xterm-rows").innerText()).includes("Proceed with deploy?")), "the program's output is on screen");
  ok(await seen(p.locator('.wt-detail [data-term-state="waiting"]'), 6000), "the badge says waiting for you");
  ok(await seen(p.locator("[data-term-ask]")) && (await p.locator("[data-term-ask]").innerText()).includes("Proceed with deploy? [y/N]"), "with the question it asks");
  ok(await until(async () => (await p.locator('.nav-item[data-view="terminals"] #navTerms').innerText().catch(() => "")) === "1"), "the sidebar's Terminals item counts one terminal waiting");
  // the terminal page is a focus page (no chat panel there): the panel's Terminals tab lists it from any other page
  await p.goto(base + "/#/board"); await p.locator('[data-chat-tab="terms"]').click();
  ok(await seen(p.locator('#chatTerms [data-term-row] [data-term-state="waiting"]')) && await p.locator("#chatLog").isHidden(), "the Firstmate panel's Terminals tab lists it, waiting (the chat stays one tab away)");
  if (shots) await p.screenshot({ path: join(shots, "terminals-desktop-waiting.png") });
  await p.locator('[data-chat-tab="chat"]').click();
  ok(await p.locator("#chatLog").isVisible(), "the Chat tab brings the chat back");
  await p.goto(`${base}/#/terminals/${encodeURIComponent(firstId)}`); await seen(p.locator(".wt-xterm .xterm-rows"), 10000);
  await p.locator(".wt-xterm").click(); await p.keyboard.type("y"); await p.keyboard.press("Enter");
  ok(await until(async () => (await p.locator(".wt-xterm .xterm-rows").innerText()).includes("answer:y")), "typing in the terminal reaches the program");
  ok(await seen(p.locator('.wt-detail [data-term-state="done"]'), 8000), "exit 0: done");
  ok(await until(async () => (await p.locator("#navTerms").isHidden())), "nothing waits any more: the count goes");

  // Claude Code with Remote Control: the link and its QR code in the header (with a terminal shown, New opens the launcher)
  await p.locator("[data-term-new]").click();
  await p.locator('[data-preset="claude"]').click();
  ok(await seen(p.locator("[data-term-remote-url]"), 10000), "Claude Code's Remote Control link shows in the terminal's header");
  ok((await p.locator("[data-term-remote-url]").innerText()) === "https://claude.ai/code/rc-UIFAKE789" && await p.locator(".wt-qr svg").count() === 1, "with the link and a QR code drawn on the page");
  const claudeId = decodeURIComponent(p.url().split("/terminals/")[1] || "");
  if (shots) await p.screenshot({ path: join(shots, "terminals-desktop-remote.png") });

  // ---------- Send for review: a finished terminal whose branch has commits ----------
  await p.locator("[data-term-new]").click();
  await p.locator("#termProject").selectOption("repo");
  const G = "git -c user.name=A -c user.email=a@example.invalid";
  // run from the command field with Enter, as the captain does, and keep a field focused while the command ends by itself
  // (live bug: the review row came only after a reload, because the page is not rebuilt while a field has the focus)
  await p.locator("#termCmd").fill(`${G} checkout -q -b agent/ui && echo x > f.txt && ${G} add f.txt && ${G} commit -q -m 'feat: f' && echo COMMITTED && sleep 3`);
  await p.locator("#termCmd").press("Enter");
  ok(await until(async () => (await p.locator(".wt-xterm .xterm-rows").innerText().catch(() => "")).includes("COMMITTED"), 10000), "an agent commits on a branch in the project's folder", await p.locator(".wt-xterm .xterm-rows").innerText().catch(() => ""));
  ok(await seen(p.locator("[data-term-send][disabled]")) && /once the agent has finished/.test(await p.locator("[data-term-review]").innerText()), "Send for review waits until the agent has finished");
  // the captain clicks back into the command field (to type the next one) while this one is still running
  await p.locator("[data-term-new]").click();
  await p.locator("#termCmd").focus();
  ok(await p.evaluate(() => document.activeElement?.id) === "termCmd", "the command field has the focus while the command runs");
  ok(await seen(p.locator("[data-term-send]:not([disabled])"), 10000) && /agent\/ui · 1 commit\(s\) beyond main/.test(await p.locator("[data-term-review]").innerText()), "when it ends, Send for review appears with the branch, with no reload", await p.locator("[data-term-review]").innerText().catch(() => ""));
  await p.locator("[data-term-send]").click();
  // this Studio has no approved crew for code-firstmate: the refusal stays in the review row (not only a passing toast)
  const refusedText = (await seen(p.locator("[data-term-review-error]"), 8000)) ? await p.locator("[data-term-review-error]").innerText() : "";
  const toastText = (await p.locator(".toast").allInnerTexts().catch(() => [])).find((x) => !/waiting for you/.test(x)) ?? "";
  ok(/^Send for review was refused: \S/.test(refusedText) && toastText.length > 10 && refusedText.includes(toastText.split(" / ")[0].slice(0, 30)), "a refused Send for review says why, in the review row (the server's reason, in English here)", `${refusedText} | ${toastText}`);
  await new Promise((r) => setTimeout(r, 4000));
  ok(await p.locator("[data-term-review-error]").isVisible() && await p.locator("[data-term-send]:not([disabled])").count() === 1, "the reason stays after the toast is gone, and Send for review stays available");
  if (shots) await p.screenshot({ path: join(shots, "terminals-send-review.png") });

  // ---------- a paired phone ----------
  const code = (await post(port, "/api/remote/pair/start", {}))?.code;
  const ptok = (await post(port, "/api/remote/pair", { code, name: "Pixel" }, { host: TAILNET, "x-crew-session": "" }))?.token;
  ok(typeof ptok === "string", "a phone pairs");
  const phoneBase = `http://${TAILNET}:${port}`;
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pctx.addInitScript((t) => { try { localStorage.setItem("crew.remoteToken", t); localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, ptok);
  const q = await pctx.newPage(); q.on("pageerror", (e) => errors.push(`phone: ${e}`));
  await q.goto(`${phoneBase}/#/terminals/${encodeURIComponent(claudeId)}`);
  ok(await seen(q.locator("[data-term-readonly]"), 10000), "the phone gets the page, view only");
  ok(await seen(q.locator(".wt-xterm .xterm-rows"), 10000) && await until(async () => (await q.locator(".wt-xterm .xterm-rows").innerText()).includes("not shown on a phone")), "with Remote Control on, the phone says why it shows no output");
  ok(await q.locator(".wt-xterm textarea, .wt-xterm input, .wt-xterm [contenteditable]").count() === 0, "the phone's terminal has no input element (no keyboard)");
  ok(await q.locator("[data-term-run], [data-preset], #termCmd, [data-term-kill], [data-term-restart], [data-term-dismiss]").count() === 0, "no launcher and no Stop or Restart on the phone");
  ok(await q.locator("[data-term-remote]").count() === 0 && !(await q.content()).includes("UIFAKE789"), "the phone never gets the Remote Control link", "");
  ok(await seen(q.locator('.wt-detail [data-term-state="waiting"]'), 6000), "and sees the same state as the Mac (waiting at Claude's prompt)");
  ok(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal scroll at 390 px");
  const q2 = await pctx.newPage(); q2.on("pageerror", (e) => errors.push(`phone2: ${e}`));
  await q2.goto(`${phoneBase}/#/terminals/${encodeURIComponent(firstId)}`);
  ok(await until(async () => (await q2.locator(".wt-xterm .xterm-rows").innerText().catch(() => "")).includes("answer:y"), 10000), "a terminal without Remote Control: the phone draws its output"); await q2.close();
  await q.locator(".wt-xterm").tap().catch(() => {}); await q.keyboard.type("hijack\n").catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  ok(!(await p.locator(".wt-xterm .xterm-rows").innerText()).includes("hijack"), "tapping and typing on the phone sends nothing");
  if (shots) await q.screenshot({ path: join(shots, "terminals-phone.png") });

  // an xterm stub: what the page asks of xterm on a phone
  const sctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await sctx.addInitScript((t) => { try { localStorage.setItem("crew.remoteToken", t); localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, ptok);
  await sctx.route("**/vendor/xterm-5.5.0.min.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.__xt={opts:null,writes:[],onData:0};window.Terminal=class{constructor(o){__xt.opts=o;this.cols=80;this.rows=24}loadAddon(){}open(el){el.append(document.createElement('textarea'));const d=document.createElement('div');d.className='xterm-rows';el.append(d);this.d=d}write(x){const s=typeof x==='string'?x:new TextDecoder().decode(x);__xt.writes.push(s);this.d.textContent+=s}reset(){this.d.textContent=''}onData(){__xt.onData++}onResize(){}focus(){}dispose(){}};` }));
  await sctx.route("**/vendor/xterm-addon-fit-0.10.0.min.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.FitAddon={FitAddon:class{fit(){}}};" }));
  const sp = await sctx.newPage(); sp.on("pageerror", (e) => errors.push(`stub: ${e}`));
  await sp.goto(`${phoneBase}/#/terminals/${encodeURIComponent(claudeId)}`);
  const xt = await until(async () => { const v = await sp.evaluate(() => window.__xt); return v?.writes?.length && v; });
  ok(xt?.opts?.disableStdin === true && xt.onData === 0, "on a phone the page creates xterm with stdin disabled and listens to no keys", JSON.stringify(xt?.opts));
  ok(xt && !xt.writes.join("").includes("UIFAKE789") && !xt.writes.join("").includes("Remote Control active"), "with Remote Control on, xterm on the phone never receives the output");
  ok(await sp.locator(".wt-xterm textarea").count() === 0, "the input element xterm made is removed");
  await post(port, `/api/terminals/${claudeId}/kill`, {}, { cookie: "", "x-crew-session": TOKEN }).catch(() => {});
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  try { await browser?.close(); } catch {}
  try { app?.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true });
}
console.log(`terminals-ui: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
