import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Board's Issues view (public/issues.js; docs/units/board.md, "Issues"): a stored issue triage shown as work packages,
// the selected one's issues in order with their code location and repro; what the investigators disagreed on; the issues
// nobody investigated. Issue titles are untrusted text. At 1440 and 390 (zh-TW).
//   node tests/issues-ui.mjs        (ISSUES_SHOTS=<dir> puts the screenshots there; default tests/out/issues)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("issues-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-issues-ui-"));
mkdirSync(join(tmp, "data", "issue-triage"), { recursive: true });
const loc = (file, symbol) => [{ file, symbol, lines: "1-9" }];
const issue = (title, o = {}) => ({ title, labels: [], hash: "0".repeat(64), investigated: true, security: false, agree: true, diff: [], state: "present", tag: "url-string-compare", checked: true, ...o });
const record = {
  schema: 1, project: "fixture", repository: "fixture/wallet", commit: "c".repeat(40), snapshot: { hash: "h", fetchedAt: "2026-10-28T09:30:00Z" }, open: 6, investigated: [11, 12, 13, 14, 15],
  issues: {
    11: issue("Bridge trusts a page-supplied URL", { security: true, tag: "origin-not-bound-to-document", locus: loc("src/bridge/index.ts", "historyChange"), repro: "a page that reports another origin is still refused" }),
    12: issue("Replies reach the next page", { security: true, tag: "origin-not-bound-to-document", locus: loc("src/bridge/index.ts", "callSDK"), repro: "a reply started on page A never reaches page B" }),
    13: issue('Title with <img src=x onerror="window.__pwned=1"> markup', { locus: loc("src/utils/url.ts", "addParams"), tag: "url-building-bug", repro: "addParams keeps the fragment last" }),
    14: issue("Allowlist matches substrings", { state: "fixed?", security: true, locus: loc("src/web/helper.ts", "isAllowed"), repro: "none" }),
    15: issue("Navigation reuse", { agree: false, diff: ["security"], locus: loc("src/nav.ts", "toView") }),
    16: { title: "Research: batch signing", labels: [], hash: "1".repeat(64), investigated: false, security: false },
  },
  packages: [
    { id: "P-1", kind: "ordered", members: [11, 12], order: [11, 12], why: "Both decide which page a request really came from.", security: true, status: "approved", work: { 11: { proposal: "R-999", at: "2026-10-28T10:00:00Z" } } },
    { id: "P-2", kind: "single", members: [13], order: [13], why: "", security: false, status: "proposed" },
    { id: "P-3", kind: "recheck", members: [14], order: [14], why: "", security: true, status: "stale" },
  ],
  toHuman: [{ issues: [15], reason: "the reports disagree on, or the code check fails for, #15" }],
  createdAt: "2026-10-28T09:40:00Z", by: "issue-triage R-9",
};
writeFileSync(join(tmp, "data", "issue-triage", "fixture.json"), JSON.stringify(record));

const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "0", CREW_DATA: join(tmp, "data"),
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = process.env.ISSUES_SHOTS || join(root, "tests/out/issues"); mkdirSync(shots, { recursive: true });
async function open(width, lang = "en", hash = "#/board/issues", empty = false) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 } });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [lang]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (empty) await ctx.route(/\/api\/issue-triage$/, (r) => r.fulfill({ json: { projects: [] } }));
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e}`));
  await p.goto(`${base}/${hash}`); await p.waitForTimeout(600);
  return { ctx, p };
}
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector("#main").scrollWidth <= document.querySelector("#main").clientWidth + 1);
try {
  { const { ctx, p } = await open(1440, "en", "#/board");
    ok(await p.locator('.is-views a[href="#/board/issues"]').count() === 1 && await p.locator('.is-views a[aria-current="page"]').textContent() === "Tasks", "the Board shows a Tasks / Issues switch, Tasks current");
    await p.click('.is-views a[href="#/board/issues"]'); await p.waitForSelector("[data-pack]", { timeout: 8000 }).catch(() => {});
    ok(await p.locator("[data-pack]").count() === 3, "Issues lists the stored work packages");
    ok(/fixture\/wallet: 6 open, 5 investigated, 3 work packages/.test(await p.locator(".phead p").textContent()), "the header says the repository and the counts");
    ok(/ccccccc/.test(await p.locator(".is-page > p.faint").first().textContent()), "the view names the commit the code was read at");
    const steps = await p.$$eval('[data-detail="P-1"] .is-issue', (xs) => xs.map((x) => [x.dataset.issue, x.querySelector(".is-step").textContent, x.querySelector(".is-loc")?.textContent]));
    ok(steps.map((s) => s.slice(0, 2).join(":")).join(",") === "11:1,12:2" && steps[0][2] === "src/bridge/index.ts · historyChange", "the selected package lists its issues in order, each with its code location");
    ok(await p.locator('[data-detail="P-1"] a[href="https://github.com/fixture/wallet/issues/11"][target="_blank"][rel~="noopener"]').count() === 1, "each issue links to GitHub in a new tab");
    ok(/Ended without a merge/.test(await p.locator('[data-detail="P-1"] [data-issue="11"] .is-work').textContent()) && !(await p.locator('[data-detail="P-1"] [data-issue="12"] .is-work').count()), "an issue with a Task shows where it stands; one without shows nothing");
    ok(/work on P-1/.test(await p.locator('[data-detail="P-1"] .is-next').textContent()), "an approved package says how to start its next issue");
    ok(/referenced, not closed/.test(await p.locator('[data-detail="P-1"] .is-how').textContent()), "a security package says its issues close only after a recheck");
    await p.click('[data-pack="P-2"]');
    ok(await p.evaluate(() => !document.querySelector("#view img") && !window.__pwned && /<img src=x/.test(document.querySelector('[data-detail="P-2"] .is-title').textContent)), "an issue title with markup shows as text and runs nothing");
    await p.click('[data-pack="P-3"]');
    ok(/An issue changed: triage again/.test(await p.locator('[data-pack="P-3"]').textContent()) && /Waiting for approval/.test(await p.locator('[data-pack="P-2"]').textContent()), "each package says where it stands: waiting for approval, or stale because an issue changed");
    ok(/Do not change code/.test(await p.locator('[data-detail="P-3"] .is-how').textContent()), "a maybe-fixed issue is a recheck, not a close");
    await p.screenshot({ path: join(shots, "issues-1440.png"), fullPage: true });
    await p.click('[data-is-tab="human"]');
    ok(/#15/.test(await p.locator(".is-human").textContent()) && /disagree/.test(await p.locator(".is-human").textContent()), "what the investigators disagreed on is listed with the reason");
    await p.click('[data-is-tab="pending"]');
    ok(/Research: batch signing/.test(await p.locator(".is-pending").textContent()) && await p.locator(".is-pending li").count() === 1, "issues nobody investigated are listed");
    await ctx.close(); }
  { const { ctx, p } = await open(390, "zh-TW");
    ok(await p.locator("[data-pack]").count() === 3 && /工作包/.test(await p.locator(".tb-tabs").textContent()), "390 zh-TW: the packages show, in Chinese");
    ok(await noSideways(p), "390: no sideways scroll");
    await p.screenshot({ path: join(shots, "issues-390.png"), fullPage: true });
    await ctx.close(); }
  { const { ctx, p } = await open(1440, "en", "#/board/issues", true);
    ok(/No issue triage yet/.test(await p.locator("#view").textContent()), "with no triage the view says how to get one");
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  await browser.close(); app.kill();
}
console.log(`\nissues-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
