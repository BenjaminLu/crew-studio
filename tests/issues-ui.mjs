import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// A project's GitHub issues on its page (public/issues.js; docs/units/board.md, "Issues"): the batch form (how many issues,
// or which ones) and the investigators' models; the stored triage as work packages, the selected one's issues in order
// with their code location, repro and Task progress; what the investigators disagreed on; the issues nobody investigated.
// Issue titles are untrusted text. The Board has no Issues view. The Crew section shows each seat's model in this project.
// At 1440 and 390 (zh-TW). Nothing is started: the start route is answered by the test.
//   bun tests/issues-ui.mjs        (ISSUES_SHOTS=<dir> puts the screenshots there; default tests/out/issues)
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { grantSignature } from "../src/github-grant";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("issues-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = checkedTempDir("crew-issues-ui-"), data = join(tmp, "data");
mkdirSync(join(data, "issue-triage"), { recursive: true });
// two registered projects connected to GitHub (each grant signed as Connect signs it); vault has no triage yet
const connected = (id) => { const repo = join(tmp, id); mkdirSync(repo); assertTempRepo(repo);
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: repo, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).toString().trim();
  git("init", "-q", "-b", "main"); writeFileSync(join(repo, "README.md"), id); git("add", "README.md"); git("commit", "-q", "-m", "start"); git("remote", "add", "origin", `https://github.com/fixture/${id}.git`);
  const grant = { mode: "github", repository: `fixture/${id}`, localPath: repo, pushUrl: `https://github.com/fixture/${id}.git`, apiOrigin: "https://api.github.com", base: "main", branchPrefix: "crew/", approvedAt: "2026-10-28T00:00:00Z", approvalId: "R-1/SC-1" };
  grant.signature = grantSignature(data, { id, path: repo, base: "main" }, grant);
  return { id, name: id, path: repo, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, github: grant }; };
writeFileSync(join(data, "projects.json"), JSON.stringify([connected("wallet"), connected("vault")], null, 1));
const loc = (file, symbol) => [{ file, symbol, lines: "1-9" }];
const issue = (title, o = {}) => ({ title, labels: [], hash: "0".repeat(64), investigated: true, security: false, agree: true, diff: [], state: "present", tag: "url-string-compare", checked: true, ...o });
const record = {
  schema: 1, project: "wallet", repository: "fixture/wallet", commit: "c".repeat(40), snapshot: { hash: "h", fetchedAt: "2026-10-28T09:30:00Z" }, open: 6, investigated: [11, 12, 13, 14, 15],
  issues: {
    11: issue("Bridge trusts a page-supplied URL", { security: true, tag: "origin-not-bound-to-document", locus: loc("src/bridge/index.ts", "historyChange"), repro: "a page that reports another origin is still refused" }),
    12: issue("Replies reach the next page", { security: true, tag: "origin-not-bound-to-document", locus: loc("src/bridge/index.ts", "callSDK"), repro: "a reply started on page A never reaches page B" }),
    13: issue('Title with <img src=x onerror="window.__pwned=1"> markup', { locus: loc("src/utils/url.ts", "addParams"), tag: "url-building-bug", repro: "addParams keeps the fragment last" }),
    14: issue("Allowlist matches substrings", { state: "fixed?", security: true, locus: loc("src/web/helper.ts", "isAllowed"), repro: "none" }),
    15: issue("Navigation reuse", { agree: false, diff: ["security"], locus: loc("src/nav.ts", "toView") }),
    16: { title: "Research: batch signing", labels: [], hash: "1".repeat(64), investigated: false, security: false },
    17: issue("Share link loses its fragment", { state: "fixed?", locus: loc("src/utils/url.ts", "addParams"), tag: "url-building-bug" }),
    18: issue("Query string doubled on retry", { locus: loc("src/utils/url.ts", "addParams"), tag: "url-building-bug" }),
    20: issue("Crash report with no stack trace", { state: "not-found", locus: [], tag: "crash-report" }),
    21: issue("It does not work", { state: "needs-info", locus: [], tag: "unclear-report" }),
    22: issue("Rewrite the menu system", { fit: "human", fitReason: ["too-large"], locus: loc("src/menu.ts", "openMenu") }),
    23: issue("Saving fails", { duplicateOf: 70, locus: [], symptom: { here: { n: 23, text: 'TypeError <img src=x onerror="window.__pwned3=1"> in saveDraft', from: "comment (MEMBER)" }, there: { n: 70, text: "TypeError in saveDraft on save", from: "body" } } }),
    24: issue("Theme fallback", { inProgress: [40], locus: loc("src/theme.ts", "pickTheme") }),
  },
  packages: [
    { id: "P-1", kind: "ordered", members: [11, 12], order: [11, 12], why: "Both decide which page a request really came from.", security: true, status: "approved", commit: "c".repeat(40), work: { 11: { proposal: "R-999", at: "2026-10-28T10:00:00Z" } } },
    { id: "P-2", kind: "single", members: [13], order: [13], why: "", security: false, status: "proposed", commit: "c".repeat(40), investigators: { level: "same", by: "claude only", en: "Investigators ran on the same model; agreement is weaker evidence.", zh: "兩位調查員用同一個模型；兩份報告一致的證據力較弱。" } },
    { id: "P-3", kind: "recheck", members: [14], order: [14], why: "", security: true, status: "stale", commit: "c".repeat(40) },
    { id: "P-4", kind: "recheck", members: [17], order: [17], why: "", security: false, status: "proposed", commit: "c".repeat(40), match: { with: "P-2", where: "src/utils/url.ts · addParams" } },
  ],
  cross: [{ id: "X-1", issues: [18], package: { kind: "single", members: [18], order: [18], why: "", security: false, commit: "c".repeat(40) }, with: "P-2", where: "src/utils/url.ts · addParams" }], lastCross: 1, dedup: 2,
  toHuman: [{ issues: [15], reason: "the reports disagree on, or the code check fails for, #15" },
    { issues: [22], reason: "not an agent's work (too-large): a person takes it", kind: "human-fit", fit: ["too-large"], fitFrom: 1 },
    { issues: [23], reason: "both reports find #23 a duplicate of #70", kind: "duplicate", duplicateOf: 70 },
    { issues: [24], reason: "open pull request #40 names #24", kind: "in-progress", pulls: [40], pullInfo: [{ n: 40, author: "maintainer", association: "MEMBER" }] }],
  noCode: [{ issues: [20], state: "not-found", reason: "both investigators looked and could not find it in the code" },
    { issues: [21], state: "needs-info", reason: "the issue lacks what is needed to locate it", questions: { 21: ["Which version are you on?", 'What does <img src=x onerror="window.__pwned2=1"> show?'] } }],
  createdAt: "2026-10-28T09:40:00Z", by: "issue-triage R-9", lastPackage: 3,
};
writeFileSync(join(data, "issue-triage", "wallet.json"), JSON.stringify(record));
// the project's categories: two active, one waiting for approval (src/domain/issue-categories.ts)
mkdirSync(join(data, "issue-categories"), { recursive: true });
const cat = (id, name, scope, status) => ({ id, name, scope, status, createdAt: "2026-10-28T09:00:00Z", createdBy: "R-1 (claude m)" });
const asg = (category) => ({ category, by: "model", at: "2026-10-28T09:00:00Z" });
writeFileSync(join(data, "issue-categories", "wallet.json"), JSON.stringify({ schema: 1, project: "wallet", repository: "fixture/wallet", lastCategory: 3, updatedAt: "2026-10-28T09:00:00Z", runs: [],
  categories: [cat("C-1", "內嵌網頁", "內嵌網頁與它能呼叫的介面", "active"), cat("C-2", "URL 工具", "網址組裝與解析", "active"), cat("C-3", "推播", "推播與通知", "proposed")],
  assignments: { 11: asg("C-1"), 12: asg("C-1"), 16: asg("C-1"), 13: asg("C-2"), 17: asg("C-2"), 18: asg("C-3"), 19: { ...asg("PLANNED"), why: "a program task, not a defect", decidedBy: "captain (card) 2026-10-28T09:30:00Z" }, 20: { ...asg("PLANNED"), why: "a roadmap item", run: "R-2", pending: true } },
  titles: { 11: "Bridge trusts a page-supplied URL", 12: "Replies reach the next page", 13: 'Title with <img src=x onerror="window.__pwned=2"> markup', 17: "Share link loses its fragment", 18: "Query string doubled on retry", 19: "Program: quarterly release plan", 20: "Roadmap: move to the v3 API" } }));

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
const shots = process.env.ISSUES_SHOTS || join(root, "tests/out/issues"); mkdirSync(shots, { recursive: true });
const TEAM = { team: { version: 4, hash: "x" }, project: "wallet", seats: [
  { id: "maker", label: { en: "Maker", zh: "產出" }, member: { provider: "claude", model: "claude-opus-5-5", effort: "high", skills: [] }, uses: 3, project: null },
  { id: "reviewer", label: { en: "Reviewer", zh: "審查" }, member: { provider: "claude", model: "claude-opus-5-5", effort: "high", skills: [] }, uses: 2, project: { model: "claude-sonnet-5-5" } },
  { id: "designer", label: { en: "Designer", zh: "設計" }, member: null, uses: 0, project: null }], workflows: [], projects: [] };
