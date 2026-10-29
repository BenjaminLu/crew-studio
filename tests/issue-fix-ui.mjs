import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Fix on a project's page (public/issues.js; docs/units/board.md, "Fixing issues"): a checkbox per filed issue, select all in
// a category and on the whole page, the bar that says how many are picked, one in-page confirmation (how many issues, the
// two investigators' and the worker's models, a Task per issue) for the whole pick, a Fix button per issue, and each issue's
// state on its own row with a status line on each category, also when it is closed. At 1440 (en) and 390 (zh-TW).
// Nothing starts: the Fix route is answered by the test.     bun tests/issue-fix-ui.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { grantSignature } from "../src/github-grant";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("issue-fix-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = checkedTempDir("crew-fx-"), data = join(tmp, "data");
mkdirSync(join(data, "issue-triage"), { recursive: true }); mkdirSync(join(data, "issue-categories"), { recursive: true });
const repo = join(tmp, "wallet"); mkdirSync(repo); assertTempRepo(repo);
const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: repo, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).toString().trim();
git("init", "-q", "-b", "main"); writeFileSync(join(repo, "README.md"), "wallet"); git("add", "README.md"); git("commit", "-q", "-m", "start"); git("remote", "add", "origin", "https://github.com/fixture/wallet.git");
const grant = { mode: "github", repository: "fixture/wallet", localPath: repo, pushUrl: "https://github.com/fixture/wallet.git", apiOrigin: "https://api.github.com", base: "main", branchPrefix: "crew/", approvedAt: "2026-10-28T00:00:00Z", approvalId: "R-1/SC-1" };
grant.signature = grantSignature(data, { id: "wallet", path: repo, base: "main" }, grant);
writeFileSync(join(data, "projects.json"), JSON.stringify([{ id: "wallet", name: "wallet", path: repo, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, github: grant }], null, 1));
const issue = (title) => ({ title, labels: [], hash: "0".repeat(64), investigated: false, security: false });
const BIG = Array.from({ length: 120 }, (_, i) => 100 + i);
writeFileSync(join(data, "issue-triage", "wallet.json"), JSON.stringify({ schema: 1, project: "wallet", repository: "fixture/wallet", commit: "c".repeat(40), snapshot: { hash: "h", fetchedAt: "2026-10-28T09:30:00Z" }, open: 128, investigated: [],
  issues: Object.fromEntries([11, 12, 13, 16, 17, 18, ...BIG].map((n) => [n, issue(`Issue ${n}`)])), packages: [], toHuman: [], noCode: [], createdAt: "2026-10-28T09:40:00Z", by: "issue-triage R-9" }));
const cat = (id, name, status) => ({ id, name, scope: `${name} scope`, status, createdAt: "2026-10-28T09:00:00Z", createdBy: "R-1 (claude m)" });
const asg = (category) => ({ category, by: "model", at: "2026-10-28T09:00:00Z" });
writeFileSync(join(data, "issue-categories", "wallet.json"), JSON.stringify({ schema: 1, project: "wallet", repository: "fixture/wallet", lastCategory: 4, updatedAt: "2026-10-28T09:00:00Z", runs: [],
  categories: [cat("C-1", "內嵌網頁", "active"), cat("C-2", "URL 工具", "active"), cat("C-3", "推播", "proposed"), cat("C-4", "Settings", "active")],
  assignments: { 11: asg("C-1"), 12: asg("C-1"), 16: asg("C-1"), 13: asg("C-2"), 17: asg("C-2"), 18: asg("C-3"), ...Object.fromEntries(BIG.map((n) => [n, asg("C-4")])) },
  titles: { 11: "Bridge trusts a page URL", 12: "Replies reach the next page", 13: "Query string doubled", 16: 'Title with <img src=x onerror="window.__pwned=1"> markup', 17: "Share link loses its fragment", 18: "Push badge", ...Object.fromEntries(BIG.map((n) => [n, `Setting ${n}`])) } }));
// where each issue stands after Fix (src/domain/issue-fix.ts), as the triage route reads it
const s = (state, o = {}) => ({ state, busy: ["starting", "investigating", "security", "running", "waiting", "ready", "merged"].includes(state) || state === "judge" && !!o.court, pick: ["none", "failed", "changed", "proposed", "approved"].includes(state), ...o });
const FIXES = { 11: s("running", { task: "R-31" }), 12: s("judge", { task: "R-32", court: "#/court/wallet/R-32" }), 13: s("needs-info", { questions: ['Which version? <img src=x onerror="window.__pwned2=1">'] }),
  17: s("failed", { task: "R-33", why: "its Task ended without being ready" }), 100: s("duplicate", { duplicateOf: 70 }), 101: s("recheck"), 102: s("ready", { task: "R-40" }), 103: s("not-code"), 104: s("in-progress", { pulls: [40] }) };
const PICKABLE = [16, 17, ...BIG.filter((n) => !FIXES[n])].sort((a, b) => a - b);

