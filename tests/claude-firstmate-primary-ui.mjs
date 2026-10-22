import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Firstmate on Claude in a real browser: the side-by-side host choice, Claude sign-in continuing into a fresh
// Claude Firstmate that greets in the right-side chat, and the chat's own Start on Claude. Offline: stub CLIs only.
//   CLAUDE_PRIMARY_SHOTS=<dir>  also write screenshots there
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
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
// crew: the crew item holds a token; empty: the item exists but is empty; none: no item
writeFileSync(keychain, `#!/bin/sh\nm=$(cat ${kcMode})\nfor a in "$@"; do [ "$a" = crew-studio-claude-token ] && [ "$m" = crew ] && { echo ${CREW}; exit 0; }; [ "$a" = crew-studio-claude-token ] && [ "$m" = empty ] && exit 0; done\nexit 44\n`, { mode: 0o755 });
writeFileSync(join(home, ".claude-login-mode"), "success");
const port = await freePort(), base = `http://127.0.0.1:${port}`, token = "claude-primary-ui-token", shots = process.env.CLAUDE_PRIMARY_SHOTS;
const env = { ...process.env, USER: process.env.USER || "fixture-user", LOGNAME: process.env.LOGNAME || "fixture-user", HOME: home, CODEX_HOME: join(home, ".codex"), CREW_DATA: data,
  CREW_RUNTIME_DIR: join(tmp, "runtime"), CREW_SESSION_TOKEN: token, CREW_PORT: String(port), CREW_GH: "0", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock",
  CREW_CLAUDE_BIN: join(here, "fixture/claude-login.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_KEYCHAIN_TOOL: keychain, CREW_HOST_CODEX_BIN: join(here, "fixture/codex-account.mjs"), STUB_EFFECTIVE_MODE_FILE: join(tmp, "effective-mode") };
for (const k of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "CREW_FM_STATE", "CREW_MAIN_PROJECT", "CREW_CLAUDE_PERMISSION_MODE", "CREW_LOCAL_UNRESTRICTED", "STUB_EFFECTIVE_MODE"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: join(here, ".."), env, stdio: ["ignore", "pipe", "pipe"] }); app.stdout.resume(); app.stderr.resume();
let browser, pass = 0, fail = 0; let releaseBootstrap = () => {}; const errors = [];
const ok = (v, n) => { if (v) { console.log("ok " + n); pass++; } else { console.log("FAIL " + n); fail++; } };
const api = async (path, body) => { const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-crew-session": token }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); };
const seen = async (p, sel, timeout = 8000) => { try { await p.locator(sel).first().waitFor({ timeout }); return true; } catch { return false; } };
const shot = async (p, name) => { if (!shots) return; mkdirSync(shots, { recursive: true }); await p.waitForTimeout(300); await p.screenshot({ path: join(shots, name + ".png") }); };
// a fresh Firstmate's greeting: the stub echoes the first line of its opening message, which since 2cdb845 names the
// captain's dashboard language and asks the Firstmate to greet in it (src/host/main.ts nativeFreshText)
const greeting = (language) => `#chatLog :text("echo: The captain’s current dashboard language is ${language}")`;
try {
  await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, token);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.chatOpen", "0"); } catch {} });
  // Hold genuine bootstrap metadata, not a fabricated response. Locale can be
  // written before this request completes, while the page has no stream yet.
  let metadataReady; const heldMetadata = new Promise(r => metadataReady = r);
  const metadataGate = new Promise(r => releaseBootstrap = r); let firstMetadata = true;
  await ctx.route("**/api/types", async route => {
    if (!firstMetadata) return route.continue(); firstMetadata = false;
    const response = await route.fetch(); metadataReady(); await metadataGate;
    await route.fulfill({ response });
  });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(String(e)));

  // signed out: Claude is shown beside Codex, but cannot start
  await p.goto(base + "/#/firstmate");
  let metadataTimer;
  try { await Promise.race([heldMetadata, new Promise((_, reject) => { metadataTimer = setTimeout(() => reject(Error("Genuine bootstrap metadata request missing")), 10000); })]); }
  finally { clearTimeout(metadataTimer); }
  // live S26: a Board already open when Studio restarts says its language again on the stream's hello, so the restart's
  // greeting (which waits for it when Studio never heard one) uses the Board's language, not driver.json's
  { const bl = join(data, "board-language.json");
    for (let i = 0; i < 100 && !existsSync(bl); i++) await p.waitForTimeout(50);
    ok(existsSync(bl) && await p.evaluate(() => LIVE.es === null), "genuine pending metadata leaves locale recorded before the stream opens");
    releaseBootstrap();
    // A locale POST is not proof that the actual EventSource is open.
    await p.waitForFunction(() => LIVE.es && LIVE.es.readyState === LIVE.es.OPEN);
    rmSync(bl, { force: true });
    await p.evaluate(() => LIVE.es.dispatchEvent(new Event("hello")));
    for (let i = 0; i < 100 && !existsSync(bl); i++) await p.waitForTimeout(50);
    ok(existsSync(bl) && JSON.parse(readFileSync(bl, "utf8")).locale === "en", "an open Board tells Studio its language again on the stream's hello"); }
  // live e8205157: `explicit` is true only after the captain picks a language in the UI. A browser that never picked one (the
  // deploy opens the Board in the captain's default browser) reports its browser default as not chosen
  { const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
    await fresh.addInitScript(() => { try { localStorage.removeItem("crew.lang"); localStorage.setItem("crew.chatOpen", "0"); } catch {} });
    const fp = await fresh.newPage(), said = [];
    fp.on("request", (r) => { if (r.url().endsWith("/api/main/locale") && r.method() === "POST") { try { said.push(JSON.parse(r.postData() || "{}")); } catch {} } });
    await fp.goto(base + "/#/settings"); await seen(fp, '[data-lang-set="en"]');
    for (let i = 0; i < 60 && said.length < 2; i++) await fp.waitForTimeout(50);
    ok(said.length >= 2 && said.every((s) => s.locale === "zh-CN" && s.explicit === false && s.visible === true && /^[a-z0-9]{1,16}$/.test(s.tab)) && new Set(said.map((s) => s.tab)).size === 1,
      "a Board that never had a language picked reports its browser default as not chosen, with its tab id", JSON.stringify(said));
    const n = said.length; await fp.locator('[data-lang-set="en"]').click();
    for (let i = 0; i < 60 && said.length === n; i++) await fp.waitForTimeout(50);
    ok(said.slice(n).some((s) => s.locale === "en" && s.explicit === true), "after the captain picks a language in Settings it is reported as chosen", JSON.stringify(said.slice(n)));
    await fresh.close(); }
  ok(await seen(p, '[data-section="start-firstmate"] [data-section="start-codex"]') && await seen(p, '[data-section="start-firstmate"] [data-section="start-claude"]'), "the Firstmate page offers Codex and Claude together");
  ok(await seen(p, '[data-section="start-claude"][data-claude-account="signed-out"]', 20000) && await p.locator("#startClaudeBtn").isDisabled(), "Claude cannot start before its card shows signed in");
  await p.waitForTimeout(500);
  ok(await p.locator('[data-section="start-claude"] [data-claude-start-why="claudeNotSignedIn"]').count() === 0 && await p.locator('[data-section="start-claude"] [data-claude-status]').count() === 1, "signed out: the card's account line says so once; no second not-signed-in note pointing at another card");
  ok(await p.locator('.tk-account').count() === 0 && await p.locator('[data-section="start-codex"][data-codex-account] [data-codex-connect]').count() === 1 && await p.locator('[data-section="start-claude"][data-claude-account="signed-out"] [data-claude-signin]').count() === 1, "one card per host: each host card carries its account state and sign-in, and no separate account card sits beside it");
  await p.goto(base + "/#/board");
  ok(await seen(p, "[data-firstmate-welcome] [data-section=\"start-claude\"][data-claude-account]") && await p.locator("[data-firstmate-welcome] .tk-account").count() === 0, "the board welcome follows the same rule: one card per host");
  await p.goto(base + "/#/firstmate"); await seen(p, '[data-section="start-claude"]');
  const fold = await p.locator("#startClaudeBtn").boundingBox(), fold2 = await p.locator("#startCodexBtn").boundingBox();
  ok(fold && fold2 && fold.y + fold.height <= 900 && fold2.y + fold2.height <= 900, "both start buttons are above the fold at 1280×900");
  const [bc, bl] = [await p.locator('[data-section="start-codex"]').boundingBox(), await p.locator('[data-section="start-claude"]').boundingBox()];
  ok(bc && bl && Math.abs(bc.y - bl.y) < 2 && bl.x > bc.x + bc.width - 2, "the two choices sit side by side on a wide screen");

  // the card's next step after sign-in, when nothing runs yet (checked without starting: the auto-continue below is the start)
  await api("/api/claude/account/login", {}); for (let i = 0; i < 100 && (await api("/api/claude/account")).state === "pending"; i++) await new Promise((r) => setTimeout(r, 50));
  await p.evaluate(() => window.dispatchEvent(new Event("crew:live")));
  ok(await seen(p, '[data-section="start-claude"][data-claude-ready="true"]') && await p.locator("#startClaudeBtn.primary").count() === 1 && await p.locator("#startCodexBtn.primary").count() === 0, "only Claude is ready: its Start is the primary button");
  ok(await seen(p, '[data-section="start-claude"][data-claude-ready="true"]') && (await p.locator("#startClaudeBtn").innerText()).includes("Start on Claude") && await p.locator("[data-claude-start]").count() === 0, "signed in: the start card reads Start on Claude; the account card repeats no start beside it");
  ok(/Claude permission mode: auto/.test(await p.locator('[data-section="start-claude"] [data-claude-permission-mode]').first().innerText().catch(() => "")), "the Claude start card shows Claude permission mode: auto");
  // where no start card shows (Doctor), the account card carries the next step
  await p.goto(base + "/#/doctor");
  ok(await seen(p, ':text("Claude permission mode: auto")'), "Doctor shows Claude permission mode: auto");
  ok(await seen(p, '[data-claude-account="signed-in"] [data-claude-start]') && (await p.locator("[data-claude-start]").first().innerText()).includes("Start on Claude") && (await api("/api/main")).state === "detached", "on Doctor the signed-in Claude card offers Start on Claude, and starts nothing by itself");
  await p.locator("[data-claude-account] [data-claude-start]").first().scrollIntoViewIfNeeded(); await shot(p, "claude-card-next-step");
  // missing crew token: no Claude start anywhere, the crew-token step instead
  setKeychain("none"); await p.goto(base + "/#/firstmate"); await p.evaluate(() => window.dispatchEvent(new Event("crew:live")));
  ok(await seen(p, '[data-claude-start-why="claudeCrewTokenMissing"]') && /claude setup-token/.test(await p.locator('[data-claude-start-why="claudeCrewTokenMissing"]').first().innerText()) && await p.locator("#startClaudeBtn").isDisabled(), "without a crew token the Claude card shows the crew-token step and cannot start");
  setKeychain("crew");
  rmSync(join(home, ".claude-login-marker"), { force: true }); await p.evaluate(() => window.dispatchEvent(new Event("crew:live"))); await seen(p, '[data-section="start-claude"][data-claude-account="signed-out"]');
  // signing in to Claude here continues into a fresh Claude Firstmate, which greets in the right-side chat
  await p.locator("[data-claude-signin]").first().click();
  const greeted = await seen(p, greeting("English"), 15000);
  ok(greeted, "after Claude sign-in the right-side chat shows the fresh Claude Firstmate's greeting");
  const v = await api("/api/main");
  ok(v.state === "attached" && v.host === "claude" && v.drive?.path === "fresh", "the primary Studio started is Claude, fresh");
  ok(/claude/.test(await p.locator("#chatSub").innerText()), "the chat header names the Claude host");
  await shot(p, "chat-claude-greeting");
  await p.goto(base + "/#/firstmate"); await seen(p, "[data-claude-model]");
  ok(!/auto|default|→/.test(await p.locator("[data-claude-model]").first().innerText()), "the running card shows the permission mode once, in its own row, not again beside the model");
  ok(/Claude permission mode: auto/.test(await p.locator('.tk-drive [data-claude-permission-mode]').first().innerText().catch(() => "")), "the running Firstmate card shows Claude permission mode: auto");
  ok(/Captain auto-mode rules: none/.test(await p.locator('.tk-drive [data-claude-automode]').first().innerText().catch(() => "")), "the running card says whether the captain's auto-mode rules are applied (none here: built-in defaults)");
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
  codexAuth(true); const readyAccount = await api("/api/codex/account/verify", {});
  ok(readyAccount.state === "ready", `fixture: Codex verification is ready before loading the two-host view (state=${readyAccount.state})`);
  // The fixture changed account state outside the UI; load a fresh view instead of racing its cached account state.
  await p.goto(base + "/#/board"); await p.reload(); await p.evaluate(() => openChat(true));
  ok(await seen(p, '#chatLog [data-chat-start-host="codex"]') && await seen(p, '#chatLog [data-chat-start-host="claude"]') && !(await p.locator('#chatLog [data-chat-start-host]').evaluateAll((b) => b.some((x) => x.classList.contains("primary")))), "both ready: the chat offers Codex and Claude as equals");
  await shot(p, "chat-neutral-choice");
  // a Codex Firstmate already runs: the card says so and offers an explicit switch, never a silent replace
  const cs = await api("/api/main/start", { host: "codex", confirm: true });
  ok(cs.ok === true && (await api("/api/main")).host === "codex", "fixture: a Codex Firstmate is running");
  await p.goto(base + "/#/firstmate");
  ok(await seen(p, '[data-claude-next="switch"]') && /running on Codex/.test(await p.locator('[data-claude-next="switch"]').innerText()) && await p.locator("[data-claude-start]").count() === 0, "with Codex running, the Claude card says so and offers only an explicit switch");
  // A live account refresh can replace the card; trial action retries detachment without switching hosts.
  await p.locator('[data-claude-switch]').click({ trial: true }); await shot(p, "claude-card-switch");
  await p.waitForTimeout(500); ok((await api("/api/main")).host === "codex", "nothing replaced Codex silently");
  // the crew token disappears after the page last checked: Switch asks the preflight first and keeps Codex
  setKeychain("none");
  await p.locator("[data-claude-switch]").click();
  await p.waitForTimeout(800);
  const still = await api("/api/main");
  ok(still.state === "attached" && still.host === "codex" && await p.locator("[data-claude-switch-confirm]").count() === 0, "Switch with a missing crew token keeps the Codex Firstmate running");
  ok(await seen(p, '[data-claude-next="switch"] [data-claude-start-why="claudeCrewTokenMissing"]') && await p.locator("[data-claude-switch]").isDisabled(), "the card then shows the crew-token step and disables Switch");
  // an empty crew item passes the presence preflight; the server's switch reads it in full, refuses, and keeps Codex
  setKeychain("empty"); await p.evaluate(() => window.dispatchEvent(new Event("crew:live"))); await seen(p, "[data-claude-switch]:enabled");
  await p.locator("[data-claude-switch]").click(); await seen(p, "[data-claude-switch-confirm]"); await p.locator("[data-claude-switch-confirm]").click();
  await p.waitForTimeout(1200);
  const kept = await api("/api/main");
  ok(kept.state === "attached" && kept.host === "codex", "Switch with an empty crew keychain item keeps the Codex Firstmate running");
  ok(await seen(p, '[data-claude-start-why="claudeCrewTokenMissing"]'), "the card then shows the crew-token step");
  await shot(p, "claude-switch-refused");
  setKeychain("crew"); await p.evaluate(() => window.dispatchEvent(new Event("crew:live"))); await seen(p, "[data-claude-switch]:enabled");
  await p.locator("[data-claude-switch]").click(); await seen(p, "[data-claude-switch-confirm]");
  await p.locator("[data-claude-switch-confirm]").click();
  let switched = false; for (let i = 0; i < 200; i++) { const m = await api("/api/main"); if (m.state === "attached" && m.host === "claude") { switched = true; break; } await new Promise((r) => setTimeout(r, 50)); }
  ok(switched, "the confirmed switch stops Codex and starts a fresh Claude Firstmate");
  ok(await seen(p, greeting("English"), 15000), "after the switch the right-side chat shows the Claude greeting");
  await shot(p, "chat-after-switch");
  await api("/api/main/detach", {});
  // Claude did not enable auto: the card shows the effective mode and says so
  writeFileSync(join(tmp, "effective-mode"), "default");
  const fb = await api("/api/main/start", { host: "claude", confirm: true });
  for (let i = 0; i < 200 && !(await api("/api/main")).drive?.effectivePermissionMode; i++) await new Promise((r) => setTimeout(r, 50));
  await p.goto(base + "/#/firstmate"); await seen(p, ".tk-drive [data-claude-permission-mode]");
  ok(fb.ok && (await p.locator(".tk-drive [data-claude-permission-mode]").first().innerText()).includes("Claude permission mode: default (auto was requested; Claude did not enable it)"), "when Claude falls back, the card shows the effective mode and that auto was requested");
  await shot(p, "claude-mode-fallback");
  await api("/api/main/detach", {}); rmSync(join(tmp, "effective-mode"), { force: true });
  // Traditional Chinese: the Claude card speaks Chinese, including the mode and the auto-mode rules
  { const zc = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" }); await zc.addInitScript(() => { try { localStorage.setItem("crew.lang", "zh-TW"); localStorage.setItem("crew.theme", "dark"); localStorage.setItem("crew.chatOpen", "0"); } catch {} });
    codexAuth(false); await api("/api/codex/account/verify", {}).catch(() => null);
    const z = await zc.newPage(); z.on("pageerror", (e) => errors.push(String(e)));
    await z.goto(base + "/#/firstmate"); await seen(z, '[data-section="start-claude"][data-claude-ready="true"] [data-claude-permission-mode]');
    const card = await z.locator('[data-section="start-claude"]').innerText().catch(() => "");
    ok(card.includes("Claude 權限模式：auto") && card.includes("船長的 auto mode 規則") && !/Claude permission mode|Captain auto-mode rules|built-in defaults/.test(card), "zh-TW: the Claude start card shows the mode and the auto-mode rules in Chinese");
    await z.locator("#startClaudeBtn").click(); await seen(z, greeting("Traditional Chinese"), 15000);
    await z.goto(base + "/#/firstmate"); await seen(z, ".tk-drive [data-claude-permission-mode]");
    const run = await z.locator(".tk-drive").first().innerText().catch(() => "");
    ok(run.includes("Claude 權限模式：auto") && !/Claude permission mode|Captain auto-mode rules/.test(run), "zh-TW: the running card shows the effective mode in Chinese");
    if (shots) { mkdirSync(shots, { recursive: true }); await z.evaluate(() => { try { openChat(false); } catch {} }); await z.waitForTimeout(300); await z.locator(".tk-drive").first().screenshot({ path: join(shots, "review-running-390-dark-zh-TW.png") }); }
    await api("/api/main/detach", {}); await zc.close(); }
  if (shots) { // the review set: the choice, the Claude card, the chat greeting; 1280 light English and 390 dark Traditional Chinese
    codexAuth(false); await api("/api/codex/account/verify", {}).catch(() => null);
    for (const o of [{ w: 1280, h: 900, theme: "light", lang: "en" }, { w: 390, h: 844, theme: "dark", lang: "zh-TW" }]) {
      const c = await browser.newContext({ viewport: { width: o.w, height: o.h }, colorScheme: o.theme, deviceScaleFactor: 2 });
      await c.addInitScript(([lang, theme]) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.theme", theme); localStorage.setItem("crew.chatOpen", "0"); } catch {} }, [o.lang, o.theme]);
      const m = await c.newPage(); m.on("pageerror", (e) => errors.push(String(e))); const tag = `${o.w}-${o.theme}-${o.lang}`;
      await m.goto(base + "/#/firstmate"); await seen(m, '[data-section="start-claude"][data-claude-ready="true"]'); await shot(m, `review-choice-${tag}`);
      await m.goto(base + "/#/doctor"); await seen(m, "[data-claude-account] [data-claude-start]"); await m.locator("[data-claude-account]").first().scrollIntoViewIfNeeded(); await shot(m, `review-card-${tag}`);
      await m.goto(base + "/#/firstmate"); await seen(m, "#startClaudeBtn:enabled"); await m.locator("#startClaudeBtn").click();
      await seen(m, greeting(o.lang === "zh-TW" ? "Traditional Chinese" : "English"), 15000); await shot(m, `review-chat-${tag}`);
      await api("/api/main/detach", {}); await c.close();
    }
  }
  ok(!errors.length, "no page errors: " + errors.join(" | "));
} finally { releaseBootstrap(); await browser?.close(); if (app.exitCode === null && app.signalCode === null) { const done = new Promise((r) => app.once("exit", r)); app.kill("SIGTERM"); await done; } rmSync(tmp, { recursive: true, force: true }); }
console.log(`claude-firstmate-primary-ui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
