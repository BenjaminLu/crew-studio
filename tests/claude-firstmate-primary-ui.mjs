// Firstmate on Claude in a real browser: the side-by-side host choice, Claude sign-in continuing into a fresh
// Claude Firstmate that greets in the right-side chat, and the chat's own Start on Claude. Offline: stub CLIs only.
//   CLAUDE_PRIMARY_SHOTS=<dir>  also write screenshots there
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), tmp = mkdtempSync(join(tmpdir(), "crew-claude-primary-ui-")), home = join(tmp, "home"), data = join(tmp, "data"), kc = join(tmp, "kc");
for (const d of [home, data, kc, join(home, ".codex")]) mkdirSync(d, { recursive: true });
writeFileSync(join(home, ".codex", "config.toml"), 'model="fixture-model"\nmodel_reasoning_effort="low"\n');
const codexAuth = (yes) => writeFileSync(join(home, ".codex", ".fixture-account.json"), JSON.stringify({ authenticated: yes }));
codexAuth(false);
const CREW = "sk-ant-" + "oat01-" + "u".repeat(64); // fixture shape only
const keychain = join(kc, "security");
const kcMode = join(kc, "mode"), setKeychain = (m) => writeFileSync(kcMode, m); setKeychain("crew");
writeFileSync(keychain, `#!/bin/sh\n[ "$(cat ${kcMode})" = crew ] || exit 44\nfor a in "$@"; do [ "$a" = crew-studio-claude-token ] && { echo ${CREW}; exit 0; }; done\nexit 44\n`, { mode: 0o755 });
writeFileSync(join(home, ".claude-login-mode"), "success");
const port = await freePort(), base = `http://127.0.0.1:${port}`, token = "claude-primary-ui-token", shots = process.env.CLAUDE_PRIMARY_SHOTS;
const env = { ...process.env, USER: process.env.USER || "fixture-user", LOGNAME: process.env.LOGNAME || "fixture-user", HOME: home, CODEX_HOME: join(home, ".codex"), CREW_DATA: data,
  CREW_RUNTIME_DIR: join(tmp, "runtime"), CREW_SESSION_TOKEN: token, CREW_PORT: String(port), CREW_GH: "0", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock",
  CREW_CLAUDE_BIN: join(here, "fixture/claude-login.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_KEYCHAIN_TOOL: keychain, CREW_HOST_CODEX_BIN: join(here, "fixture/codex-account.mjs") };
for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "CREW_FM_STATE", "CREW_MAIN_PROJECT"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: join(here, ".."), env, stdio: ["ignore", "pipe", "pipe"] }); app.stdout.resume(); app.stderr.resume();
let browser, pass = 0, fail = 0; const errors = [];
const ok = (v, n) => { if (v) { console.log("ok " + n); pass++; } else { console.log("FAIL " + n); fail++; } };
const api = async (path, body) => { const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-crew-session": token }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); };
const seen = async (p, sel, timeout = 8000) => { try { await p.locator(sel).first().waitFor({ timeout }); return true; } catch { return false; } };
const shot = async (p, name) => { if (!shots) return; mkdirSync(shots, { recursive: true }); await p.waitForTimeout(300); await p.screenshot({ path: join(shots, name + ".png") }); };
try {
  await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, token);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.chatOpen", "0"); } catch {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(String(e)));

  // signed out: Claude is shown beside Codex, but cannot start
  await p.goto(base + "/#/firstmate");
  ok(await seen(p, '[data-section="start-firstmate"] [data-section="start-codex"]') && await seen(p, '[data-section="start-firstmate"] [data-section="start-claude"]'), "the Firstmate page offers Codex and Claude together");
  ok(await seen(p, '[data-claude-start-why="claudeNotSignedIn"]', 20000) && await p.locator("#startClaudeBtn").isDisabled(), "Claude cannot start before the Claude account card shows signed in");
  const fold = await p.locator("#startClaudeBtn").boundingBox(), fold2 = await p.locator("#startCodexBtn").boundingBox();
  ok(fold && fold2 && fold.y + fold.height <= 900 && fold2.y + fold2.height <= 900, "both start buttons are above the fold at 1280×900");
  const [bc, bl] = [await p.locator('[data-section="start-codex"]').boundingBox(), await p.locator('[data-section="start-claude"]').boundingBox()];
  ok(bc && bl && Math.abs(bc.y - bl.y) < 2 && bl.x > bc.x + bc.width - 2, "the two choices sit side by side on a wide screen");

  // the card's next step after sign-in, when nothing runs yet (checked without starting: the auto-continue below is the start)
  await api("/api/claude/account/login", {}); for (let i = 0; i < 100 && (await api("/api/claude/account")).state === "pending"; i++) await new Promise((r) => setTimeout(r, 50));
  await p.evaluate(() => window.dispatchEvent(new Event("crew:live")));
  ok(await seen(p, '[data-section="start-claude"][data-claude-ready="true"]') && (await p.locator("#startClaudeBtn").innerText()).includes("Start on Claude") && await p.locator("[data-claude-start]").count() === 0, "signed in: the start card reads Start on Claude; the account card repeats no start beside it");
  // where no start card shows (Doctor), the account card carries the next step
  await p.goto(base + "/#/doctor");
  ok(await seen(p, '[data-claude-account="signed-in"] [data-claude-start]') && (await p.locator("[data-claude-start]").first().innerText()).includes("Start on Claude") && (await api("/api/main")).state === "detached", "on Doctor the signed-in Claude card offers Start on Claude, and starts nothing by itself");
  await p.locator("[data-claude-account] [data-claude-start]").first().scrollIntoViewIfNeeded(); await shot(p, "claude-card-next-step");
  // missing crew token: no Claude start anywhere, the crew-token step instead
  setKeychain("none"); await p.goto(base + "/#/firstmate"); await p.evaluate(() => window.dispatchEvent(new Event("crew:live")));
  ok(await seen(p, '[data-claude-start-why="claudeCrewTokenMissing"]') && /claude setup-token/.test(await p.locator('[data-claude-start-why="claudeCrewTokenMissing"]').first().innerText()) && await p.locator("#startClaudeBtn").isDisabled(), "without a crew token the Claude card shows the crew-token step and cannot start");
  setKeychain("crew");
  rmSync(join(home, ".claude-login-marker"), { force: true }); await p.evaluate(() => window.dispatchEvent(new Event("crew:live"))); await seen(p, '[data-claude-start-why="claudeNotSignedIn"]');
  // signing in to Claude here continues into a fresh Claude Firstmate, which greets in the right-side chat
  await p.locator("[data-claude-signin]").first().click();
  const greeted = await seen(p, '#chatLog :text("echo: Coffee onboarding")', 15000);
  ok(greeted, "after Claude sign-in the right-side chat shows the fresh Claude Firstmate's greeting");
  const v = await api("/api/main");
  ok(v.state === "attached" && v.host === "claude" && v.drive?.path === "fresh", "the primary Studio started is Claude, fresh");
  ok(/claude/.test(await p.locator("#chatSub").innerText()), "the chat header names the Claude host");
  await shot(p, "chat-claude-greeting");
  await p.goto(base + "/#/firstmate"); await seen(p, "[data-claude-model]");
  await shot(p, "firstmate-claude-running");

  // after Stop, the chat itself offers Start on Claude (Codex is not signed in, so it offers no Codex)
  await api("/api/main/detach", {});
  await p.goto(base + "/#/board"); await p.evaluate(() => openChat(true));
  ok(await seen(p, '#chatLog [data-chat-start-host="claude"]') && await p.locator('#chatLog [data-chat-start-host="codex"]').count() === 0, "the detached chat offers Start on Claude, and no Codex start while Codex is not ready");
  await shot(p, "chat-start-choice");
  await p.locator('#chatLog [data-chat-start-host="claude"]').click();
  ok(await seen(p, '#chatLog [data-banner="attached"]', 15000) && (await api("/api/main")).host === "claude", "Start on Claude from the chat starts a Claude Firstmate");
  await api("/api/main/detach", {});
  await p.waitForTimeout(500);
  ok(!/Turn failed/.test(await p.locator("#chatLog").innerText()), "Stop is not reported as a failed turn");
  await p.goto(base + "/#/firstmate"); await seen(p, '[data-section="start-claude"][data-claude-ready="true"]');
  await shot(p, "firstmate-choice-signed-in");
  // both hosts ready: the chat offers a neutral choice, no default host
  codexAuth(true); await api("/api/codex/account/verify", {});
  await p.goto(base + "/#/board"); await p.evaluate(() => openChat(true));
  ok(await seen(p, '#chatLog [data-chat-start-host="codex"]') && await seen(p, '#chatLog [data-chat-start-host="claude"]') && !(await p.locator('#chatLog [data-chat-start-host]').evaluateAll((b) => b.some((x) => x.classList.contains("primary")))), "both ready: the chat offers Codex and Claude as equals");
  await shot(p, "chat-neutral-choice");
  // a Codex Firstmate already runs: the card says so and offers an explicit switch, never a silent replace
  const cs = await api("/api/main/start", { host: "codex", confirm: true });
  ok(cs.ok === true && (await api("/api/main")).host === "codex", "fixture: a Codex Firstmate is running");
  await p.goto(base + "/#/firstmate");
  ok(await seen(p, '[data-claude-next="switch"]') && /running on Codex/.test(await p.locator('[data-claude-next="switch"]').innerText()) && await p.locator("[data-claude-start]").count() === 0, "with Codex running, the Claude card says so and offers only an explicit switch");
  await p.locator('[data-claude-next="switch"]').scrollIntoViewIfNeeded(); await shot(p, "claude-card-switch");
  await p.waitForTimeout(500); ok((await api("/api/main")).host === "codex", "nothing replaced Codex silently");
  // the crew token disappears after the page last checked: Switch asks the preflight first and keeps Codex
  setKeychain("none");
  await p.locator("[data-claude-switch]").click();
  await p.waitForTimeout(800);
  const still = await api("/api/main");
  ok(still.state === "attached" && still.host === "codex" && await p.locator("[data-claude-switch-confirm]").count() === 0, "Switch with a missing crew token keeps the Codex Firstmate running");
  ok(await seen(p, '[data-claude-next="switch"] [data-claude-start-why="claudeCrewTokenMissing"]') && await p.locator("[data-claude-switch]").isDisabled(), "the card then shows the crew-token step and disables Switch");
  setKeychain("crew"); await p.evaluate(() => window.dispatchEvent(new Event("crew:live"))); await seen(p, "[data-claude-switch]:enabled");
  await p.locator("[data-claude-switch]").click(); await seen(p, "[data-claude-switch-confirm]");
  await p.locator("[data-claude-switch-confirm]").click();
  let switched = false; for (let i = 0; i < 200; i++) { const m = await api("/api/main"); if (m.state === "attached" && m.host === "claude") { switched = true; break; } await new Promise((r) => setTimeout(r, 50)); }
  ok(switched, "the confirmed switch stops Codex and starts a fresh Claude Firstmate");
  ok(await seen(p, '#chatLog :text("echo: Coffee onboarding")', 15000), "after the switch the right-side chat shows the Claude greeting");
  await shot(p, "chat-after-switch");
  await api("/api/main/detach", {});
  if (shots) { // the review set: the choice, the Claude card, the chat greeting; 1280 light English and 390 dark Traditional Chinese
    codexAuth(false); await api("/api/codex/account/verify", {}).catch(() => null);
    for (const o of [{ w: 1280, h: 900, theme: "light", lang: "en" }, { w: 390, h: 844, theme: "dark", lang: "zh-TW" }]) {
      const c = await browser.newContext({ viewport: { width: o.w, height: o.h }, colorScheme: o.theme, deviceScaleFactor: 2 });
      await c.addInitScript(([lang, theme]) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.theme", theme); localStorage.setItem("crew.chatOpen", "0"); } catch {} }, [o.lang, o.theme]);
      const m = await c.newPage(); m.on("pageerror", (e) => errors.push(String(e))); const tag = `${o.w}-${o.theme}-${o.lang}`;
      await m.goto(base + "/#/firstmate"); await seen(m, '[data-section="start-claude"][data-claude-ready="true"]'); await shot(m, `review-choice-${tag}`);
      await m.goto(base + "/#/doctor"); await seen(m, "[data-claude-account] [data-claude-start]"); await m.locator("[data-claude-account]").first().scrollIntoViewIfNeeded(); await shot(m, `review-card-${tag}`);
      await m.goto(base + "/#/firstmate"); await seen(m, "#startClaudeBtn:enabled"); await m.locator("#startClaudeBtn").click();
      await seen(m, '#chatLog :text("echo: Coffee onboarding")', 15000); await shot(m, `review-chat-${tag}`);
      await api("/api/main/detach", {}); await c.close();
    }
  }
  ok(!errors.length, "no page errors: " + errors.join(" | "));
} finally { await browser?.close(); if (app.exitCode === null && app.signalCode === null) { const done = new Promise((r) => app.once("exit", r)); app.kill("SIGTERM"); await done; } rmSync(tmp, { recursive: true, force: true }); }
console.log(`claude-firstmate-primary-ui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
