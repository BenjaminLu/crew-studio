import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md), the server half: the pure rules (addresses, verdicts, approvals, the next step,
// the dependency block, the proposal) and the real module against a fictional GitHub (tests/lib/pr-watch-github.ts): the
// set, issues in an unwatched repository, missing approvals from rulesets and classic protection, the four environment
// detectors, evidence, every next-step rule, change marks, the captain-only card that writes only the marked block, drift
// and both of its actions, the rate limit, and that no organisation, repository, team or account name is in the source.
//   bun tests/pr-watch.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, until, suite } from "./rt-harness";
import { bundledText } from "../src/bundled";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch, APPLY_WORKFLOW, cleanSettings, apiBase } from "../src/pr-watch";
import * as R from "../src/pr-watch-rules";
import { prWatchGitHub, fixtureSettings, ME, sha } from "./lib/pr-watch-github";

const { ok, end } = suite("pr-watch");

// ---------- addresses ----------
{
  const p = (s: string) => R.parseGitHubUrl(s);
  ok(JSON.stringify(p("https://github.com/northwind/web-app")) === JSON.stringify({ kind: "repo", repo: "northwind/web-app" }), "a repository address watches the repository");
  ok(JSON.stringify(p("https://github.com/northwind/web-app/pull/88/files")) === JSON.stringify({ kind: "pr", repo: "northwind/web-app", number: 88 }), "a pull request address (also …/files) watches that pull request");
  ok(p("https://github.com/northwind/web-app.git/").kind === "repo", "a trailing .git and slash are accepted");
  for (const bad of ["http://github.com/northwind/web-app", "https://gitlab.com/northwind/web-app", "https://github.com.evil.example/northwind/web-app", "https://user@github.com/northwind/web-app",
    "https://github.com:444/northwind/web-app", "https://github.com/northwind/web-app/issues/3", "https://github.com/northwind", "javascript:alert(1)", "https://github.com/north wind/x",
    "https://github.com/../x/pull/1", "https://github.com/northwind/web-app/pull/0", "https://api.github.com/repos/northwind/web-app", "northwind/web-app"])
    ok(p(bad).kind === "error", `refused: ${bad}`);
}
// ---------- verdicts ----------
{
  const c = (b: string) => R.classifyComment(b).verdict;
  ok(c("## Result: PASS") === "pass" && c("**PASS**\nall good") === "pass" && c("# 通過") === "pass", "pass from a heading, a bold line or a label line");
  ok(c("Verdict: FAIL — the export breaks") === "fail" && c("### Not passed") === "fail", "fail");
  ok(c("Result: conditional pass (copy pending)") === "conditional" && c("## 有條件通過") === "conditional", "conditional");
  ok(c("## Code review only") === "code-only", "code review only");
  ok(c("Looked at it, will finish tomorrow") === "unclassified" && c("# PASS\n# FAIL") === "unclassified" && c("") === "unclassified", "no verdict line, or two that disagree: unclassified");
  ok(R.classifyComment("PASS on 3f2a1c9 and deadbeef12").shas.join() === "3f2a1c9,deadbeef12" && !R.classifyComment("ticket 1234567").shas.length, "commit SHAs named (hex with a letter and a digit)");
  const commits = [{ sha: sha("a"), at: "2026-11-01T00:00:00Z" }, { sha: sha("b"), at: "2026-11-02T00:00:00Z" }];
  ok(R.coverage([sha("a").slice(0, 7)], "2026-11-03T00:00:00Z", commits, sha("b")).since === sha("a").slice(0, 7), "naming an older commit: the change since it is untested");
  ok(R.coverage([], "2026-11-01T12:00:00Z", commits, sha("b")).covers === "older" && R.coverage([], "2026-11-03T00:00:00Z", commits, sha("b")).covers === "head", "naming none: the commit pushed before the comment");
  ok(R.evidenceOf({ accounts: [], checks: [], labels: ["qa-passed"] }, { comments: [], checks: [], labels: ["QA-passed"], commits, head: sha("b") })?.source === "label", "a listed label counts as evidence");
  ok(R.evidenceOf({ accounts: [], checks: ["e2e"], labels: [] }, { comments: [], checks: [{ name: "e2e", status: "completed", conclusion: "failure", at: "2026-11-03T00:00:00Z", url: null }], labels: [], commits, head: sha("b") })?.verdict === "fail", "a listed check run that failed is failing evidence");
}
// ---------- the next step: each rule on its own, and the first match wins ----------
{
  const okApprovals: R.Approvals = { readable: true, required: 1, counted: 1, codeOwners: false, lastPush: false, dismissStale: false, missing: [], sources: [] };
  const base: R.StepInput = { draft: false, author: "a", reviews: [{ login: "bot", state: "COMMENTED", stale: false, at: "", author: false }], requiredReviewers: ["bot"], deps: [], envs: [{ name: "dev", on: true, production: false }],
    evidence: { verdict: "pass", source: "comment", by: "qa", at: "", url: null, covers: "head", since: null, shas: [] }, evidenceSources: { accounts: ["qa"], checks: [], labels: [] }, approvals: okApprovals };
  const k = (o: Partial<R.StepInput>) => R.nextStep({ ...base, ...o });
  ok(k({}).rule === "ready" && k({}).who[0] === "captain", "everything satisfied: ready to merge, waiting on the captain");
  ok(k({ approvals: { ...okApprovals, missing: [{ kind: "count", n: 1 }] } }).rule === "approvals", "approvals missing: approve");
  ok(k({ evidence: null }).rule === "evidence" && k({ evidence: { ...base.evidence!, verdict: "code-only" } }).rule === "evidence" && k({ evidence: { ...base.evidence!, verdict: "unclassified" } }).rule === "evidence", "no, code-review-only or unclassified evidence: test");
  ok(k({ evidence: { ...base.evidence!, covers: "older", since: "abc1234" } }).since === "abc1234", "evidence for an older head: test only the change since");
  ok(k({ evidence: { ...base.evidence!, verdict: "fail" } }).rule === "failed" && k({ evidence: { ...base.evidence!, verdict: "fail" }, approvals: { ...okApprovals, missing: [] } }).kind === "fix", "failed evidence: fix, never ready");
  ok(k({ envs: [{ name: "dev", on: false, production: false }, { name: "prod", on: true, production: true }] }).rule === "environment", "only production runs it: deploy for testing");
  ok(k({ envs: [] }).rule === "ready", "no environment set: the rule does not apply");
  ok(k({ deps: [{ id: "o/r#1", done: false }] }).rule === "dependency" && k({ deps: [{ id: "o/r#1", done: true }] }).rule === "ready", "an open dependency: wait for it; a merged one: done");
  ok(k({ reviews: [] }).rule === "required" && k({ reviews: [], author: "bot" }).rule === "ready", "a required reviewer who has not reviewed: wait (not the author)");
  ok(k({ reviews: [...base.reviews, { login: "x", state: "CHANGES_REQUESTED", stale: false, at: "", author: false }] }).rule === "changes", "changes requested: fix");
  const all = k({ draft: true, reviews: [{ login: "x", state: "CHANGES_REQUESTED", stale: false, at: "", author: false }], deps: [{ id: "o/r#1", done: false }], evidence: null, envs: [{ name: "dev", on: false, production: false }] });
  ok(all.rule === "draft" && all.matched.filter(Boolean).length === 7, "the first matching rule wins (a draft that matches seven rules is on hold)", JSON.stringify(all.matched));
}
// ---------- approvals ----------
{
  const rv = R.latestReviews([{ login: "me", state: "APPROVED", commit: "h", at: "1" }, { login: "a", state: "APPROVED", commit: "old", at: "2" }, { login: "b", state: "CHANGES_REQUESTED", commit: "h", at: "3" }, { login: "b", state: "APPROVED", commit: "h", at: "4" }, { login: "b", state: "COMMENTED", commit: "h", at: "5" }], "h", "me");
  ok(rv.find((r) => r.login === "b")?.state === "APPROVED" && rv.find((r) => r.login === "a")?.stale === true && rv.find((r) => r.login === "me")?.author === true, "latest verdict per reviewer; a later comment keeps the approval; stale on another head; the author marked");
  const r = R.mergeRules([{ type: "pull_request", parameters: { required_approving_review_count: 2 } }], { required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true } }, null);
  ok(r.readable && r.required === 2 && r.dismissStale && r.sources.join() === "ruleset,protection", "rulesets and classic protection merge: the stricter of each");
  const ap = R.approvalsOf(r, rv, { files: [], codeowners: null, teamMembers: new Map(), lastPusher: null });
  ok(ap.counted === 1 && ap.missing[0]?.kind === "count" && (ap.missing[0] as any).n === 1, "the author's own approval and a stale one (stale dismissed) do not count", JSON.stringify(ap));
  ok(R.mergeRules([], null, { en: "x", tw: "x" }).readable === false && R.approvalsOf(R.mergeRules([], null, { en: "no admin", tw: "x" }), [], { files: [], codeowners: null, teamMembers: new Map(), lastPusher: null }).missing[0].kind === "unreadable", "unreadable rules say so instead of guessing");
  const co = R.parseCodeowners("* @org/core\n/docs/ @dana\n*.md @writer\nsrc/**/api.ts @api-lead");
  ok(R.ownersOf("docs/a.ts", co).join() === "@dana" && R.ownersOf("docs/a.md", co).join() === "@writer" && R.ownersOf("x/y.ts", co).join() === "@org/core" && R.ownersOf("src/a/b/api.ts", co).join() === "@api-lead", "CODEOWNERS: the last matching line wins");
}
// ---------- the dependency block and the proposal ----------
{
  const block = R.renderBlock(["northwind/web-app#3", "northwind/ledger#9"], "northwind/web-app", true);
  ok(block === "<!-- crew-studio:depends -->\nDepends-on: https://github.com/northwind/web-app/pull/3\nDepends-on: https://github.com/northwind/ledger/pull/9\nDepends-on: #3\n<!-- /crew-studio:depends -->", "the block: full addresses, plus the short same-repository form when set", block);
  const body = "Intro\n\nMore text\n";
  const once = R.replaceBlock(body, block), twice = R.replaceBlock(`${once}\nA later line\n`, R.renderBlock(["northwind/ledger#9"], "northwind/web-app"));
  ok(once === `Intro\n\nMore text\n\n${block}\n` && twice.startsWith("Intro\n\nMore text\n\n<!-- crew-studio:depends -->\nDepends-on: https://github.com/northwind/ledger/pull/9\n<!-- /crew-studio:depends -->") && twice.endsWith("\nA later line\n"), "only the marked block is replaced; the rest of the body is kept", JSON.stringify(twice));
  let threw = false; try { R.replaceBlock("x <!-- crew-studio:depends --> no end", block); } catch { threw = true; }
  ok(threw, "an unpaired marker is refused, never guessed");
  ok(R.blockDeps(once, "northwind/web-app")!.join() === "northwind/web-app#3,northwind/ledger#9", "the block's dependencies read back");
  const facts = (id: string, o: Partial<R.PrFacts> = {}): R.PrFacts => { const s = R.splitId(id)!; return { id, repo: s.repo, number: s.number, body: "", base: "main", headRef: `t${s.number}`, createdAt: `2026-11-0${s.number % 9 + 1}T00:00:00Z`, files: [], issues: [], ...o }; };
  const prs = [facts("o/r#1", { body: "Depends-on: #3" }), facts("o/r#2", { base: "t1" }), facts("o/r#3", { files: ["a.ts"] }), facts("o/r#4", { files: ["a.ts"], body: "see o/r#2" })];
  const sg = R.signals(prs);
  ok(sg.deps.some((d) => d.pr === "o/r#1" && d.on === "o/r#3" && d.kind === "depends-on") && sg.deps.some((d) => d.pr === "o/r#2" && d.on === "o/r#1" && d.kind === "stacked") && sg.deps.some((d) => d.pr === "o/r#4" && d.on === "o/r#2" && d.kind === "mentions"), "signals: Depends-on, stacked branches, a body naming another", JSON.stringify(sg.deps));
  ok(sg.hints.some((h) => h.kind === "files" && h.first === "o/r#3" && h.then === "o/r#4"), "files both change: the older first");
  const order = R.proposeOrder(prs, sg.deps, sg.hints).map((x) => x.id);
  ok(order.indexOf("o/r#3") < order.indexOf("o/r#1") && order.indexOf("o/r#1") < order.indexOf("o/r#2") && order.indexOf("o/r#2") < order.indexOf("o/r#4"), "the proposed order puts every dependency first", order.join());
  ok(R.tagCommit("image: reg/app:3f2a1c9e\n", "image: \\S+:([0-9a-f]{7,40})") === "3f2a1c9e" && R.tagCommit("x", "(") === null, "an image tag's commit from the pattern's group");
}
// ---------- settings and the API origin ----------
{
  let msg = ""; try { cleanSettings({ evidence: { accounts: ["bad name!"] } }); } catch (e: any) { msg = e.message; }
  ok(/not a GitHub account/.test(msg), "settings: an account name GitHub does not allow is refused");
  msg = ""; try { cleanSettings({ environments: [{ name: "prod", detect: { kind: "file", repository: "o/r", path: "../etc/passwd", pattern: "x" } }] }); } catch (e: any) { msg = e.message; }
  ok(/plain path/.test(msg), "settings: a file path that climbs is refused");
  const keep = process.env.CREW_GITHUB_API;
  process.env.CREW_GITHUB_API = "https://evil.example"; let refused = false; try { apiBase(); } catch { refused = true; }
  process.env.CREW_GITHUB_API = ""; const def = apiBase(); process.env.CREW_GITHUB_API = keep;
  ok(refused && def === "https://api.github.com", "the API origin is api.github.com (a loopback test server only through CREW_GITHUB_API)");
}

