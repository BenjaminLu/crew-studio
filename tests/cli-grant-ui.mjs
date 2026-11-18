import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// External CLI grants on the board (Settings, docs/units/cli-mcp-grant.md): the section issues a grant for a registered
// project, shows the exact `claude mcp add studio -- … --grant-file …` line to copy (never the token), and revokes it; its
// scopes are a set (runs, the pull request list, reading Studio); reading Studio has presets (this project, review only,
// custom groups), external text off by default, and never offers settings, peers or terminals. 1440 and 390, light and
// dark, en and zh-TW, no overflow. CLI_GRANT_SHOTS=<dir> also writes screenshots there.
//   PLAYWRIGHT_MODULE=<playwright index.mjs> node tests/cli-grant-ui.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => { console.error("cli-grant-ui: Playwright not found; set PLAYWRIGHT_MODULE"); process.exit(2); });
const J = (v) => JSON.stringify(v);
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
  for (const [width, theme, language] of [[1440, "light", "en"], [1440, "dark", "zh-TW"], [390, "light", "zh-TW"], [390, "dark", "en"]]) {
    const key = `${width}-${theme}-${language}`;
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    await ctx.addInitScript(({ language, theme }) => { localStorage.setItem("crew.lang", language); localStorage.setItem("crew.theme", theme); localStorage.setItem("crew.chatOpen", "0"); }, { language, theme });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, (r) => r.abort());
    const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${base}/#/settings`); await p.waitForSelector("[data-cli-grants] #grantProject option[value=sandbox]", { state: "attached" });
    ok(await p.locator("[data-cli-grants] h2", { hasText: language === "en" ? "External CLI grants" : "外部 CLI 授權" }).isVisible(), `${key}: the section is titled in the page language`);
    ok(await p.locator("#grantScope-project").isChecked() && !(await p.locator("#grantScope-prs").isChecked()) && !(await p.locator("#grantScope-observe").isChecked()), `${key}: a new grant reaches runs in a project, by default`);
    ok(!/\bnull\b|undefined/.test(await p.locator("[data-cli-grants]").innerText()), `${key}: no stray "null" or "undefined" in the section`);
    await p.selectOption("#grantProject", "sandbox"); await p.selectOption("#grantTtl", "1h");
    await p.click("#grantIssue");
    const cmd = p.locator("[data-cli-grants] [data-grant-command][data-fresh]"); await cmd.waitFor({ timeout: 10000 });
    const line = await cmd.textContent(), id = await cmd.getAttribute("data-grant-command");
    const file = join(data, "grants", id), token = readFileSync(file, "utf8").trim();
    ok(/^claude mcp add --scope user studio -- \S+ \S*src\/mcp\.ts --grant-file \S+ --url http:\/\/127\.0\.0\.1:\d+$/.test(line) && line.includes(file), `${key}: the copy-able command names the grant file`, line);
    ok(!line.includes(token) && !(await p.content()).includes(token), `${key}: the token is never on the page`);
    // connecting a client: Claude Code (default), Codex, Cursor, VS Code, each its command and config entry
    const tabs = await p.locator(`[data-grant="${id}"] [data-grant-client]`).allTextContents();
    ok(JSON.stringify(tabs) === JSON.stringify(["Claude Code", "Codex", "Cursor", "VS Code", "Plug-in"]), `${key}: a tab per client`, JSON.stringify(tabs));
    ok(/"mcpServers"/.test(await p.locator(`[data-grant="${id}"] [data-grant-config=claude]`).textContent()), `${key}: Claude Code's .mcp.json entry`);
    await p.click(`[data-grant="${id}"] [data-grant-client=codex]`);
    const codexCmd = await p.locator(`[data-grant="${id}"] [data-grant-client-command=codex]`).textContent(), toml = await p.locator(`[data-grant="${id}"] [data-grant-config=codex]`).textContent();
    ok(/^codex mcp add studio -- /.test(codexCmd) && /^\[mcp_servers\.studio\]\ncommand = /.test(toml) && toml.includes(file) && !toml.includes(token), `${key}: Codex's command and config.toml`, toml);
    await p.click(`[data-grant="${id}"] [data-grant-client=vscode]`);
    const vs = JSON.parse(await p.locator(`[data-grant="${id}"] [data-grant-config=vscode]`).textContent());
    ok(vs.servers.studio.type === "stdio" && vs.servers.studio.args.includes(file) && !(await p.locator(`[data-grant="${id}"] [data-grant-client-command]`).count()), `${key}: VS Code's mcp.json (no command line)`, JSON.stringify(vs));
    ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${key}: no overflow with a config shown`);
    if (shots) { await p.locator(`[data-grant="${id}"]`).scrollIntoViewIfNeeded(); await p.locator("[data-cli-grants]").screenshot({ path: join(shots, `cli-grant-clients-${key}.png`) }); }
    await p.click(`[data-grant="${id}"] [data-grant-client=claude]`);
    ok(/sandbox/.test(await p.locator(`[data-grant="${id}"] .bb-grant-h`).textContent()), `${key}: the grant row names its project`);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 0, `${key}: no horizontal overflow`, String(over));
    if (shots) { await p.locator("[data-cli-grants]").scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, `cli-grant-${key}.png`), fullPage: width < 600 }); }
    await p.click(`[data-grant-revoke="${id}"]`);
    await p.waitForSelector(`[data-grant="${id}"][data-grant-state=revoked]`, { timeout: 10000 });
    ok(!existsSync(file) && !(await p.locator(`[data-grant-command="${id}"]`).count()), `${key}: Revoke removes the token file and the command`);
    // a pull request list grant: no project to choose, the row says what it reaches
    await p.uncheck("#grantScope-project"); await p.check("#grantScope-prs");
    ok(await p.locator("#grantProject").isHidden(), `${key}: the list scope hides the project picker`);
    await p.click("#grantIssue");
    const pcmd = p.locator("[data-cli-grants] [data-grant-command][data-fresh]"); await p.waitForFunction((old) => { const e = document.querySelector("[data-cli-grants] [data-grant-command][data-fresh]"); return e && e.getAttribute("data-grant-command") !== old; }, id, { timeout: 10000 });
    const pid = await pcmd.getAttribute("data-grant-command");
    ok(await p.locator(`[data-grant="${pid}"] [data-grant-scope=prs]`).textContent().then((t) => t.includes(language === "en" ? "Pull request list" : "PR 列表")), `${key}: the list grant's row says it reaches the pull request list`);
    ok(await p.locator("#grantScope-prs").isChecked() && await p.locator("#grantProject").isHidden(), `${key}: the picked scope stays after issuing`);
    ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, `${key}: no overflow with the scope picker`);
    if (shots) { await p.locator("[data-cli-grants]").scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, `cli-grant-prs-${key}.png`), fullPage: width < 600 }); }
    await p.click(`[data-grant-revoke="${pid}"]`); await p.waitForSelector(`[data-grant="${pid}"][data-grant-state=revoked]`, { timeout: 10000 });
    // reading Studio: presets, groups, external text off by default; never settings, peers or terminals
    await p.uncheck("#grantScope-prs"); await p.check("#grantScope-observe");
    const obs = p.locator("[data-grant-observe]"); await obs.waitFor();
    ok(await p.locator("input[name=grantPreset][value=project]").isChecked() && !(await p.locator("#grantUntrusted").isChecked()) && await p.locator("#grantProject").isVisible(), `${key}: reading Studio starts at "this project", external text off, a project to pick`);
    ok(await p.locator("[data-grant-wide]").isVisible() && /Studio-wide|整個 Studio 共用/.test(await p.locator("[data-grant-wide]").textContent()), `${key}: "this project" says workflows, skills, the crew and Doctor are Studio-wide`);
    const labels = await p.locator("input[name=grantPreset] + span").allTextContents();
    ok(J(labels) === J(language === "en" ? ["This project", "Review only", "Custom…"] : ["這個專案", "只看 review", "自訂…"]), `${key}: the presets in the page language`, J(labels));
    await p.check("input[name=grantPreset][value=custom]");
    const kinds = await p.locator("input[name=grantKind]").evaluateAll((xs) => xs.map((x) => x.value));
    ok(kinds.includes("doctor") && kinds.includes("room") && !kinds.some((k) => ["settings", "terminal", "peer", "grant", "focus"].includes(k)) && await p.locator("[data-grant-group=system] input[name=grantKind][value=doctor]").count() === 1 && /Doctor|健康檢查/.test(await p.locator("[data-grant-group=system]").textContent()) && !/\bmono\b/.test(await p.locator("[data-grant-group=system] label span").first().getAttribute("class") ?? ""), `${key}: custom groups offer every grantable kind, Doctor under System, never settings, terminals or peers`, J(kinds));
    ok(await p.locator("#grantIssue").isDisabled(), `${key}: a custom grant with no kind cannot be issued`);
    ok(await p.locator("#grantProject").isVisible() && await p.locator("#grantProject").inputValue() === "", `${key}: a custom grant may pick a project, and starts at every project`);
    await p.check("input[name=grantKind][value=doc]"); await p.check("input[name=grantKind][value=room]");
    ok(await p.locator("#grantIssue").isEnabled(), `${key}: ticking a kind makes a custom grant issuable`);
    await p.click("#grantIssue");
    await p.waitForFunction(() => document.querySelectorAll("[data-cli-grants] [data-grant][data-grant-state=active]").length > 0, null, { timeout: 10000 });
    { const cg = JSON.parse(readFileSync(join(data, "cli-grants.json"), "utf8")).filter((g) => g.observe?.preset === "custom").at(-1);
      ok(cg && cg.project === "" && J(cg.observe.kinds) === J(["room", "doc"]), `${key}: the custom grant binds no project it did not show, and the kinds ticked`, J(cg));
      const crow = await p.locator(`[data-grant="${cg.id}"] [data-grant-scope]`).textContent();
      ok((language === "en" ? /Review rooms, Documents/ : /審查室、文件/).test(crow) && (language === "en" ? /every project/ : /所有專案/).test(crow), `${key}: the row names the custom kinds and the project (every project)`, crow);
      await p.click(`[data-grant-revoke="${cg.id}"]`); await p.waitForSelector(`[data-grant="${cg.id}"][data-grant-state=revoked]`, { timeout: 10000 }); }
    await p.check("input[name=grantPreset][value=custom]");
    const overC = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overC <= 0, `${key}: no overflow with the custom groups open`, String(overC));
    if (shots) { await obs.scrollIntoViewIfNeeded(); await p.locator("[data-cli-grants]").screenshot({ path: join(shots, `cli-grant-observe-custom-${key}.png`) }); }
    await p.check("input[name=grantPreset][value=review]");
    ok(await p.locator("#grantProject").isHidden(), `${key}: "review only" needs no project`);
    await p.click("#grantIssue");
    await p.waitForFunction((old) => { const e = document.querySelector("[data-cli-grants] [data-grant-command][data-fresh]"); return e && e.getAttribute("data-grant-command") !== old; }, pid, { timeout: 10000 });
    const oid = await p.locator("[data-cli-grants] [data-grant-command][data-fresh]").getAttribute("data-grant-command");
    const row = await p.locator(`[data-grant="${oid}"] [data-grant-scope]`).textContent();
    ok(row.includes(language === "en" ? "Read Studio: Review only" : "讀取 Studio: 只看 review") && !/external text|外部文字/.test(row), `${key}: the row says it reads review rooms only, without external text`, row);
    ok(/\d+ of \d+ calls|\d+\/\d+ 次/.test(await p.locator(`[data-grant="${oid}"] [data-grant-budget]`).textContent()), `${key}: the row shows this hour's budget`);
    const stored = JSON.parse(readFileSync(join(data, "cli-grants.json"), "utf8")).find((g) => g.id === oid);
    ok(J(stored.scopes) === J(["observe"]) && J(stored.observe) === J({ preset: "review", kinds: ["room"], untrusted: false }), `${key}: the grant stored is observe, review rooms, no external text`, J(stored));
    if (shots) { await p.locator(`[data-grant="${oid}"]`).scrollIntoViewIfNeeded(); await p.locator("[data-cli-grants]").screenshot({ path: join(shots, `cli-grant-observe-${key}.png`) }); }
    await p.click(`[data-grant-revoke="${oid}"]`); await p.waitForSelector(`[data-grant="${oid}"][data-grant-state=revoked]`, { timeout: 10000 });
    ok(!errors.length, `${key}: no page errors`, errors.join("; "));
    await ctx.close();
  }
} catch (e) { ok(false, "the UI run completed", String(e?.stack ?? e)); }
finally { try { await browser?.close(); } catch {} app.kill("SIGTERM"); }
console.log(`\ncli-grant-ui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