async function open(width, lang = "en", hash = "#/project/wallet", o = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 } });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [lang]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(/\/api\/team\?project=wallet/, (r) => r.fulfill({ json: TEAM }));
  if (o.empty) await ctx.route(/\/api\/issue-triage\/wallet$/, (r) => r.fulfill({ json: { state: "none", investigators: { a: { provider: "claude", model: "claude-opus-5-5" }, b: { provider: "codex", model: "gpt-6" } } } }));
  if (o.oneModel) await ctx.route(/\/api\/issue-triage\/wallet$/, async (r) => { const j = await (await r.fetch()).json(); r.fulfill({ json: { ...j, investigators: { a: { provider: "claude", model: "only" }, b: { provider: "claude", model: "only" }, independence: { level: "same", allowed: true, note: { en: "Investigators ran on the same model; agreement is weaker evidence. Only one model is usable on this machine (claude only).", zh: "兩位調查員用同一個模型；兩份報告一致的證據力較弱。" } } } } }); });
  if (o.same) await ctx.route(/\/api\/issue-triage\/wallet$/, async (r) => { const j = await (await r.fetch()).json(); r.fulfill({ json: { ...j, investigators: { a: { provider: "claude", model: "same" }, b: { provider: "claude", model: "same" } } } }); });
  const posts = [], approvals = [], crosses = [], catCalls = [], declines = [], takes = [];
  await ctx.route(/\/api\/issue-triage\/wallet\/take$/, (r) => { takes.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ json: { ok: true, package: "P-9" } }); });
  await ctx.route(/\/api\/issue-triage\/wallet\/decline$/, (r) => { declines.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ json: { ok: true, declined: [] } }); });
  await ctx.route(/\/api\/issue-categories\/[a-z]+\/(start|edit)$/, (r) => { catCalls.push([r.request().url().split("/").slice(-2).join("/"), JSON.parse(r.request().postData() || "{}")]); r.fulfill({ json: { ok: true, task: "R-88", href: "#/run/R-88" } }); });
  await ctx.route(/\/api\/issue-triage\/wallet\/cross$/, (r) => { crosses.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ json: { ok: true, joined: "P-2" } }); });
  await ctx.route(/\/api\/issue-triage\/wallet\/approve$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); approvals.push(b); r.fulfill(o.refuseApprove ? { status: 409, json: { error: `${b.packages[0]} is approved, not waiting for approval` } } : { json: o.staleApprove ? { ok: true, approved: [], stale: b.packages } : { ok: true, approved: b.packages, stale: [] } }); });
  await ctx.route(/\/api\/issue-triage\/wallet\/start$/, (r) => { posts.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ json: { ok: true, task: "R-77", href: "#/run/R-77" } }); });
  if (o.court) await o.court(ctx);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e}`));
  await p.goto(`${base}/${hash}`); await p.waitForTimeout(800);
  return { ctx, p, posts, approvals, crosses, catCalls, declines, takes };
}
// the disagreement court of one triage (public/court.js): a docket served by the test, the rulings it sends recorded
const SHA = "d".repeat(40), okSide = (file, o = {}) => ({ state: "present", locus: [{ file, symbol: "match", lines: "2-3" }], ok: true, problems: [], repro: "a shorter prefix matches", security: false,
  excerpts: [{ file, start: 1, lines: ["export const match = (url) =>", "  list.find((d) => d.url.startsWith(url))", "}"], quoted: [2] }], ...o });
const DOCKET = { schema: 1, project: "wallet", repository: "fixture/wallet", commit: SHA, by: { a: "claude claude-opus-5-5", b: "codex gpt-6" }, run: "R-50", status: "waiting", waiting: true, card: "SC-7", ruled: [],
  issues: { 31: { title: 'Match <img src=x onerror="window.__pwned=3"> prefix', labels: [] }, 32: { title: "Menu hidden items", labels: [] }, 33: { title: "Menu order", labels: [] }, 34: { title: "Same crash again", labels: [] } },
  cases: [
    { id: "C-1", kind: "finding", issues: [31], diff: ["location"], reason: "the reports disagree", agreed: { 31: null }, a: { 31: okSide("src/url.ts") }, b: { 31: okSide("src/other.ts", { ok: false, problems: ["quoted code not found: list.find"] }) } },
    { id: "C-2", kind: "package", issues: [32, 33], diff: ["package"], reason: "the reports put these in different packages", agreed: { 32: { state: "present" }, 33: { state: "present" } },
      a: { 32: okSide("src/menu.ts"), 33: okSide("src/menu.ts") }, b: { 32: okSide("src/menu.ts"), 33: okSide("src/menu.ts") },
      groupings: { a: [{ members: [32, 33], order: [], kind: "unordered", joins: [] }], b: [{ members: [32], order: [32], kind: "single", joins: [] }, { members: [33], order: [33], kind: "single", joins: [] }], separate: [{ members: [32], order: [32], kind: "single", joins: [] }, { members: [33], order: [33], kind: "single", joins: [] }] } },
    { id: "C-3", kind: "duplicate", issues: [34], diff: ["duplicate"], reason: "both find #34 a duplicate of #12", duplicateOf: 12, agreed: { 34: { state: "present" } }, a: { 34: okSide("src/url.ts", { duplicateOf: 12, symptom: { here: "crash <i>in</i> saveDraft", there: "crash in saveDraft" } }) }, b: { 34: okSide("src/url.ts", { duplicateOf: 12 }) } }] };
const courtRoutes = (sent, asked) => async (ctx) => {
  await ctx.route(/\/api\/issue-triage\/wallet\/court\/R-50(\?.*)?$/, (r) => { if (r.request().method() === "POST") { sent.push(JSON.parse(r.request().postData() || "{}")); return r.fulfill({ json: { ok: true, task: "R-50", ruled: 3, href: "#/run/R-50" } }); } return r.fulfill({ json: DOCKET }); });
  await ctx.route(/\/api\/issue-triage\/wallet\/court\/R-50\/issue\/31$/, (r) => r.fulfill({ json: { n: 31, title: DOCKET.issues[31].title, body: 'Steps <script>window.__pwned=4</script> then <img src=x onerror="window.__pwned=5">', labels: ["bug"], author: "someone", association: "NONE", comments: [{ author: "x", association: "MEMBER", at: "2026-10-28T10:00:00Z", body: "<b>seen</b> on 3.8" }], url: "https://github.com/fixture/wallet/issues/31" } }));
  await ctx.route(/\/api\/issue-triage\/wallet\/court\/R-50\/file\?/, (r) => { asked.push(new URL(r.request().url()).searchParams.get("path")); r.fulfill({ json: { path: "src/url.ts", commit: SHA, size: 90, text: Array.from({ length: 80 }, (_, i) => i === 1 ? "  list.find((d) => d.url.startsWith(url))" : `// line ${i + 1} <i>x</i>`).join("\n") } }); }); };
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector("#main").scrollWidth <= document.querySelector("#main").clientWidth + 1);
try {
  { const { ctx, p } = await open(1440, "en", "#/board");
    ok(await p.locator(".is-views").count() === 0 && !(await p.locator('a[href="#/board/issues"]').count()), "the Board shows Tasks only: issues live on their project's page");
    await ctx.close(); }
  { const { ctx, p, posts, approvals, crosses, declines, takes } = await open(1440);
    const openCat = async (id) => { await p.waitForSelector(`[data-cat="${id}"]`, { timeout: 8000 }); if (!(await p.locator(`[data-cat="${id}"]`).evaluate((e) => e.open))) await p.click(`[data-cat="${id}"] summary`); };
    await p.waitForSelector('[data-project-issues="wallet"] [data-pack]', { timeout: 8000 }).catch(() => {});
    ok(await p.locator('.pj-jump a[href="#s-issues"]').count() === 1, "a connected project's page has an Issues section to jump to");
    ok(await p.locator('[data-project-issues="wallet"] [data-pack]').count() === 4, "the project's stored work packages are listed on its page, each once");
    ok(/2 repeat fixes avoided/.test(await p.locator('[data-project-issues="wallet"] .sec-head').textContent()), "the heading counts the repeat fixes the cross-batch match avoided");
    ok(/6 open · 4 work packages/.test(await p.locator('[data-project-issues="wallet"] .sec-head').textContent()) && !/investigated/.test(await p.locator('[data-project-issues="wallet"] .sec-head').textContent()), "the section heading says the counts, with no project-wide not-investigated count");
    ok(!(await p.locator('[data-is-tab], .is-pending').count()) && !/Not investigated/.test(await p.locator('[data-project-issues="wallet"]').textContent()), "there are no project-wide tabs and no list of issues nobody investigated: a category's triage button takes them");
    // each package and each item to judge sits with the category its issues are in; the rest after the categories
    ok(await p.locator('[data-cat="C-1"] [data-tri="C-1"] [data-pack="P-1"]').count() === 1 && await p.locator('[data-tri="C-2"] [data-pack]').count() === 2 && await p.locator('[data-tri="C-3"] [data-cross="X-1"]').count() === 1, "packages and matches are shown in their issues' category");
    ok(await p.locator('[data-tri-other] [data-pack="P-3"]').count() === 1 && /#15/.test(await p.locator('[data-tri-other] .is-human').textContent()), "triage of issues no category holds is shown after the categories");
    ok(await p.locator('[data-cat="C-1"] [data-cat-issue="11"] [data-cat-pack="P-1"]').count() === 1, "a category's issue line names its work package");
    ok(/ccccccc/.test(await p.locator('[data-tri-other] p.faint').first().textContent()), "the section names the commit the code was read at");
    ok(await p.locator("[data-issue-size]").inputValue() === "15" && /Investigators: claude .* and codex /.test(await p.locator("[data-investigators]").textContent()) && /codex/.test(await p.locator("[data-investigators]").textContent()), "the batch form offers a size (15 by default) and names both investigators' models");
    await openCat("C-1"); await p.click('[data-tri="C-1"] [data-pack="P-1"]');
    const steps = await p.$$eval('[data-detail="P-1"] .is-issue', (xs) => xs.map((x) => [x.dataset.issue, x.querySelector(".is-step").textContent, x.querySelector(".is-loc")?.textContent]));
    ok(steps.map((s) => s.slice(0, 2).join(":")).join(",") === "11:1,12:2" && steps[0][2] === "src/bridge/index.ts · historyChange", "the selected package lists its issues in order, each with its code location");
    ok(await p.locator('[data-detail="P-1"] a[href="https://github.com/fixture/wallet/issues/11"][target="_blank"][rel~="noopener"]').count() === 1, "each issue links to GitHub in a new tab");
    { const how = await p.locator('[data-detail="P-1"] .is-how').textContent();
      ok(/Nothing goes to GitHub/.test(how) && /stops reviewed on its local branch/.test(how) && /no push and no pull request/.test(how) && /commits name no issue/.test(how), "a package says its Tasks never go to GitHub: each stops on its local branch, and its commits name no issue", how); }
    ok(/Ended without a merge/.test(await p.locator('[data-detail="P-1"] [data-issue="11"] .is-work').textContent()) && !(await p.locator('[data-detail="P-1"] [data-issue="12"] .is-work').count()), "an issue with a Task shows where it stands; one without shows nothing");
    ok(/work on P-1/.test(await p.locator('[data-detail="P-1"] .is-next').textContent()), "an approved package says how to start its next issue");
    ok(/An issue changed: triage again/.test(await p.locator('[data-pack="P-3"]').textContent()) && /Waiting for approval/.test(await p.locator('[data-pack="P-2"]').textContent()), "each package says where it stands");
    ok(!(await p.locator('[data-detail="P-1"] [data-approve], [data-detail="P-1"] [data-decline]').count()), "an approved package offers no approval and no decline");
    await openCat("C-2"); await p.click('[data-tri="C-2"] [data-pack="P-2"]');
    ok(/same model; agreement is weaker evidence\. \(claude only\)/.test(await p.locator('[data-detail="P-2"] [data-weak-evidence="P-2"]').textContent()) && await p.locator('[data-detail="P-1"] [data-weak-evidence]').count() === 0, "a package from two reports on one model says its agreement is weaker evidence");
    ok(await p.locator('[data-detail="P-2"] [data-approve="P-2"]').count() === 1 && await p.locator('[data-detail="P-2"] [data-decline="P-2"]').count() === 1 && /reads its issues again/.test(await p.locator('[data-detail="P-2"] .is-approve').textContent()), "a package waiting for approval can be approved or declined on the page");
    await p.click('[data-approve="P-2"]'); await p.waitForTimeout(400);
    ok(approvals.length === 1 && approvals[0].packages.join() === "P-2" && /Approved P-2/.test(await p.locator('[data-project-issues="wallet"] [role="status"]').textContent()), "approving sends that package and says it was approved", JSON.stringify(approvals));
    await openCat("C-2"); if (!(await p.locator('[data-detail="P-2"]').count())) await p.click('[data-tri="C-2"] [data-pack="P-2"]');
    ok(await p.evaluate(() => !document.querySelector("#view img") && !window.__pwned && /<img src=x/.test(document.querySelector('[data-detail="P-2"] .is-title').textContent)), "an issue title with markup shows as text and runs nothing");
    await p.click('[data-tri="C-2"] [data-pack="P-4"]'); await p.click('[data-decline="P-4"]'); await p.waitForTimeout(400);
    ok(declines.length === 1 && declines[0].packages.join() === "P-4" && /Declined P-4/.test(await p.locator('[data-project-issues="wallet"] [role="status"]').textContent()), "declining sends that package and says its issues are triaged again", JSON.stringify(declines));
    await p.click('[data-tri-other] [data-pack="P-3"]');
    ok(/Do not change code/.test(await p.locator('[data-detail="P-3"] .is-how').textContent()) && await p.locator('[data-detail="P-3"] [data-decline="P-3"]').count() === 1, "a maybe-fixed issue is a recheck, not a close; a stale package can be declined");
    ok(/changed for this project/.test(await p.locator('[data-seat="reviewer"]').textContent()) && /claude-sonnet-5-5/.test(await p.locator('[data-seat="reviewer"]').textContent()) && /claude-opus-5-5/.test(await p.locator('[data-seat="maker"]').textContent()) && !(await p.locator('[data-seat="designer"]').count()), "the Crew section lists each seat's model as this project runs it, marking this project's own changes");
    await p.screenshot({ path: join(shots, "project-issues-1440.png"), fullPage: true });
    await openCat("C-2"); await p.click('[data-tri="C-2"] [data-pack="P-4"]');
    ok(/same function as P-2/.test(await p.locator('[data-detail="P-4"] .is-match').textContent()) && /src\/utils\/url\.ts · addParams/.test(await p.locator('[data-detail="P-4"] .is-match').textContent()), "a recheck made by the cross-batch match says which earlier package and function it shares");
    await openCat("C-3");
    ok(/#18/.test(await p.locator('[data-cross="X-1"]').textContent()) && /same function as P-2/.test(await p.locator('[data-cross="X-1"]').textContent()), "a cross-batch match waits for the captain in its category, naming the earlier package and the function");
    await p.click('[data-cross="X-1"] [data-cross-join]'); await p.waitForTimeout(300);
    ok(crosses.length === 1 && crosses[0].id === "X-1" && crosses[0].action === "join", "joining sends that match to be joined", JSON.stringify(crosses));
    ok(/disagree/.test(await p.locator('[data-tri-other] .is-human').textContent()), "what the investigators disagreed on is listed with the reason");
    { const none = await p.locator('[data-tri-other] [data-no-code] [data-no-code-state="not-found"]').textContent().catch(() => "");
      ok(/#20/.test(none) && /needs more information|需要更多資訊/.test(none) && !/#20/.test(await p.locator('[data-tri-other] .is-human').textContent()), "issues both investigators could not find in the code are listed as agreed, needing information, not as a disagreement", none); }
    { const ask = await p.locator('[data-tri-other] [data-no-code] [data-no-code-state="needs-info"]').textContent().catch(() => ""), sent = posts.length;
      ok(/#21/.test(ask) && /Which version are you on\?/.test(ask) && /<img src=x/.test(ask) && !(await p.evaluate(() => window.__pwned2)) && await p.locator('[data-no-code-state="needs-info"] [data-questions="21"] li').count() === 2, "a needs-info issue is listed as agreed with its questions for the reporter, as text", ask);
      ok(/nothing is posted to GitHub|不會貼到 GitHub/.test(ask) && posts.length === sent && await p.locator('[data-no-code-state="needs-info"] button').count() === 0, "the questions are shown only in Studio: nothing on the page posts them anywhere", ask); }
    { const kind = async (k) => p.locator(`[data-tri-other] .is-human [data-human-kind="${k}"]`).textContent().catch(() => "");
      const fit = await kind("human-fit"), dup = await kind("duplicate"), busy = await kind("in-progress");
      ok(/#22/.test(fit) && /too large|太大/.test(fit) && /#23/.test(dup) && /#70/.test(dup) && /#24/.test(busy) && await p.locator('[data-human-kind="in-progress"] a[href="https://github.com/fixture/wallet/pull/40"]').count() === 1, "a person's issue says why (too large), a duplicate names the issue it repeats, and one in progress links its open pull request", JSON.stringify([fit, dup, busy])); }
    { const kind = async (k) => p.locator(`[data-tri-other] .is-human [data-human-kind="${k}"]`).textContent().catch(() => "");
      const fit = await kind("human-fit"), dup = await kind("duplicate"), busy = await kind("in-progress");
      ok(/one investigator|一位調查員/.test(fit), "a person's issue says whether one investigator or both said so", fit);
      ok(/in saveDraft/.test(dup) && /comment \(MEMBER\)/.test(dup) && /TypeError in saveDraft on save/.test(dup) && /<img src=x/.test(dup) && !(await p.evaluate(() => window.__pwned3)), "a duplicate shows the symptom quoted from each issue and where it was found, as text", dup);
      ok(/maintainer/.test(busy) && /MEMBER/.test(busy), "an in-progress issue names the pull request's author", busy);
      await p.click('[data-human-kind="in-progress"] [data-take="24"]'); await p.waitForTimeout(300);
      ok(takes.length === 1 && takes[0].issue === 24, "the captain can take an in-progress issue anyway: it sends that issue to become a package", JSON.stringify(takes)); }
    await p.fill("[data-issue-numbers]", "12, x"); await p.click("[data-issue-triage]"); await p.waitForTimeout(200);
    ok(posts.length === 0 && /whole numbers/.test(await p.locator('[data-issue-start] [role="alert"]').textContent()), "issue numbers that are not numbers are refused before anything is sent");
    await p.goto(`${base}/#/project/vault`); await p.waitForSelector('[data-project-issues="vault"] [data-issue-start]', { timeout: 8000 }).catch(() => {});
    ok(await p.locator('[data-project-issues="vault"] [data-issue-numbers]').inputValue() === "" && !(await p.locator('[data-project-issues="vault"] [role="alert"]').count()), "another project's form starts empty: numbers and errors stay with their project");
    await p.goto(`${base}/#/project/wallet`); await p.waitForSelector('[data-project-issues="wallet"] [data-issue-start]');
    await p.fill("[data-issue-numbers]", ""); await p.fill("[data-issue-size]", ""); await p.evaluate(() => render()); await p.waitForTimeout(100);
    await p.locator("[data-issue-size]").pressSequentially("30"); await p.evaluate(() => render()); await p.waitForTimeout(100);
    ok(await p.locator("[data-issue-size]").inputValue() === "30", "the batch size field keeps what is typed while the page redraws", await p.locator("[data-issue-size]").inputValue());
    await p.click("[data-issue-triage]"); await p.waitForTimeout(400);
    ok(posts.length === 1 && posts[0].size === 30 && posts[0].issues.length === 0 && /#\/run\/R-77/.test(await p.evaluate(() => location.hash)), "triaging sends the batch size the captain chose and opens the Task, whose card shows the batch", JSON.stringify(posts));
    await p.goto(`${base}/#/project/wallet`); await p.waitForSelector('[data-project-issues="wallet"] [data-issue-start]'); await p.fill("[data-issue-size]", "70"); await p.click("[data-issue-triage]"); await p.waitForTimeout(300);
    ok(posts.length === 1 && /1 to 50/.test(await p.locator('[data-project-issues="wallet"] [role="alert"]').textContent()), "a batch over 50 is refused before anything is sent");
    await ctx.close(); }
  { const { ctx, p, posts, catCalls } = await open(1440);
    await p.waitForSelector('[data-categories="wallet"] [data-cat="C-1"]', { timeout: 8000 }).catch(() => {});
    const head = await p.locator('[data-categories="wallet"] .is-cat-head').textContent();
    ok(/2 categories · 6 issues filed/.test(head) && /1 new category waits/.test(await p.locator('[data-categories="wallet"]').textContent()), "the categories card says how many categories and filed issues, and what waits for approval", head);
    ok(await p.locator('[data-categories="wallet"] [data-cat]').count() === 3 && /Waiting for approval/.test(await p.locator('[data-cat="C-3"] summary').textContent()) && !(await p.locator('[data-cat="C-3"] [data-cat-triage]').count()), "each category is listed; one waiting for approval cannot be acted on yet");
    await p.click('[data-cat="C-2"] summary');
    ok(await p.evaluate(() => !document.querySelector("[data-categories] img") && !window.__pwned && /<img src=x/.test(document.querySelector('[data-cat-issue="13"] .is-title').textContent)), "a category's issue titles show as text and run nothing");
    await p.click('[data-cat="C-1"] summary'); await p.click('[data-cat-triage="C-1"]'); await p.waitForTimeout(300);
    ok(posts.length === 1 && posts[0].issues.join() === "16" && posts[0].size === 1 && /\(1\)/.test(await p.locator('[data-cat-triage="C-1"]').textContent().catch(() => "(1)")), "triaging a category sends only its issues not triaged yet", JSON.stringify(posts));
    await p.goto(`${base}/#/project/wallet`); await p.waitForSelector('[data-cat="C-3"]'); await p.click('[data-cat="C-3"] summary');
    await p.click('[data-cat-approve="C-3"]'); await p.waitForTimeout(300);
    ok(catCalls.some(([u, b]) => u.endsWith("edit") && b.op === "approve" && b.ids.join() === "C-3") && await p.locator('[data-cat-decline="C-3"]').count() === 1, "a category waiting for approval is approved or declined right on the page", JSON.stringify(catCalls));
    await p.goto(`${base}/#/project/wallet`); await p.waitForSelector('[data-cat="C-1"]');
    if (!(await p.locator('[data-cat="C-1"]').evaluate((e) => e.open))) await p.click('[data-cat="C-1"] summary');
    { const done = await p.evaluate(() => { const b = document.querySelector('[data-cat-triage="C-2"]'); return b ? [b.disabled, b.textContent] : null; });
      ok(done && done[0] === true && /triaged/.test(done[1]), "a category whose issues are all triaged says so and cannot be sent again", JSON.stringify(done)); }
    ok(await p.locator('[data-cat="C-1"]').evaluate((e) => e.open), "an opened category stays open when the page redraws");
    await p.click('[data-cat-rename="C-1"]'); await p.fill('[data-cat-name="C-1"]', "內嵌網頁與介面"); await p.click('[data-cat-save="C-1"]'); await p.waitForTimeout(300);
    await p.selectOption('[data-cat-move="11"]', "C-2").catch(() => {}); await p.waitForTimeout(300);
    if (!(await p.locator('[data-cat="C-2"]').evaluate((e) => e.open))) await p.click('[data-cat="C-2"] summary');
    await p.selectOption('[data-cat-merge="C-2"]', "C-1").catch(() => {}); await p.waitForTimeout(300);
    // planned work: a Studio tag apart from the categories, never counted as filed
    ok(/1/.test(await p.locator('[data-cat-planned] summary').textContent()) && /Planned work/.test(await p.locator('[data-cat-planned] summary').textContent()) && !(await p.locator('[data-cat] [data-cat-issue="19"]').count()), "planned work is listed apart from the categories");
    if (!(await p.locator('[data-cat-planned]').evaluate((e) => e.open))) await p.click('[data-cat-planned] summary');
    ok(/a program task, not a defect/.test(await p.locator('[data-cat-planned] [data-cat-issue="19"]').textContent()), "each planned issue says why it was set aside");
    // what a run proposed as planned waits for the captain: marked, not counted, set aside or filed from here
    const w20 = p.locator('[data-cat-planned] [data-cat-issue="20"]');
    ok(await p.locator('[data-cat-planned-waiting="1"]').count() === 1 && await w20.getAttribute("data-cat-pending") === "1" && /waiting for approval/.test(await w20.textContent()) && /a roadmap item/.test(await w20.textContent()), "planned work a run proposed is listed as waiting for approval, with its why");
    ok(await w20.locator(".is-proposed").count() === 1 && await w20.locator(".is-sec").count() === 0 && await p.locator('[data-cat-planned-waiting="1"].is-proposed').count() === 1, "a proposal is marked as waiting, never styled as a security flag");
    await p.click('[data-cat-plan="20"]'); await p.waitForTimeout(300);
    ok(catCalls.some(([u, b]) => u.endsWith("edit") && b.op === "move" && b.n === 20 && b.to === "PLANNED"), "Set it aside approves it from the page");
    await p.click('[data-cat-unplan="19"]'); await p.waitForTimeout(300);
    if (!(await p.locator('[data-cat="C-1"]').evaluate((e) => e.open))) await p.click('[data-cat="C-1"] summary');
    await p.selectOption('[data-cat-move="12"]', "PLANNED").catch(() => {}); await p.waitForTimeout(300);
    if (!(await p.locator('[data-cat="C-3"]').evaluate((e) => e.open))) await p.click('[data-cat="C-3"] summary');
    ok(await p.locator('[data-cat-move="18"] option[value="PLANNED"]').count() === 1, "an issue in a category waiting for approval can be tagged planned too");
    const edits = catCalls.filter(([u]) => u.endsWith("edit")).map(([, b]) => b);
    ok(edits.some((b) => b.op === "unplan" && b.n === 19) && edits.some((b) => b.op === "move" && b.n === 12 && b.to === "PLANNED"), "the captain takes an issue off planned, or tags one as planned, on the page", JSON.stringify(edits));
    ok(edits.some((b) => b.op === "rename" && b.id === "C-1" && b.name === "內嵌網頁與介面") && edits.some((b) => b.op === "move" && b.n === 11 && b.to === "C-2") && edits.some((b) => b.op === "merge" && b.id === "C-2" && b.into === "C-1"), "the captain renames, moves an issue and merges categories on the page", JSON.stringify(edits));
    await p.click('[data-cat-start="wallet"]'); await p.waitForTimeout(300);
    ok(catCalls.some(([u]) => u === "wallet/start") && /#\/run\/R-88/.test(await p.evaluate(() => location.hash)), "filing new issues starts a run and opens it");
    await p.goto(`${base}/#/project/vault`); await p.waitForSelector('[data-categories="vault"] [data-cat-empty]', { timeout: 8000 }).catch(() => {});
    ok(/No categories yet/.test(await p.locator('[data-categories="vault"]').textContent()) && /Build categories/.test(await p.locator('[data-cat-start="vault"]').textContent()), "a project with no categories offers to build them");
    await ctx.close(); }
  { const { ctx, p, approvals } = await open(1440, "en", "#/project/wallet", { staleApprove: true });
    await p.waitForSelector('[data-cat="C-2"]'); await p.click('[data-cat="C-2"] summary'); await p.click('[data-tri="C-2"] [data-pack="P-2"]'); await p.click('[data-approve="P-2"]'); await p.waitForTimeout(400);
    ok(approvals.length === 1 && /P-2 is stale/.test(await p.locator('[data-project-issues="wallet"] [role="status"]').textContent()), "a package whose issue changed is reported stale, not approved");
    await ctx.close(); }
  { const { ctx, p } = await open(1440, "en", "#/project/wallet", { refuseApprove: true });
    await p.waitForSelector('[data-cat="C-2"]'); await p.click('[data-cat="C-2"] summary'); await p.click('[data-tri="C-2"] [data-pack="P-2"]'); await p.click('[data-approve="P-2"]'); await p.waitForTimeout(400);
    const said = await p.locator('[data-project-issues="wallet"] [role="status"]').textContent();
    ok(/not waiting for approval/.test(said) && !/stale/.test(said), "a refused approval says why, and never calls the package stale", said);
    await ctx.close(); }
  { const { ctx, p, posts } = await open(1440, "en", "#/project/wallet", { same: true });
    await p.waitForSelector("[data-issue-triage]");
    ok(await p.locator("[data-issue-triage]").isDisabled() && /different models/.test(await p.locator("[data-investigators]").textContent()) && posts.length === 0, "when both investigators would run on one model, the form says so and cannot start");
    await ctx.close(); }
  { const { ctx, p } = await open(1440, "en", "#/project/wallet", { oneModel: true });
    await p.waitForSelector("[data-issue-triage]");
    ok(!(await p.locator("[data-issue-triage]").isDisabled()) && /claude only, twice\. Investigators ran on the same model; agreement is weaker evidence\. Only one model is usable/.test(await p.locator('[data-weak-evidence="start"]').textContent()), "when one model is all this machine can run, the form starts on it and says the agreement is weaker evidence");
    await ctx.close(); }
  { const { ctx, p } = await open(390, "zh-TW");
    await p.waitForSelector('[data-project-issues="wallet"] [data-pack]', { timeout: 8000 }).catch(() => {});
    ok(await p.locator('[data-project-issues="wallet"] [data-pack]').count() === 4 && /分診/.test(await p.locator('[data-issue-start]').textContent()) && !/分類/.test(await p.locator('[data-issue-start]').textContent()) && /工作包/.test(await p.locator('[data-project-issues="wallet"] .sec-head').textContent()) && /這批要分診幾張/.test(await p.locator("[data-issue-start]").textContent()), "390 zh-TW: the packages and the batch form show, in Chinese");
    ok(await noSideways(p), "390: no sideways scroll");
    await p.screenshot({ path: join(shots, "project-issues-390.png"), fullPage: true });
    await ctx.close(); }
  { const { ctx, p } = await open(1440, "en", "#/project/wallet", { empty: true });
    await p.waitForSelector("[data-issues-empty]", { timeout: 8000 }).catch(() => {});
    ok(/No triage of fixture\/wallet yet/.test(await p.locator('[data-project-issues="wallet"]').textContent()) && await p.locator("[data-issue-triage]").count() === 1, "with no triage the section says how to start one, with the form");
    await ctx.close(); }
  // --- the disagreement court: one case per screen, popups, keys, the rulings sent once, nothing to GitHub ---
  { const sent = [], asked = [], requests = [];
    const { ctx, p } = await open(1440, "en", "#/court/wallet/R-50", { court: courtRoutes(sent, asked) });
    p.on("request", (q) => requests.push(`${q.method()} ${q.url()}`));
    await p.evaluate(() => { try { sessionStorage.clear(); } catch {} }); await p.reload(); await p.waitForSelector("[data-court-case]", { timeout: 8000 }).catch(() => {});
    ok(await p.locator("[data-court-case]").count() === 1 && await p.locator('[data-court-case="C-1"]').count() === 1 && await p.locator("[data-court-side]").count() === 2, "the court shows one case per screen, both sides");
    ok(await p.evaluate(() => !document.querySelector("#view img") && !window.__pwned && /<img src=x/.test(document.querySelector(".ct-title").textContent)), "an issue title with markup shows as text");
    ok(/The place differs/.test(await p.locator("[data-court-diff]").textContent()) && /A: still there · src\/url\.ts/.test(await p.locator("[data-court-crux]").textContent()) && /B: still there · src\/other\.ts/.test(await p.locator("[data-court-crux]").textContent()), "the disagreement is named and set out, A against B");
    ok(await p.locator('[data-court-side="a"] .ct-code .q').count() === 1 && /startsWith/.test(await p.locator('[data-court-side="a"] .ct-code .q').textContent()) && /quoted code not found/.test(await p.locator('[data-court-side="b"] .ct-chk.bad').textContent()) && await p.locator('[data-court-side="a"] .ct-chk.ok').count() >= 3, "each side shows its checked code with the quoted line marked, and Studio's check", "");
    ok(!/recommend|suggest(ed|ion):|建議採用/i.test(await p.locator("#view").textContent()), "no suggestion is shown");
    ok(await p.locator('[data-court-pick="b"]').isDisabled(), "a side Studio's check refused cannot be adopted");
    await p.screenshot({ path: join(shots, "court-case-1440.png") });
    // the issue popup: the snapshot's text and comments as text, a GitHub link; Escape closes it, focus back on its button
    await p.click('[data-court-issue="31"]'); await p.waitForSelector("[data-court-no-comments], .ct-cm .ct-text", { timeout: 4000 }).catch(() => {});
    ok(await p.locator(".ct-modal[role=dialog]").count() === 1 && /<script>window.__pwned=4<\/script>/.test(await p.locator(".ct-modal .ct-body").textContent()) && /<b>seen<\/b> on 3.8/.test(await p.locator(".ct-modal .ct-body").textContent()) && await p.evaluate(() => !document.querySelector(".ct-modal img, .ct-modal script, .ct-body b") && !window.__pwned), "the issue popup shows the text and comments as text, and runs nothing", await p.evaluate(() => JSON.stringify([document.querySelectorAll(".ct-modal").length, document.querySelector(".ct-modal .ct-body")?.textContent, window.__pwned, document.querySelector(".ct-modal img, .ct-modal script, .ct-body b")?.outerHTML])));
    ok(await p.locator('.ct-modal a[data-court-gh]').getAttribute("href") === "https://github.com/fixture/wallet/issues/31" && await p.locator('.ct-modal a[data-court-gh]').getAttribute("target") === "_blank", "the issue popup links to the issue on GitHub, in a new tab");
    await p.keyboard.press("1");
    ok(await p.locator('[data-court-case="C-1"]').count() === 1, "a key pressed while a popup is open rules nothing");
    await p.keyboard.press("Escape");
    ok(await p.locator(".ct-modal").count() === 0 && await p.evaluate(() => document.activeElement?.dataset?.courtIssue === "31"), "Escape closes the popup and gives focus back");
    // the file popup: the file at the pinned commit, scrolled to the quoted lines; the backdrop closes it
    await p.click('[data-court-side="a"] [data-court-excerpt]'); await p.waitForSelector('.ct-file [data-line="2"]', { timeout: 4000 }).catch(() => {});
    ok(asked.join() === "src/url.ts" && await p.locator('.ct-file [data-line="2"].q').count() === 1 && await p.locator(".ct-file .q").count() === 1 && await p.evaluate(() => !document.querySelector(".ct-file i")), "the file popup reads the file at the pinned commit and marks the quoted line; its text stays text");
    ok(await p.locator('.ct-modal a[data-court-gh]').getAttribute("href") === `https://github.com/fixture/wallet/blob/${SHA}/src/url.ts#L2`, "the file popup links to those lines on GitHub at the pinned commit", await p.locator('.ct-modal a[data-court-gh]').getAttribute("href"));
    await p.mouse.click(5, 5); await p.waitForTimeout(100);
    ok(await p.locator(".ct-modal").count() === 0, "clicking the backdrop closes the popup");
    await p.click('[data-court-side="b"] [data-court-file="src/other.ts"]'); await p.waitForTimeout(200);
    ok(asked.at(-1) === "src/other.ts" && await p.locator(".ct-modal").count() === 1, "the locus opens its file too"); await p.keyboard.press("Escape");
    // keys: 2 is refused here, 1 rules, Z undoes, R goes to the reason, Enter leaves it
    await p.keyboard.press("2"); ok(await p.locator('[data-court-case="C-1"]').count() === 1, "the key of a side that cannot be adopted rules nothing");
    await p.keyboard.press("1"); ok(await p.locator('[data-court-case="C-2"]').count() === 1, "1 rules the case and the next one is shown");
    ok(/A's grouping/.test(await p.locator('[data-court-pick="a"]').textContent()) && /All separate/.test(await p.locator('[data-court-pick="separate"]').textContent()) && /#32\s*#33/.test(await p.locator('[data-court-grouping="a"]').textContent()), "a grouping case offers A's grouping, B's, all separate or needs information, and shows each grouping");
    await p.keyboard.press("z"); ok(await p.locator('[data-court-case="C-1"]').count() === 1, "Z undoes the last ruling");
    await p.keyboard.press("r"); ok(await p.evaluate(() => document.activeElement?.dataset?.courtReason === "1"), "R goes to the reason");
    await p.keyboard.type("A reads the code path that runs"); await p.keyboard.press("Enter");
    ok(await p.evaluate(() => document.activeElement?.dataset?.courtReason !== "1"), "Enter leaves the reason");
    await p.keyboard.press("1"); await p.keyboard.press("3");
    ok(await p.locator('[data-court-case="C-3"]').count() === 1 && /Duplicate of #12/.test(await p.locator('[data-court-pick="confirm"]').textContent()) && await p.locator("[data-court-pick]").count() === 3, "a duplicate case is ruled confirm, not a duplicate, or needs information");
    ok(/crash <i>in<\/i> saveDraft/.test(await p.locator('[data-court-symptom="a:34"]').textContent()) && await p.locator("[data-court-symptom] i").count() === 0, "a duplicate case shows the matching symptom both issues quote, as text");
    await p.click('[data-court-pick="confirm"]');
    ok(await p.locator("[data-court-summary]").count() === 1 && await p.locator("[data-court-ruled]").count() === 3 && sent.length === 0, "after the last case the rulings are listed, nothing sent yet");
    await p.click("[data-court-submit]"); await p.waitForTimeout(300);
    ok(sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify({ rulings: [{ case: "C-1", pick: "a", reason: "A reads the code path that runs" }, { case: "C-2", pick: "separate" }, { case: "C-3", pick: "confirm" }] }), "sending posts each case's ruling once, with its reason", JSON.stringify(sent));
    ok(/Nothing was written to GitHub/.test(await p.locator('[data-court-summary] [role="status"]').textContent()) && await p.locator('[data-court-summary] a[href="#/run/R-50"]').count() === 1, "the court says the Task applies them and links to it");
    ok(requests.every((q) => q.startsWith("GET ") || q === `POST ${base}/api/issue-triage/wallet/court/R-50` || q === `POST ${base}/api/main/locale`) && !requests.some((q) => /github\.com/.test(q)), "the court calls nothing on GitHub and writes nothing but its rulings to Studio", requests.filter((q) => !q.startsWith("GET ")).join(", "));
    await p.screenshot({ path: join(shots, "court-1440.png"), fullPage: true });
    await ctx.close(); }
  { const sent = [], asked = [];
    const { ctx, p } = await open(390, "zh-TW", "#/court/wallet/R-50", { court: courtRoutes(sent, asked) });
    await p.evaluate(() => { try { sessionStorage.clear(); } catch {} }); await p.reload(); await p.waitForSelector("[data-court-case]", { timeout: 8000 }).catch(() => {});
    ok(await noSideways(p) && /分歧法庭/.test(await p.locator("#view").textContent()) && await p.locator("[data-court-dock]").isVisible(), "390: the court fits the phone, the rulings docked in reach");
    const [a, b] = await Promise.all(["a", "b"].map((k) => p.locator(`[data-court-side="${k}"]`).boundingBox()));
    ok(a && b && b.y > a.y && Math.abs(a.x - b.x) < 2, "390: the two sides stack");
    await p.screenshot({ path: join(shots, "court-390.png"), fullPage: false });
    await p.click('[data-court-pick="a"]'); ok(await p.locator('[data-court-case="C-2"]').count() === 1, "390: a tap rules the case");
    await p.click('[data-court-issue="32"]'); await p.waitForTimeout(200);
    ok(await noSideways(p) && await p.locator(".ct-modal").count() === 1, "390: a popup fits the phone"); await p.click("[data-court-close]");
    ok(await p.locator(".ct-modal").count() === 0, "the close button closes the popup");
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  await browser.close(); app.kill();
}
console.log(`\nissues-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
