// The captain's operating-rules editor (Settings): the page shows the seeded Studio-wide text and
// every registered project (the built-in sandbox included), saves a project's text through the
// captain's own page session, and lays out at 1280 light and 390 dark (zh-TW) without overflow.
// OPRULES_SHOTS=<dir> also writes the screenshots there.
//   PLAYWRIGHT_MODULE=<playwright index.mjs> node tests/operating-rules-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => { console.error("operating-rules-ui: Playwright not found; set PLAYWRIGHT_MODULE"); process.exit(2); });
let pass = 0, fail = 0; const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"}  ${n} ${c ? "" : x}`); };
const tmp = mkdtempSync(join(tmpdir(), "crew-oprules-ui-")), data = join(tmp, "data"), home = join(tmp, "home"), state = join(tmp, "fm", "state");
for (const d of [data, home, join(state, "pending")]) mkdirSync(d, { recursive: true });
const port = await freePort(), base = `http://127.0.0.1:${port}`, TOKEN = "test-session-oprules-ui";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_LOCAL_UNRESTRICTED"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_SESSION_TOKEN: TOKEN, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: home, CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let browser;
try {
  await waitUp(base, app);
  browser = withSession(await chromium.launch(), base, TOKEN);
  const shots = process.env.OPRULES_SHOTS; if (shots) mkdirSync(shots, { recursive: true });
  for (const [width, theme, language] of [[1280, "light", "en"], [1280, "light", "zh-TW"], [390, "dark", "zh-TW"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    await ctx.addInitScript(({ language, theme }) => { localStorage.setItem("crew.lang", language); localStorage.setItem("crew.theme", theme); localStorage.setItem("crew.chatOpen", "0"); }, { language, theme });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, (r) => r.abort());
    const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${base}/#/settings`); await p.waitForSelector("[data-operating-rules] #rulesText");
    await p.waitForFunction(() => document.querySelector("#rulesText").value.length > 0, null, { timeout: 10000 });
    const key = `${width}-${theme}-${language}`;
    const seeded = await p.inputValue("#rulesText");
    ok(/sign-in/.test(seeded) && /git config/.test(seeded), `${key}: the editor shows the seeded Studio-wide rules`);
    const opts = await p.$$eval("#rulesScope option", (o) => o.map((x) => x.value));
    ok(opts[0] === "" && opts.includes("sandbox"), `${key}: the scope picker lists Studio-wide and the built-in sandbox project`, JSON.stringify(opts));
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 0, `${key}: no horizontal overflow`, String(over));
    if (language === "zh-TW") ok(await p.locator("[data-operating-rules] h2", { hasText: "作業規則" }).isVisible(), `${key}: zh-TW labels`);
    if (key === "1280-light-en") {
      await p.selectOption("#rulesScope", "sandbox");
      ok((await p.inputValue("#rulesText")) === "" && /None set/.test(await p.textContent("#rulesState")), `${key}: a project with no rules says None set`);
      await p.fill("#rulesText", "- Port 4210 is the live board: never touch it.\n- Known red: privacy suite (1 known).");
      await p.click("#rulesSave"); await p.waitForFunction(() => /Saved\./.test(document.querySelector("#rulesState").textContent), null, { timeout: 10000 });
      const r = await fetch(`${base}/api/operating-rules`, { headers: { cookie: `crew_session=${TOKEN}` } }).then((x) => x.json());
      ok(r.projects.find((x) => x.id === "sandbox")?.text.startsWith("- Port 4210") && r.projects.find((x) => x.id === "sandbox")?.by === "captain", `${key}: Save stores the project's rules as the captain's`);
      await p.selectOption("#rulesScope", "");
    }
    if (shots) { await p.locator("[data-operating-rules]").scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, `operating-rules-${key}.png`), fullPage: width < 600 }); }
    ok(!errors.length, `${key}: no page errors`, errors.join("; "));
    await ctx.close();
  }
} catch (e) { ok(false, "the UI run completed", String(e?.stack ?? e)); }
finally { try { await browser?.close(); } catch {} app.kill("SIGTERM"); }
console.log(`\noperating-rules-ui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
