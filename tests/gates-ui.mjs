// Doors and gates in the browser: the Gates page (door chips, gate summaries, a
// project's proposed list), a change's page (gates by node, worker/reviewer
// rounds), picking a door, a one-way merge with its confirm, and the workflow
// view with a change's gate results on the graph. 1440 and 390, light and dark.
//   node tests/gates-ui.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("gates-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const tmp = mkdtempSync(join(tmpdir(), "crew-gatesui-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data"), repo = join(tmp, "repo");
mkdirSync(join(state, "pending"), { recursive: true }); writeFileSync(join(state, "events.jsonl"), ""); mkdirSync(data); mkdirSync(repo);
const genv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (...a) => execFileSync("git", a, { cwd: repo, env: genv, encoding: "utf8" }).trim();
git("init", "-q", "-b", "main");
for (const d of ["src", "data", "docs"]) mkdirSync(join(repo, d));
writeFileSync(join(repo, "src/app.ts"), "export const x = 1;\n"); writeFileSync(join(repo, "data/x.json"), "{}\n"); writeFileSync(join(repo, "docs/guide.md"), "# Guide\n");
git("add", "-A"); git("commit", "-q", "-m", "init");
const branch = (name, files, msg = `${name} change`) => { git("checkout", "-q", "-b", name, "main"); for (const [f, t] of Object.entries(files)) { mkdirSync(join(repo, f, ".."), { recursive: true }); writeFileSync(join(repo, f), t); } git("add", "-A"); git("commit", "-q", "-m", msg); git("checkout", "-q", "main"); };
branch("feat-json", { "data/x.json": "{bad\n", "src/app.ts": "export const x = 2;\n" });
branch("feat-migration", { "migrations/001_users.sql": "create table users(id int);\n" }, "Add the users table\n\nRollback: drop table users");
branch("feat-newtop", { "tools/gen.ts": "export {};\n" });
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
const settle = async (id) => { for (let i = 0; i < 150; i++) { const c = await get(`/api/changes/${id}`); if (!["classifying", "running", "fixing", "reviewing"].includes(c.status)) return c; await sleep(150); } };
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

try {
  await post("/api/projects", { name: "Demo shop", path: repo, base: "main", propose: [{ glob: "src/billing/**", why: "money moves" }] });
  const js = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-json", title: "Bump x and fix the fixture", hint: "replace {bad => {\"ok\":true} in data/x.json" })).id);
  const mig = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-migration", title: "Users table" })).id);
  const nt = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-newtop", title: "Generator script" })).id);
  ok(js.status === "ready" && mig.status === "ready" && nt.status === "needs-door", "three changes: fixed and ready, one-way ready, waiting for a door", JSON.stringify([js.status, mig.status, nt.status, js.error]));
  {
    const p = await page(1440, "light");
    await p.goto(`${base}/#/gates`);
    await p.locator("[data-change]").first().waitFor({ timeout: 8000 });
    ok(await p.locator(".x-door.one-way").count() >= 1 && await p.locator(".x-door.undecided").count() >= 1 && await p.locator(".x-door.two-way").count() >= 1, "the Gates page shows each change's door chip");
    ok(await p.locator("[data-project] .btn", { hasText: "Approve list" }).count() === 1, "the project's proposed list waits for the captain's approval");
    await p.locator("[data-project] .btn", { hasText: "Approve list" }).click();
    ok(await p.locator("[data-project] .badge", { hasText: "list approved" }).waitFor({ timeout: 4000 }).then(() => true, () => false), "approving the list from the page puts it in force");
    await p.locator(`[data-change="${nt.id}"] .btn`, { hasText: "Two-way" }).click();
    ok(await p.locator(`[data-change="${nt.id}"] .badge`, { hasText: "Ready to merge" }).waitFor({ timeout: 10000 }).then(() => true, () => false), "picking a door from the card runs the gates");
    await p.locator(`[data-change="${mig.id}"] .btn.primary`, { hasText: "Merge" }).click();
    await p.locator(".modal .btn.primary").click();
    await p.waitForTimeout(300);
    ok((await get(`/api/changes/${mig.id}`)).status === "ready", "a one-way merge without the tick does nothing");
    await p.locator("#oneWayOk").check();
    await p.locator(".modal .btn.primary").click();
    await p.waitForTimeout(800);
    ok((await get(`/api/changes/${mig.id}`)).status === "merged" && git("log", "--format=%s", "-1", "main") === "Add the users table", "with the one-way tick, Merge fast-forwards main");
    await p.goto(`${base}/#/change/${js.id}`);
    await p.locator("[data-gate]").first().waitFor();
    ok(await p.locator("text=Round 1").count() >= 1 && await p.locator(".badge", { hasText: "APPROVE" }).count() >= 1, "the change page shows the worker round and the reviewer's verdict");
    await p.goto(`${base}/#/workflow/change/${js.id}`);
    await p.locator("svg.graph .gn").first().waitFor();
    ok(await p.locator("svg.graph .gn.g-ok").count() >= 1, "the workflow view colours the nodes by the change's gate results");
    await p.goto(`${base}/#/workflow`);
    await p.locator("svg.graph .gn").first().waitFor();
    ok(await p.locator(".x-tabs .chip").count() >= 2, "the code workflow view has a switcher to every workflow");
    await p.close();
  }
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const p = await page(width, scheme);
    for (const [name, hash] of [["gates", "#/gates"], ["change", `#/change/${js.id}`], ["flow", `#/workflow/change/${js.id}`]]) {
      await p.goto(`${base}/${hash}`);
      await p.waitForTimeout(700);
      ok(await noHScroll(p), `${name} ${width} ${scheme}: no sideways scroll`);
      await p.screenshot({ path: join(shots, `gates-${name}-${width}-${scheme}.png`), fullPage: true });
    }
    await p.close();
  }
  ok(errors.length === 0, "no console errors", errors.join("\n"));
  ok(offbox.length === 0, "no request leaves this machine", offbox.join(", "));
} catch (e) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}\n${appLog.slice(-1500)}`); }
finally { await browser.close(); app.kill(); }
console.log(`\ngates-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