// ---------- the module against the fictional GitHub ----------
const gh = prWatchGitHub();
const H = await harness([bundledText(`workflows/v2/${APPLY_WORKFLOW}.wf.yaml`)!]), E = H.engine;
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1"; process.env.CREW_PR_WATCH = "1";
const poller = new GitHubPoller(), sent: any[] = [];
const W = createPrWatch({ dataDir: H.data, poller, notify: (t, d) => sent.push([t, d]) }); W.install(E);
const call = async (path: string, body?: unknown, who = "desktop") => { const url = new URL(`http://127.0.0.1${path}`), writing = body !== undefined;
  const r = await W.handle(new Request(url, writing ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), url, { kind: who }, writing); return { status: r!.status, body: await r!.json() }; };
const row = (v: any, id: string) => v.rows.find((r: any) => r.id === id);
const writes = () => gh.calls.filter((c) => c.method !== "GET" && !(c.method === "POST" && c.path === "/graphql"));
try {
  for (const u of ["https://github.com/northwind/checkout-api", "https://github.com/northwind/web-app", "https://github.com/northwind/ledger", "https://github.com/northwind/mobile/pull/5"]) {
    const r = await call("/api/prs/watch", { url: u }); ok(r.status === 200, `watch ${u}`, JSON.stringify(r.body).slice(0, 200)); }
  ok((await call("/api/prs/watch", { url: "https://github.com/northwind/web-app" })).status === 400, "watching the same repository again is refused with a message");
  ok((await call("/api/prs/watch", { url: "https://example.com/northwind/web-app" })).body.error?.includes("github.com"), "a non-GitHub address is refused with a message");
  ok((await call("/api/prs/watch", { url: "https://github.com/northwind/web-app" }, "phone")).status === 403, "a paired phone cannot change the list");
  ok((await call("/api/prs/settings", { settings: fixtureSettings })).status === 200, "settings saved");
  await until(() => !!W.snapshot.at, 10000); await call("/api/prs/refresh", {});
  let v = (await call("/api/prs")).body;
  const ids = v.rows.map((r: any) => r.id).sort();
  const want = ["northwind/checkout-api#11", "northwind/checkout-api#12", "northwind/checkout-api#13", "northwind/checkout-api#14", "northwind/checkout-api#15", "northwind/checkout-api#16", "northwind/checkout-api#17", "northwind/checkout-api#18", "northwind/checkout-api#19", "northwind/ledger#40", "northwind/mobile#5", "northwind/web-app#30"].sort();
  ok(JSON.stringify(ids) === JSON.stringify(want), "the set: open pull requests opened by or assigned to the captain in the watched repositories, plus the single one (not someone else's, not a closed one)", JSON.stringify(ids));
  ok(row(v, "northwind/mobile#5").single && !row(v, "northwind/checkout-api#15").single && row(v, "northwind/checkout-api#15").author === "lee", "the single pull request is marked single; an assigned one is in the set");
  ok(v.me === ME && !gh.unknown.length, "the captain's login is read; every request was one the fixture answers", JSON.stringify(gh.unknown));
  ok(!writes().length, "a refresh writes nothing to GitHub (GET and a GraphQL query only)", JSON.stringify(writes()));
  // issues
  const i12 = row(v, "northwind/checkout-api#12").issues, i19 = row(v, "northwind/checkout-api#19").issues, i18 = row(v, "northwind/checkout-api#18").issues;
  ok(i12.length === 1 && i12[0].ref === "northwind/platform-issues#7" && i12[0].title === "Capture retries double-charge" && i12[0].state === "open" && i12[0].external, "an issue linked from the body in an unwatched repository: its title and state, marked external", JSON.stringify(i12));
  ok(i19.some((i: any) => i.ref === "northwind/web-app#2" && !i.external) && i18.some((i: any) => i.ref === "northwind/platform-issues#8" && i.title === "Retry storms after deploys"), "closingIssuesReferences and timeline cross-references are issues too");
  ok(!gh.calls.some((c) => c.path.includes("platform-issues") && c.method !== "GET"), "nothing is written to the external issue");
  // next steps
  const nx = (n: string) => row(v, n).next;
  const steps: [string, string, string][] = [["northwind/checkout-api#11", "draft", "hold"], ["northwind/checkout-api#12", "changes", "fix"], ["northwind/checkout-api#13", "required", "review"], ["northwind/checkout-api#14", "dependency", "dependency"],
    ["northwind/checkout-api#15", "environment", "deploy"], ["northwind/checkout-api#16", "failed", "fix"], ["northwind/checkout-api#17", "evidence", "test"], ["northwind/checkout-api#18", "approvals", "approve"],
    ["northwind/checkout-api#19", "ready", "merge"], ["northwind/web-app#30", "evidence", "test"], ["northwind/ledger#40", "approvals", "approve"]];
  for (const [id, rule, kind] of steps) ok(nx(id).rule === rule && nx(id).kind === kind, `${id}: next step ${kind} (rule ${rule})`, JSON.stringify(nx(id)));
  ok(nx("northwind/checkout-api#13").who.join() === "review-bot" && nx("northwind/checkout-api#14").who.join() === "northwind/checkout-api#15" && nx("northwind/checkout-api#12").who.join() === ME, "who each waits on");
  ok(v.count === 3 && sent.some(([t]) => t === "prs"), "the sidebar count: rows whose next step is approve or merge; the page is told", String(v.count));
  // approvals
  const a18 = row(v, "northwind/checkout-api#18").approvals;
  ok(a18.required === 2 && a18.counted === 1 && a18.missing.some((m: any) => m.kind === "count" && m.n === 1) && a18.missing.some((m: any) => m.kind === "owner" && m.who.join() === "@dana") && a18.missing.some((m: any) => m.kind === "team" && m.who === "release"),
    "missing approvals from the ruleset: the count (the author's own approval ignored, a stale one counted as the rules allow), a code owner, a required team", JSON.stringify(a18));
  ok(row(v, "northwind/checkout-api#18").reviews.some((r: any) => r.login === "bo" && r.stale), "the approval given on an older head shows stale");
  const a30 = row(v, "northwind/web-app#30").approvals;
  ok(a30.counted === 0 && a30.missing[0]?.n === 1 && a30.sources.join() === "protection", "classic protection that dismisses stale approvals: the stale approval does not count", JSON.stringify(a30));
  const a40 = row(v, "northwind/ledger#40").approvals;
  ok(!a40.readable && a40.missing[0]?.kind === "unreadable" && /admin/.test(a40.missing[0].reason) && nx("northwind/ledger#40").who.join() === "(rules unreadable)", "branch protection that needs admin: the rules are unreadable, never guessed", JSON.stringify(a40));
  ok(row(v, "northwind/checkout-api#19").approvals.missing.length === 0, "two approvals from a code owner and the required team: nothing missing");
  // environments
  const env = (id: string, n: string) => row(v, id).envs.find((e: any) => e.name === n)?.on;
  ok(env("northwind/checkout-api#19", "dev") === true && env("northwind/checkout-api#18", "dev") === false, "a GitHub Deployment to the environment runs the head");
  ok(env("northwind/checkout-api#18", "qa") === true && env("northwind/checkout-api#15", "qa") === false, "a check run by name on the head");
  ok(env("northwind/checkout-api#17", "staging") === true && env("northwind/checkout-api#19", "staging") === false, "the latest deployment of a branch containing the head");
  ok(env("northwind/checkout-api#18", "prod") === true && env("northwind/checkout-api#19", "prod") === false, "an image tag in a file in another repository, compared by commit");
  // evidence
  const ev = (id: string) => row(v, id).evidence;
  ok(ev("northwind/checkout-api#16").verdict === "fail" && ev("northwind/checkout-api#18").verdict === "pass" && ev("northwind/checkout-api#18").covers === "head", "evidence from the listed account is classified (the latest decided comment)");
  ok(ev("northwind/checkout-api#17").covers === "older" && nx("northwind/checkout-api#17").since === sha("ca17-1").slice(0, 7), "evidence naming an older head: test only the change since it");
  ok(ev("northwind/web-app#30").verdict === "unclassified", "a comment the rules cannot classify reads unclassified");
  // the proposal
  const d14 = row(v, "northwind/checkout-api#14").deps;
  ok(d14.source === "proposal" && d14.proposed[0]?.on === "northwind/checkout-api#15" && /Depends-on/.test(d14.proposed[0].why) && v.proposal.pending, "the proposal: a dependency with its reason, shown as proposed", JSON.stringify(d14));
  const pos = (id: string) => row(v, id).position;
  ok(pos("northwind/checkout-api#15") < pos("northwind/checkout-api#14") && row(v, "northwind/checkout-api#14").proposedPosition, "the proposed order puts the dependency first, marked proposed");
  ok(!Object.keys(v.rows[0].changed ?? {}).length && v.rows.every((r: any) => !r.changed), "the first refresh marks nothing as changed");
  // the captain's edits replace the proposal for that row
  v = (await call("/api/prs/deps", { pr: "northwind/checkout-api#19", on: ["northwind/checkout-api#18"] })).body;
  ok(row(v, "northwind/checkout-api#19").deps.source === "captain" && row(v, "northwind/checkout-api#19").next.rule === "dependency", "a dependency the captain adds is Studio's record, and the next step follows it");
  const order = v.rows.map((r: any) => r.id).reverse();
  v = (await call("/api/prs/order", { order })).body;
  ok(v.rows.map((r: any) => r.id).join() === order.join() && v.rows.every((r: any) => !r.proposedPosition), "a drag sets the order: no row is proposed any more");
  v = (await call("/api/prs/accept", {})).body;
  ok(row(v, "northwind/checkout-api#14").deps.source === "accepted" && !v.proposal.pending, "accepting takes the proposal as the record");
  // changes are marked until the next change
  const p18 = gh.data.find("northwind/checkout-api", 18)!, h18 = gh.data.head(p18);
  p18.reviews!.push({ user: "rel-ray", state: "APPROVED", commit: h18, at: "2026-11-02T10:00:00Z" }, { user: "dana", state: "APPROVED", commit: h18, at: "2026-11-02T10:01:00Z" });
  await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  const ch = row(v, "northwind/checkout-api#18").changed;
  ok(ch && ch.what.some((w: any) => w.k === "review" && w.login === "rel-ray") && ch.what.some((w: any) => w.k === "next" && w.from === "approve" && w.to === "merge") && v.rows.filter((r: any) => r.changed && r.id !== "northwind/checkout-api#19").length === 1 && row(v, "northwind/checkout-api#19").changed.what.join && row(v, "northwind/checkout-api#19").changed.what[0].to === "dependency", "a refresh marks the rows that changed, with what changed (the dependency the captain added changed #19's next step)", JSON.stringify(ch));
  const at1 = ch.at; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(row(v, "northwind/checkout-api#18").changed?.at === at1 && !("read" in row(v, "northwind/checkout-api#18")) && !("unread" in v), "the mark stays until the next change; there is no read/unread state");
  // applying the dependencies: only through the captain's card, only the marked block
  const before14 = String(gh.data.find("northwind/checkout-api", 14)!.body);
  const ap = await call("/api/prs/apply", { prs: ["northwind/checkout-api#14"] });
  ok(ap.status === 200 && /^R-/.test(ap.body.task), "apply starts a Task with a card", JSON.stringify(ap.body));
  const run = () => E.list().find((r: any) => r.id === ap.body.task)!;
  const openCard = () => E.cards.list({ run: ap.body.task }).find((c: any) => c.status === "open");
  await until(() => !!openCard(), 10000);
  const card: any = openCard();
  ok(card?.captainOnly && card.body.includes("<!-- crew-studio:depends -->\nDepends-on: https://github.com/northwind/checkout-api/pull/15\n<!-- /crew-studio:depends -->") && card.body.includes("Repository / 儲存庫: northwind/checkout-api"), "the captain-only card shows the exact block and the target repository", card?.body);
  ok(!writes().length, "nothing is written before the captain answers");
  let refused = ""; try { await E.answer(card.id, { choice: "apply", by: "Firstmate" }); } catch (e: any) { refused = e.message; }
  ok(/Only the captain/.test(refused) && !writes().length, "Firstmate cannot answer it");
  await E.answer(card.id, { choice: "apply", by: "captain" });
  await until(() => run().status === "succeeded", 10000);
  const w = writes();
  ok(run().status === "succeeded" && w.length === 1 && w[0].method === "PATCH" && w[0].path === "/repos/northwind/checkout-api/pulls/14", "the captain's answer writes one PATCH to that pull request", JSON.stringify(w));
  const after14 = String(gh.data.find("northwind/checkout-api", 14)!.body);
  ok(after14.startsWith(before14.replace(/\s+$/, "")) && after14.endsWith("<!-- /crew-studio:depends -->\n") && R.stripBlock(after14).trim() === before14.trim(), "only the marked block was added; the rest of the body is unchanged", JSON.stringify(after14));
  await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(row(v, "northwind/checkout-api#14").deps.applied && !row(v, "northwind/checkout-api#14").deps.drift, "the row says the block is applied");
  // a body edited between the card and the write is left alone
  const p19 = gh.data.find("northwind/checkout-api", 19)!;
  const ap2 = await call("/api/prs/apply", { prs: ["northwind/checkout-api#19"] }); await until(() => !!E.cards.list({ run: ap2.body.task }).find((c: any) => c.status === "open"), 10000);
  p19.body = `${p19.body}\n\nEdited on GitHub meanwhile.`;
  const c2: any = E.cards.list({ run: ap2.body.task }).find((c: any) => c.status === "open"); await E.answer(c2.id, { choice: "apply", by: "captain" });
  await until(() => E.list().find((r: any) => r.id === ap2.body.task)!.status === "succeeded", 10000);
  ok(writes().length === 1 && /changed on GitHub since the card/.test(String(E.list().find((r: any) => r.id === ap2.body.task)!.nodes?.write?.note ?? JSON.stringify(E.list().find((r: any) => r.id === ap2.body.task)))), "a body that changed after the card is not written; the Task says why");
  // drift: the block edited on GitHub turns the cell amber; both actions
  const p14 = gh.data.find("northwind/checkout-api", 14)!;
  p14.body = String(p14.body).replace("Depends-on: https://github.com/northwind/checkout-api/pull/15", "Depends-on: https://github.com/northwind/checkout-api/pull/15\nDepends-on: https://github.com/northwind/checkout-api/pull/13");
  await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  const dr = row(v, "northwind/checkout-api#14").deps.drift;
  ok(dr && dr.githubDeps.join() === "northwind/checkout-api#15,northwind/checkout-api#13" && /pull\/15/.test(dr.studio) && !row(v, "northwind/checkout-api#14").deps.applied, "a block edited on GitHub is drift: both versions are shown", JSON.stringify(dr));
  v = (await call("/api/prs/drift/take", { pr: "northwind/checkout-api#14" })).body;
  ok(!row(v, "northwind/checkout-api#14").deps.drift && row(v, "northwind/checkout-api#14").deps.on.map((d: any) => d.id).join() === "northwind/checkout-api#15,northwind/checkout-api#13" && row(v, "northwind/checkout-api#14").deps.source === "github", "take GitHub's version: it becomes Studio's record");
  p14.body = R.stripBlock(String(p14.body)); await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(row(v, "northwind/checkout-api#14").deps.drift && row(v, "northwind/checkout-api#14").deps.drift.github === null, "a block removed on GitHub is drift too");
  const ap3 = await call("/api/prs/apply", { prs: ["northwind/checkout-api#14"] }); await until(() => !!E.cards.list({ run: ap3.body.task }).find((c: any) => c.status === "open"), 10000);
  const c3: any = E.cards.list({ run: ap3.body.task }).find((c: any) => c.status === "open"); await E.answer(c3.id, { choice: "apply", by: "captain" });
  await until(() => E.list().find((r: any) => r.id === ap3.body.task)!.status === "succeeded", 10000);
  await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(!row(v, "northwind/checkout-api#14").deps.drift && R.blockDeps(String(p14.body), "northwind/checkout-api")!.length === 2, "re-applying Studio's record through the card writes the block back");
  ok(writes().every((c) => c.method === "PATCH" && /\/pulls\/1[49]$/.test(c.path)), "every write was a pull request body PATCH from a card");
  // close without writing
  const ap4 = await call("/api/prs/apply", { prs: ["northwind/checkout-api#19"] }); await until(() => !!E.cards.list({ run: ap4.body.task }).find((c: any) => c.status === "open"), 10000);
  const n4 = writes().length, c4: any = E.cards.list({ run: ap4.body.task }).find((c: any) => c.status === "open"); await E.answer(c4.id, { choice: "close", by: "captain" });
  await until(() => ["succeeded", "failed"].includes(E.list().find((r: any) => r.id === ap4.body.task)!.status), 10000);
  ok(writes().length === n4, "closing the card writes nothing");
  // rate limit: the refresh fails, the list stays, Studio backs off
  gh.setRateLimited(true); const atBefore = W.snapshot.at;
  await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body; gh.setRateLimited(false);
  ok(v.error && /rate limit/i.test(v.error.en) && v.backoffUntil && v.rows.length === 12 && W.snapshot.at === atBefore, "a rate limit keeps the last list, says so and backs off", JSON.stringify(v.error));
  // removing
  v = (await call("/api/prs/unwatch", { pr: "northwind/checkout-api#11" })).body;
  ok(!row(v, "northwind/checkout-api#11") && v.watch.excluded.includes("northwind/checkout-api#11"), "removing a pull request that came in through its repository records it as excluded");
  v = (await call("/api/prs/restore", {})).body; ok(!v.watch.excluded.length, "restore brings excluded ones back");
  v = (await call("/api/prs/unwatch", { pr: "northwind/mobile#5" })).body; ok(!v.watch.prs.length && !row(v, "northwind/mobile#5"), "removing a single pull request stops watching it");
  v = (await call("/api/prs/unwatch", { repo: "northwind/ledger" })).body; ok(!v.watch.repos.some((r: any) => r.repo === "northwind/ledger") && !row(v, "northwind/ledger#40"), "removing a repository stops watching it");
  const saved = JSON.parse(readFileSync(join(H.data, "pr-watch", "state.json"), "utf8"));
  ok(saved.watch.repos.length === 2 && !JSON.stringify(saved).includes("fixture-token") && !JSON.stringify(W.snapshot).includes("fixture-token") && !JSON.stringify(v).includes("fixture-token"), "the state lives in Studio's data directory; the token is in no file and no answer");
} finally { W.stop(); poller.stop(); gh.stop(); H.stop(); }

