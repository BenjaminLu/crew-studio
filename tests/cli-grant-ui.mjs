import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// External CLI grants on the board (Settings, docs/units/cli-mcp-grant.md): the section issues a grant for a registered
// project, shows the exact `claude mcp add studio -- … --grant-file …` line to copy (never the token), and revokes it;
// en and zh-TW labels, no overflow at 390 dark. CLI_GRANT_SHOTS=<dir> also writes screenshots there.
//   PLAYWRIGHT_MODULE=<playwright index.mjs> node tests/cli-grant-ui.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => { console.error("cli-grant-ui: Playwright not found; set PLAYWRIGHT_MODULE"); process.exit(2); });
let pass = 0, fail = 0; const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"}  ${n} ${c ? "" : x}`); };
const tmp = mkdtempSync(join(tmpdir(), "crew-cli-grant-ui-")), data = join(tmp, "data"), home = join(tmp, "home"), state = join(tmp, "fm", "state");
for (const d of [data, home, join(state, "pending")]) mkdirSync(d, { recursive: true });
const port = await freePort(), base = `http://127.0.0.1:${port}`, TOKEN = "test-session-cli-grant-ui";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_LOCAL_UNRESTRICTED"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_SESSION_TOKEN: TOKEN, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: home, CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let browser;
try {
  await waitUp(base, app);
  browser = withSession(await chromium.launch(), base, TOKEN);
  const shots = process.env.CLI_GRANT_SHOTS; if (shots) mkdirSync(shots, { recursive: true });
  for (const [width, theme, language] of [[1280, "light", "en"], [390, "dark", "zh-TW"]]) {
    const key = `${width}-${theme}-${language}`;
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    await ctx.addInitScript(({ language, theme }) => { localStorage.setItem("crew.lang", language); localStorage.setItem("crew.theme", theme); localStorage.setItem("crew.chatOpen", "0"); }, { language, theme });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, (r) => r.abort());
    const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${base}/#/settings`); await p.waitForSelector("[data-cli-grants] #grantProject option[value=sandbox]", { state: "attached" });
    ok(await p.locator("[data-cli-grants] h2", { hasText: language === "en" ? "External CLI grants" : "外部 CLI 授權" }).isVisible(), `${key}: the section is titled in the page language`);
    await p.selectOption("#grantProject", "sandbox"); await p.selectOption("#grantTtl", "1h");
    await p.click("#grantIssue");
    const cmd = p.locator("[data-cli-grants] [data-grant-command][data-fresh]"); await cmd.waitFor({ timeout: 10000 });
    const line = await cmd.textContent(), id = await cmd.getAttribute("data-grant-command");
    const file = join(data, "grants", id), token = readFileSync(file, "utf8").trim();
    ok(/^claude mcp add studio -- \S+ \S*src\/mcp\.ts --grant-file \S+ --url http:\/\/127\.0\.0\.1:\d+$/.test(line) && line.includes(file), `${key}: the copy-able command names the grant file`, line);
    ok(!line.includes(token) && !(await p.content()).includes(token), `${key}: the token is never on the page`);
    ok(/sandbox/.test(await p.locator(`[data-grant="${id}"] .bb-grant-h`).textContent()), `${key}: the grant row names its project`);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 0, `${key}: no horizontal overflow`, String(over));
    if (shots) { await p.locator("[data-cli-grants]").scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, `cli-grant-${key}.png`), fullPage: width < 600 }); }
    await p.click(`[data-grant-revoke="${id}"]`);
    await p.waitForSelector(`[data-grant="${id}"][data-grant-state=revoked]`, { timeout: 10000 });
    ok(!existsSync(file) && !(await p.locator(`[data-grant-command="${id}"]`).count()), `${key}: Revoke removes the token file and the command`);
    // a pull request list grant: no project to choose, the row says what it reaches
    await p.selectOption("#grantScope", "prs");
    ok(await p.locator("#grantProject").isHidden(), `${key}: the list scope hides the project picker`);
    await p.click("#grantIssue");
    const pcmd = p.locator("[data-cli-grants] [data-grant-command][data-fresh]"); await p.waitForFunction((old) => { const e = document.querySelector("[data-cli-grants] [data-grant-command][data-fresh]"); return e && e.getAttribute("data-grant-command") !== old; }, id, { timeout: 10000 });
    const pid = await pcmd.getAttribute("data-grant-command");
    ok(await p.locator(`[data-grant="${pid}"] [data-grant-scope=prs]`).textContent().then((t) => t.includes(language === "en" ? "Pull request list" : "PR 列表")), `${key}: the list grant's row says it reaches the pull request list`);
    ok(await p.locator("#grantScope").inputValue() === "prs" && await p.locator("#grantProject").isHidden(), `${key}: the picked scope stays after issuing`);
    ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${key}: no overflow with the scope picker`);
    if (shots) { await p.locator("[data-cli-grants]").scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, `cli-grant-prs-${key}.png`), fullPage: width < 600 }); }
    await p.click(`[data-grant-revoke="${pid}"]`); await p.waitForSelector(`[data-grant="${pid}"][data-grant-state=revoked]`, { timeout: 10000 });
    ok(!errors.length, `${key}: no page errors`, errors.join("; "));
    await ctx.close();
  }
} catch (e) { ok(false, "the UI run completed", String(e?.stack ?? e)); }
finally { try { await browser?.close(); } catch {} app.kill("SIGTERM"); }
console.log(`\ncli-grant-ui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
