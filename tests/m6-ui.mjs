// M6 in the browser: the Improve page (proposals with before/after evals and the
// expected metric), a retro report, a proposal (diff, replay cases, adopt), and
// a skill page (edit with chat). Every page at 1440 and 390, light and dark: no
// console error, no sideways scroll, no request leaving this machine.   node tests/m6-ui.mjs
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("m6-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const tmp = mkdtempSync(join(tmpdir(), "crew-m6ui-"));
const fmRoot = join(tmp, "fm"), state = join(fmRoot, "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
cpSync(join(here, "fixture/retro/events.jsonl"), join(state, "events.jsonl"));
for (const r of ["worker", "reviewer", "designer"]) { mkdirSync(join(fmRoot, "skills", r), { recursive: true }); cpSync(join(here, "fixture/skills", `${r === "designer" ? "reviewer" : r}.md`), join(fmRoot, "skills", r, "SKILL.md")); }
const port = await freePort();
const env = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
const post = async (p, b = {}) => (await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(b) })).json();
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [], offbox = [];
const page = async (width, scheme) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.labs", "1"); } catch {} }); // these pages are labs (backbone sidebar)
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offbox.push(r.request().url()); r.abort(); });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(404|net::ERR_FAILED)/.test(m.text())) errors.push(`${width}/${scheme}: ${m.text()}`); });
  return p;
};
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = join(root, "tests/out");
const lastTs = readFileSync(join(state, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).ts).sort().at(-1);

try {
  await post("/api/improve/settings", { evalMode: "model", provider: "stub" });
  const rep = await post("/api/improve/retro", { workflow: "code", days: 14, to: new Date(Date.parse(lastTs) + 1000).toISOString() });
  const e1 = rep.edits.find((e) => e.class === "round-time-cap");
  {
    const p = await page(1440, "light");
    await p.goto(`${base}/#/improve`);
    await p.locator(".x-prop").first().waitFor({ timeout: 8000 });
    ok(await p.locator(".x-prop").count() === 4, "Improve lists the four proposals from the retro");
    ok(await p.locator(".x-prop .x-ev.up").count() === 4 && await p.locator(".x-prop .badge.ok", { hasText: "no regressions" }).count() === 4 && await p.locator(".x-prop .x-metric").count() >= 4, "each card shows the expected metric and the eval gain (before → after)");
    await p.locator(".x-prop", { hasText: "3600" }).first().click();
    await p.waitForFunction((re) => new RegExp(re).test(location.hash), "#\\/edit\\/", { timeout: 90000 }); // a hash change has no load event
    await p.locator(".x-evtable").waitFor();
    ok(await p.locator(".x-dl.add").count() >= 1, "the proposal shows its diff");
    ok(await p.locator(".x-evr summary").count() >= 2, "the proposal lists its replay cases, each before and after");
    await p.locator(".btn.primary", { hasText: "Adopt" }).click();
    await p.locator(".modal .btn.primary").click();
    ok(await p.locator(".badge", { hasText: "Adopted" }).first().waitFor({ timeout: 5000 }).then(() => true, () => false), "Adopt from the page: the edit becomes adopted");
    await p.goto(`${base}/#/skill/code/reviewer`);
    await p.locator("#skillAsk").waitFor();
    await p.locator("#skillAsk").fill("Reject a round whose brief names another head");
    await p.locator(".x-ask .btn.primary").click();
    await p.waitForFunction((re) => new RegExp(re).test(location.hash), "#\\/edit\\/", { timeout: 90000 }); // a hash change has no load event
    await p.locator(".badge", { hasText: "Offered" }).first().waitFor({ timeout: 10000 });
    ok(await p.locator(".x-dl.add").count() >= 1, "Edit with chat on a skill page: the editor's change comes back offered with its diff");
    await p.close();
  }
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const p = await page(width, scheme);
    for (const [name, hash] of [["improve", "#/improve"], ["retro", `#/retro/${rep.id}`], ["edit", `#/edit/${e1.id}`], ["skill", "#/skill/code/worker"]]) {
      await p.goto(`${base}/${hash}`);
      await p.waitForTimeout(600);
      ok(await noHScroll(p), `${name} ${width} ${scheme}: no sideways scroll`);
      await p.screenshot({ path: join(shots, `m6-${name}-${width}-${scheme}.png`), fullPage: name !== "skill" });
    }
    await p.close();
  }
  ok(errors.length === 0, "no console errors", errors.join("\n"));
  ok(offbox.length === 0, "no request leaves this machine", offbox.join(", "));
} catch (e) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}\n${appLog.slice(-1500)}`); }
finally { await browser.close(); app.kill(); }
console.log(`\nm6-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
