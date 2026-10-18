import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Live S25: after a deploy an already-open Board tab kept the old page JS (R-069 still showed its old status until a manual
// reload). Two "versions" of Studio on one port and data dir (CREW_PAGE_RELEASE names each): an open tab whose stream
// reconnects to a newer release reloads itself when that loses nothing; with unsent text in a field it keeps the text and
// shows a small "Studio was updated · Reload" bar instead. Offline: stub providers only.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-page-release-ui-"));
const home = join(tmp, "home"), data = join(tmp, "data"), state = join(tmp, "state"), proj = join(tmp, "proj");
for (const d of [home, data, state, proj, join(home, ".codex")]) mkdirSync(d, { recursive: true });
const TOKEN = "page-release-ui";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CREW_PAGE_RELEASE"]) delete env[k];
let pass = 0, fail = 0, browser, app; const errors = [];
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const start = async (release) => {
  app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data,
    CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_LOCAL_UNRESTRICTED: "0",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_PAGE_RELEASE: release } });
  app.stdout.resume(); app.stderr.resume(); await waitUp(base, app);
};
const stop = async () => { if (app && app.exitCode === null && app.signalCode === null) { const done = new Promise((r) => app.once("exit", r)); app.kill("SIGTERM"); await done; } };
const until = async (f, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await f()) return true; } catch {} await new Promise((r) => setTimeout(r, 100)); } return false; };
try {
  await start("v1");
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  let n = 1;
  for (const [width, lang] of [[1440, "en"], [390, "zh-TW"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
    await ctx.addInitScript((lang) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, lang);
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e}`));
    const tag = `${width}-${lang}`, mine = () => p.evaluate(() => document.querySelector('meta[name="crew-release"]')?.content);
    await p.goto(base + "/#/board");
    await until(async () => (await p.locator("#conn.ok").count()) === 1);
    const was = `v${n}`;
    ok(await mine() === was, `${tag}: the page names the release it was served as`, String(await mine()));
    // a deploy with nothing unsent: the open tab reloads itself onto the new page
    await p.evaluate(() => { window.__oldPage = true; });
    await stop(); n++; await start(`v${n}`);
    ok(await until(async () => await mine() === `v${n}` && !(await p.evaluate(() => window.__oldPage === true))), `${tag}: after a deploy the open tab reloads itself onto the new release`);
    ok(await p.locator("#releaseBar").count() === 0, `${tag}: no bar when it could reload by itself`);
    // a deploy while the captain has typed something: nothing is lost, a small bar offers the reload
    await until(async () => (await p.locator("#conn.ok").count()) === 1);
    if (width < 500 && await p.locator("#chatFab").isVisible().catch(() => false)) await p.locator("#chatFab").click();
    await p.locator("#chatIn").fill("half-written message");
    await p.evaluate(() => { window.__oldPage = true; });
    await stop(); n++; await start(`v${n}`);
    ok(await until(async () => (await p.locator("#releaseBar").count()) === 1), `${tag}: with unsent text a deploy shows the update bar instead of reloading`);
    const bar = (await p.locator("#releaseBar").innerText().catch(() => "")) || "";
    ok(lang === "en" ? /Studio was updated/.test(bar) && /Reload/.test(bar) : /Studio 已更新/.test(bar) && /重新載入/.test(bar), `${tag}: the bar says Studio was updated and offers a reload, in the page language`, bar);
    ok(await p.evaluate(() => window.__oldPage === true) && await p.locator("#chatIn").inputValue() === "half-written message", `${tag}: the typed text and the page stay`);
    const box = await p.locator("#releaseBar").boundingBox();
    ok(!!box && box.x >= 0 && box.x + box.width <= width && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: the bar fits the screen`);
    await p.locator("#chatIn").fill("");
    await p.locator("#releaseBar button").click();
    ok(await until(async () => await mine() === `v${n}`), `${tag}: Reload opens the new release`);
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { ok(false, "the UI run finished", String(e?.stack ?? e).slice(0, 800)); }
finally { await browser?.close().catch(() => {}); await stop().catch(() => {}); }
console.log(`page-release-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
