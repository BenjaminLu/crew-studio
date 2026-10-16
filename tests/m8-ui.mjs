import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// M8 in the browser: Documents (a draft by the writer, a pasted one), the
// document page (gates, export buttons, the rendered version), annotate with the
// M3 pin review, the writer's revision, approve. 1440 and 390, light and dark.   node tests/m8-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("m8-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const tmp = mkdtempSync(join(tmpdir(), "crew-m8ui-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); writeFileSync(join(state, "events.jsonl"), ""); mkdirSync(data);
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
const get = async (p) => (await fetch(base + p)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [], offbox = [];
const page = async (width, scheme) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.labs", "1"); } catch {} }); // these pages are labs (backbone sidebar)
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offbox.push(r.request().url()); r.abort(); });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(404|net::ERR_FAILED)/.test(m.text())) errors.push(`${width}/${scheme}: ${m.text()}`); });
  return p;
};
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = join(root, "tests/out");
try {
  await post("/api/docs", { id: "offsite-plan", title: "Offsite plan", md: "# Offsite plan\n\nA two-day team offsite in spring.\n\n## Budget\n\nThe budget is **12k** for travel and rooms.\n\n## Agenda\n\n- Day one: planning\n- Day two: a walk and a retro\n" });
  {
    const p = await page(1440, "light");
    await p.goto(`${base}/#/docs`);
    await p.locator(".btn.primary", { hasText: "New document" }).click();
    await p.locator('.modal input[aria-label="Title"]').fill("Weekly note");
    await p.locator('.modal textarea[aria-label="Prompt"]').fill("Summarise what the crew shipped this week");
    await p.locator(".modal .btn.primary").click();
    ok(await p.locator('[data-doc="weekly-note"]').waitFor({ timeout: 10000 }).then(() => true, () => false), "New document → the writer drafts it and it appears in the list");
    await p.goto(`${base}/#/doc/offsite-plan`);
    await p.locator(".x-gates li").first().waitFor();
    ok(await p.locator("a.btn", { hasText: "Word (.docx)" }).count() === 1 && await p.locator("a.btn", { hasText: "PDF" }).count() === 1, "the document page offers Markdown, HTML, Word and PDF exports");
    const dl = p.waitForEvent("download"); await p.locator("a.btn", { hasText: "Word (.docx)" }).click(); const f = await dl;
    ok(f.suggestedFilename() === "offsite-plan-v1.docx", "Word export downloads", f.suggestedFilename());
    await p.locator("a.btn", { hasText: "Annotate" }).click();
    await p.waitForFunction((re) => new RegExp(re).test(location.hash), "#\\/review\\/offsite-plan\\/1", { timeout: 90000 }); // a hash change has no load event
    const fr = p.frameLocator("iframe.a3-iframe");
    await fr.locator("p", { hasText: "12k" }).waitFor({ timeout: 8000 }); await p.waitForTimeout(300);
    await fr.locator("p", { hasText: "12k" }).click();
    await p.locator(".a3-compose textarea").fill("Say who signs off the budget");
    await p.locator(".a3-compose .btn.primary").click();
    await p.locator('.a3-note[data-note="P1"]').waitFor({ timeout: 5000 });
    ok((await get("/api/artifacts/offsite-plan")).versions[0].notes[0]?.selector?.startsWith("#b"), "a pin lands on the paragraph's block id");
    await p.locator("button", { hasText: "Request changes" }).click();
    for (let i = 0; i < 60 && (await get("/api/artifacts/offsite-plan")).versions.length < 2; i++) await sleep(200);
    ok((await get("/api/artifacts/offsite-plan")).versions.length === 2, "Request changes: the writer makes v2");
    await p.goto(`${base}/#/doc/offsite-plan`);
    await p.locator(".phead .vbadge", { hasText: "v2" }).waitFor({ timeout: 5000 });
    await p.locator(".btn", { hasText: "Approve" }).click();
    ok(await p.locator(".badge", { hasText: "Approved" }).first().waitFor({ timeout: 5000 }).then(() => true, () => false), "approve v2 from the document page (gates pass)");
    await p.close();
  }
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const p = await page(width, scheme);
    for (const [name, hash] of [["docs", "#/docs"], ["doc", "#/doc/offsite-plan"], ["compare", "#/compare/offsite-plan/1/2"]]) {
      await p.goto(`${base}/${hash}`);
      await p.waitForTimeout(800);
      ok(await noHScroll(p), `${name} ${width} ${scheme}: no sideways scroll`);
      await p.screenshot({ path: join(shots, `m8-${name}-${width}-${scheme}.png`), fullPage: true });
    }
    await p.close();
  }
  ok(errors.length === 0, "no console errors", errors.join("\n"));
  ok(offbox.length === 0, "no request leaves this machine", offbox.join(", "));
} catch (e) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}\n${appLog.slice(-1500)}`); }
finally { await browser.close(); app.kill(); }
console.log(`\nm8-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