const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "0", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
async function open(width, lang = "en") {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 } });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [lang]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/api\/issue-triage\/wallet$/, async (r) => { const j = await (await r.fetch()).json(); r.fulfill({ json: { ...j, fix: FIXES, worker: { provider: "claude", model: "worker-model" },
    investigators: { a: { provider: "claude", model: "inv-a" }, b: { provider: "codex", model: "inv-b" } } } }); });
  const sent = [];
  await ctx.route(/\/api\/issue-triage\/wallet\/fix$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); sent.push(b); r.fulfill({ json: { ok: true, started: b.issues.map((n) => ({ n, task: `R-${n}` })), skipped: [] } }); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e}`));
  await p.goto(`${base}/#/project/wallet`); await p.waitForSelector('[data-cat="C-1"]', { timeout: 8000 }); await p.waitForTimeout(400);
  return { ctx, p, sent };
}
const openCat = async (p, id) => { if (!(await p.locator(`[data-cat="${id}"]`).evaluate((e) => e.open))) await p.click(`[data-cat="${id}"] summary b`); };
// the issues section, its bar and its confirmation stay inside the screen (the project's header is not this page's concern)
const noSideways = (p) => p.evaluate(() => { const sec = document.querySelector("[data-project-issues]"), r = sec.getBoundingClientRect();
  return sec.scrollWidth <= sec.clientWidth + 1 && r.right <= innerWidth + 1 && [...document.querySelectorAll("[data-fix-bar], [data-fix-modal]")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1 && e.getBoundingClientRect().left >= -1); });
