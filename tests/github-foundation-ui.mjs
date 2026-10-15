// Capture the added publication node and graph routes, all viewport/themes/languages.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
const root = join(import.meta.dirname, ".."), temp = mkdtempSync(join(tmpdir(), "github-foundation-ui-"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env }; for (const key of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_FM_STATE"]) delete env[key];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN = "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: join(temp, "home"), CREW_DATA: join(temp, "data"), CREW_MAIN_PROJECT: join(temp, "project"), CREW_PORT: String(port), CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_KEYCHAIN_TOOL: "none", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1" } });
let logs = ""; app.stdout.on("data", d => logs += d); app.stderr.on("data", d => logs += d);
let browser, passed = 0, failed = 0;
const ok = (v, label) => { console.log(`${v ? "PASS" : "FAIL"} ${label}`); v ? passed++ : failed++; };
const shots = join(root, "tests/out/github-foundation"); mkdirSync(shots, { recursive: true });
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base);
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) for (const language of ["en", "zh-TW"]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
    const p = await context.newPage(); let errors = [];
    p.on("pageerror", e => errors.push(e.message));
    await p.addInitScript(({ language }) => { localStorage.setItem("crew.lang", language); localStorage.setItem("crew.chatOpen", "0"); localStorage.setItem("crew.graphView", "detail"); }, { language });
    await p.goto(base + "/#/workflows/code-firstmate");
    await p.waitForSelector('svg.rt-graph');
    await p.evaluate(() => document.body.classList.add("chat-closed"));
    await p.click("[data-fit]");
    const buildStage = p.locator('[data-stage-node="build"]');
    if (await buildStage.count()) { await buildStage.focus(); await buildStage.press("Enter"); }
    await p.waitForSelector('svg.rt-graph [data-node="pr-open"]');
    await p.evaluate(() => document.body.classList.add("chat-closed"));
    await p.click("[data-fit]"); await p.waitForTimeout(150);
    const geometry = await p.locator('[data-node="pr-open"]').evaluate(el => { const r = el.getBoundingClientRect(), svg = el.closest("svg").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, visible: r.width > 0 && r.height > 0 && r.x >= svg.x - 1 && r.y >= svg.y - 1 && r.right <= svg.right + 1 && r.bottom <= svg.bottom + 1 }; });
    ok(geometry.visible, `${width}/${theme}/${language} publication node fits graph viewport`);
    const labels = await p.locator('[data-node="pr-open"]').textContent();
    ok(/Review request/.test(labels), `${width}/${theme}/${language} publication node has visible label`);
    ok(errors.length === 0, `${width}/${theme}/${language} no browser errors`);
    await p.screenshot({ path: join(shots, `code-firstmate-${width}-${theme}-${language}.png`), fullPage: true });
    const node = p.locator('[data-node="pr-open"]'); await node.focus(); await node.press("Enter");
    await p.locator('.rt-panel h3').waitFor(); await p.locator('.rt-panel').scrollIntoViewIfNeeded();
    ok(await p.locator('.rt-panel [data-field="do"]').inputValue() === "pr.open", `${width}/${theme}/${language} publication action is reachable through node selection`);
    await p.screenshot({ path: join(shots, `publication-selection-${width}-${theme}-${language}.png`), fullPage: true }); await context.close();
  }
} catch (e) { console.error(e.message); failed++; }
finally { await browser?.close(); app.kill("SIGTERM"); await new Promise(resolve => { if (app.exitCode !== null) resolve(); else app.once("exit", resolve); }); rmSync(temp, { recursive: true, force: true }); }
console.log(`${passed} passed / ${failed} failed`); process.exitCode = failed ? 1 : 0;