// ---------- generic: no organisation, repository, team or account name in the feature's source ----------
{
  const root = join(import.meta.dir, "..");
  const files = ["src/pr-watch.ts", "src/pr-watch-rules.ts", "public/prs.js", "public/prs.css", "workflows/v2/pr-watch-apply-depends.wf.yaml"];
  const names = ["northwind", "checkout-api", "web-app", "platform-issues", "skipper", "qa-lin", "review-bot", "rel-ray", "payments", "ledger", "mobile", "infra", "dana"];
  const hits: string[] = [];
  for (const f of files) { const t = readFileSync(join(root, f), "utf8").toLowerCase();
    for (const n of names) if (new RegExp(`(^|[^a-z-])${n}([^a-z-]|$)`).test(t)) hits.push(`${f}: ${n}`);
    for (const m of t.matchAll(/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)/g)) if (!["<owner>", "${"].some((x) => m[0].includes(x)) && !/\$\{/.test(m[1])) hits.push(`${f}: ${m[0]}`);
    for (const m of t.matchAll(/["'`]@[a-z0-9_.-]+\/[a-z0-9_.-]+["'`]/g)) hits.push(`${f}: team ${m[0]}`); }
  ok(!hits.length, "no organisation, repository, team, bot or account name is hard-coded in the feature's source", JSON.stringify(hits));
}
end();