try {
  { const { ctx, p, sent } = await open(1440);
    // closed categories already say how their issues stand
    const sum = async (id) => (await p.locator(`[data-cat="${id}"] > summary [data-fix-summary]`).textContent().catch(() => "")) || "";
    ok(!(await p.locator('[data-cat="C-1"]').evaluate((e) => e.open)) && /1 being fixed · 1 for you to judge/.test(await sum("C-1")), "a closed category's line says how its issues stand", await sum("C-1"));
    ok(/1 need more information · 1 failed/.test(await sum("C-2")) && /2 fixed, waiting for you to check · 3 nothing to fix/.test(await sum("C-4")) && await p.locator('[data-cat="C-3"] [data-fix-summary]').count() === 0, "each group is counted; a category waiting for approval has no Fix", JSON.stringify([await sum("C-2"), await sum("C-4")]));
    await openCat(p, "C-1"); await openCat(p, "C-2");
    const row = (n) => p.locator(`[data-cat-issue="${n}"]`);
    ok(await row(11).locator("[data-fix-pick]").isDisabled() && !(await row(11).locator("[data-fix-one]").count()) && /Fixing/.test(await row(11).locator("[data-fix-state]").textContent()) && await row(11).locator('a[href="#/run/R-31"]').count() === 1, "an issue being fixed shows its Task and cannot be picked again");
    ok(/The investigators disagree: you decide/.test(await row(12).locator("[data-fix-state]").textContent()) && await row(12).locator('a[href="#/court/wallet/R-32"]').count() === 1 && await row(12).locator("[data-fix-pick]").isDisabled(), "a disagreement links the court on its row");
    ok(/Needs more information/.test(await row(13).textContent()) && await row(13).locator('[data-fix-questions="13"] li').count() === 1 && !(await p.evaluate(() => window.__pwned2)) && !(await row(13).locator("img").count()), "needs information: the questions on the row, as text", await row(13).textContent());
    ok(/Failed: its Task ended without being ready/.test(await row(17).textContent()) && await row(17).locator("[data-fix-one]").count() === 1 && !(await row(17).locator("[data-fix-pick]").isDisabled()), "a failed issue says why and can be fixed again");
    ok(!(await row(16).locator("[data-fix-state]").count()) && await row(16).locator("[data-fix-one]").count() === 1 && !(await p.evaluate(() => window.__pwned)), "an issue not fixed yet has its Fix button; its title stays text");
    await openCat(p, "C-4");
    ok(/Duplicate: #70/.test(await row(100).textContent()) && /Fixed already\? Please check/.test(await row(101).textContent()) && /Fixed on its local branch, not published/.test(await row(102).textContent()) && /Not a code change/.test(await row(103).textContent()) && /A pull request is already on it/.test(await row(104).textContent()) && await row(104).locator('a[href="https://github.com/fixture/wallet/pull/40"]').count() === 1, "each outcome is shown on its own row");
    // one issue, then a category
    ok(!(await p.locator("[data-fix-bar]").count()), "nothing picked: no bar");
    await row(16).locator("[data-fix-pick]").check();
    ok(/1 selected/.test(await p.locator("[data-fix-bar]").textContent()), "picking an issue shows the bar with how many are picked");
    const c2open = await p.locator('[data-cat="C-2"]').evaluate((e) => e.open);
    await p.locator('[data-cat="C-2"] > summary .is-fix-all input').check();
    ok(/2 selected/.test(await p.locator("[data-fix-bar]").textContent()) && await p.locator('[data-cat="C-2"]').evaluate((e) => e.open) === c2open, "a category's Select all picks what can be fixed in it (not a needs-info issue), without opening or closing it", await p.locator("[data-fix-bar]").textContent());
    await p.locator('[data-cat="C-2"] > summary .is-fix-all input').uncheck();
    ok(/1 selected/.test(await p.locator("[data-fix-bar]").textContent()), "and unpicks them again");
    await p.click("[data-fix-go]");
    const modal = p.locator("[data-fix-modal]");
    ok(await modal.count() === 1 && /Fix 1 issue\?/.test(await modal.textContent()) && /inv-a/.test(await modal.locator('[data-fix-models="investigators"]').textContent()) && /inv-b/.test(await modal.locator('[data-fix-models="investigators"]').textContent()) && /worker-model/.test(await modal.locator('[data-fix-models="worker"]').textContent()) && /its own Task/.test(await modal.textContent()), "Fix asks once, in the page: how many issues, both investigators' and the worker's models, a Task per issue", await modal.textContent());
    await p.click("[data-fix-cancel]");
    ok(!(await modal.count()) && sent.length === 0 && /1 selected/.test(await p.locator("[data-fix-bar]").textContent()), "cancelling sends nothing and keeps the pick");
    // everything filed, through one confirmation
    await p.locator(".is-fix-head .is-fix-all input").check();
    ok(new RegExp(`${PICKABLE.length} selected`).test(await p.locator("[data-fix-bar]").textContent()), `Select all filed issues picks every one that can be fixed (${PICKABLE.length}), in every active category`, await p.locator("[data-fix-bar]").textContent());
    await p.click("[data-fix-go]");
    ok(new RegExp(`Fix ${PICKABLE.length} issues\\?`).test(await modal.textContent()) && await modal.locator(`[data-fix-count="${PICKABLE.length}"]`).count() === 1, "over 100 issues still go through the one confirmation, which says how many");
    await p.click("[data-fix-confirm]"); await p.waitForTimeout(500);
    ok(sent.length === 1 && sent[0].issues.join() === PICKABLE.join() && !sent[0].issues.includes(13) && !sent[0].issues.includes(11) && !sent[0].issues.includes(18), "confirming sends the whole pick once: no issue under way, no needs-info one, none from a category waiting for approval", JSON.stringify(sent.map((x) => x.issues.length)));
    ok(!(await modal.count()) && !(await p.locator("[data-fix-bar]").count()) && new RegExp(`Started ${PICKABLE.length}`).test(await p.locator("[data-fix-note]").textContent()), "after it, the pick is cleared and the page says what started");
    await openCat(p, "C-1"); await row(16).locator("[data-fix-one]").click();
    ok(/Fix 1 issue\?/.test(await modal.textContent()), "a row's Fix button asks the same confirmation for that one issue");
    await p.keyboard.press("Escape");
    ok(!(await modal.count()) && sent.length === 1, "Escape closes it, sending nothing");
    await row(16).locator("[data-fix-one]").click(); await p.click("[data-fix-confirm]"); await p.waitForTimeout(400);
    ok(sent.length === 2 && sent[1].issues.join() === "16", "confirmed, it sends that one issue", JSON.stringify(sent[1]));
    await p.screenshot({ path: join(root, "tests/out/issue-fix-1440.png"), fullPage: false }).catch(() => {});
    await ctx.close(); }
  { const { ctx, p, sent } = await open(390, "zh-TW");
    ok(/1 張修復中 · 1 張要你判斷/.test(await p.locator('[data-cat="C-1"] > summary [data-fix-summary]').textContent()) && /全選所有已分類 issue/.test(await p.locator(".is-fix-head").textContent()), "390 zh-TW: the status line and Select all in Chinese");
    await openCat(p, "C-1"); await p.locator('[data-cat-issue="16"] [data-fix-pick]').check();
    ok(/已選 1 張/.test(await p.locator("[data-fix-bar]").textContent()) && /修復/.test(await p.locator("[data-fix-go]").textContent()) && await noSideways(p), "390: the bar says 已選 1 張 · 修復, with no sideways scroll");
    await p.click("[data-fix-go]");
    const box = await p.locator("[data-fix-modal]").boundingBox();
    ok(/修復 1 張 issue？/.test(await p.locator("[data-fix-modal]").textContent()) && /各開一個 Task/.test(await p.locator("[data-fix-modal]").textContent()) && box && box.x >= 0 && box.x + box.width <= 390 && await noSideways(p), "390: the confirmation fits the phone, in Chinese", JSON.stringify(box));
    await p.click("[data-fix-cancel]"); ok(sent.length === 0, "390: nothing sent without confirming");
    await p.screenshot({ path: join(root, "tests/out/issue-fix-390.png"), fullPage: false }).catch(() => {});
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  await browser.close(); app.kill();
}
console.log(`\nissue-fix-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
