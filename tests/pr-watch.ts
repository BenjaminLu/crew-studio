import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md), the server half: the pure rules (addresses, verdicts, approvals, the next step,
// the dependency block, the proposal) and the real module against a fictional GitHub (tests/lib/pr-watch-github.ts): the
// set, issues in an unwatched repository, missing approvals from rulesets and classic protection, the four environment
// detectors, evidence, every next-step rule, change marks, the captain-only card that writes only the marked block, drift
// and both of its actions, the rate limit, and that no organisation, repository, team or account name is in the source.
//   bun tests/pr-watch.ts
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, until, suite } from "./rt-harness";
import { bundledText } from "../src/bundled";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch, APPLY_WORKFLOW, cleanSettings, apiBase, EtagCache } from "../src/pr-watch";
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
  ok(R.coverage([], "2026-11-01T12:00:00Z", commits, sha("b")).covers === "unknown" && R.coverage([], "2026-11-03T00:00:00Z", commits, sha("b")).covers === "unknown", "naming no commit: unknown, whatever the commit dates say (a commit made before a comment may be pushed after it)");
  ok(R.coverage([], "2026-11-03T00:00:00Z", commits, sha("b"), "2026-11-02T12:00:00Z").covers === "head" && R.coverage([], "2026-11-03T00:00:00Z", commits, sha("b"), "2026-11-03T01:00:00Z").covers === "unknown", "naming no commit covers the head only when Studio saw that head before the comment");
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
  const ap = R.approvalsOf(r, rv, { files: [], codeowners: null, teamMembers: new Map() });
  ok(ap.counted === 1 && ap.missing[0]?.kind === "count" && (ap.missing[0] as any).n === 1, "the author's own approval and a stale one (stale dismissed) do not count", JSON.stringify(ap));
  { const unread = { en: "no admin", tw: "x" }, none = R.mergeRules([], null, null, "o", unread), gm = (d: string | null) => ({ reviewDecision: d, mergeState: "BLOCKED", requested: ["@o/ops"] });
    const base = { files: [], codeowners: null, teamMembers: new Map() };
    const fill = R.approvalsOf(none, [], { ...base, github: gm("REVIEW_REQUIRED") }), done = R.approvalsOf(none, [], { ...base, github: gm("APPROVED") }), nul = R.approvalsOf(none, [], { ...base, github: gm(null) });
    const read = R.approvalsOf(R.mergeRules([], "none", null), [], { ...base, github: gm("REVIEW_REQUIRED") });
    const more = R.approvalsOf(R.mergeRules([{ type: "pull_request", parameters: { required_approving_review_count: 1 } }], null, null, "o", unread), [], { ...base, github: gm("REVIEW_REQUIRED") });
    ok(none.readable && fill.readable && fill.missing.length === 1 && fill.missing[0].kind === "github" && R.missingWho(fill.missing).join() === "@o/ops" && fill.unread?.[0].en === "no admin",
      "classic protection unread: GitHub's REVIEW_REQUIRED that the readable rules do not explain is a missing review from the pending requests", JSON.stringify(fill));
    const clean = (d: string | null, m: string) => R.approvalsOf(none, [], { ...base, github: { reviewDecision: d, mergeState: m, requested: [] } });
    ok(!clean("APPROVED", "CLEAN").missing.length && !clean(null, "BEHIND").missing.length && !read.missing.length && read.unread === undefined, "GitHub's decision is used only when classic protection was unread; an approved, unblocked merge adds nothing");
    const stepOf = (a: R.Approvals) => R.nextStep({ draft: false, author: "me", reviews: [], requiredReviewers: [], deps: [], envs: [], evidence: { verdict: "pass", source: "check", by: "qa", at: null, url: null, covers: "head", since: null, shas: [] }, evidenceSources: { accounts: [], checks: ["qa"], labels: [] }, approvals: a });
    ok(done.blocked && nul.blocked && !done.missing.length && stepOf(done).rule === "blocked" && stepOf(done).kind === "hold" && stepOf(clean("APPROVED", "CLEAN")).rule === "ready" && stepOf(clean("APPROVED", "UNKNOWN")).rule === "blocked",
      "classic protection unread and GitHub blocks the merge for a reason the rules do not show: on hold, not ready, and not a missing approval", JSON.stringify([done, stepOf(done)]));
    const lost = R.approvalsOf(none, [], { ...base, github: null }), half = R.approvalsOf(none, [], { ...base, github: { reviewDecision: null, mergeState: null, requested: [] } });
    ok(!lost.readable && lost.missing[0].kind === "unreadable" && !half.readable && /merge box/.test((half.missing[0] as any).reason), "classic protection unread and GitHub's merge box not read (or read without a merge state): unreadable, never ready", JSON.stringify(lost));
    ok(more.missing.length === 1 && more.missing[0].kind === "count", "the readable rules' own gaps come first; GitHub's decision adds nothing on top of them"); }
  ok(R.mergeRules([], null, { en: "x", tw: "x" }).readable === false && R.approvalsOf(R.mergeRules([], null, { en: "no admin", tw: "x" }), [], { files: [], codeowners: null, teamMembers: new Map() }).missing[0].kind === "unreadable", "unreadable rules say so instead of guessing");
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
  ok(sg.deps.some((d) => d.pr === "o/r#1" && d.on === "o/r#3" && d.kind === "depends-on") && sg.deps.some((d) => d.pr === "o/r#2" && d.on === "o/r#1" && d.kind === "stacked")  && sg.deps.length === 2, "dependencies only where the order is forced: Depends-on and stacked branches", JSON.stringify(sg.deps));
  ok(!sg.deps.some((d) => d.pr === "o/r#4") && sg.hints.some((h) => h.kind === "mentions" && h.first === "o/r#2" && h.then === "o/r#4"), "a body that only names another pull request orders it (a hint), never makes it a dependency", JSON.stringify(sg.hints));
  { const mutual = R.signals([facts("o/r#5", { body: "see o/r#6" }), facts("o/r#6", { body: "see o/r#5" })]); ok(!mutual.deps.length && mutual.hints.filter((h) => h.kind === "mentions").length === 2 && R.proposeOrder([facts("o/r#5"), facts("o/r#6")], mutual.deps, mutual.hints).length === 2, "two bodies naming each other: no dependency, and the order still comes out"); }
  { const both = R.signals([facts("o/r#7", { body: "Depends-on: #8, and see o/r#8" }), facts("o/r#8")]); ok(both.deps.length === 1 && !both.hints.some((h) => h.kind === "mentions"), "a pull request both depended on and named is one dependency, no extra hint"); }
  ok(sg.hints.some((h) => h.kind === "files" && h.first === "o/r#3" && h.then === "o/r#4"), "files both change: the older first");
  const order = R.proposeOrder(prs, sg.deps, sg.hints).map((x) => x.id);
  ok(order.indexOf("o/r#3") < order.indexOf("o/r#1") && order.indexOf("o/r#1") < order.indexOf("o/r#2") && order.indexOf("o/r#2") < order.indexOf("o/r#4"), "the proposed order puts every dependency first", order.join());
  ok(R.tagCommit("image: reg/app:3f2a1c9e\n", "image: reg/app:{tag}") === "3f2a1c9e" && R.tagCommit("image: reg/app:v1.4-3f2a1c9e # pinned\n", "image: reg/app:{tag} #") === "3f2a1c9e" && R.tagCommit("image: reg/app:latest\n", "image: reg/app:{tag}") === null && R.tagCommit("x", "no tag here") === null, "an image tag's commit: the trailing hex of the tag the template finds");
}
// ---------- round 2: the reviews' findings ----------
{
  const t0 = performance.now(); const hit = R.globMatch("a**a**a**a**a**a**a**a**b", "a".repeat(50)); const t1 = performance.now() - t0;
  const many = Array.from({ length: 2000 }, (_, i) => ({ pattern: `*a*a*a*a*a*a*${i}`, owners: ["@x"] })), t2 = performance.now(); R.ownersOf("a".repeat(255), many); const t3 = performance.now() - t2;
  ok(!hit && t1 < 20 && t3 < 1000, "CODEOWNERS: a pattern built to backtrack matches in linear time (no regular expression from the text)", `${t1.toFixed(1)} ms, 2000 lines ${t3.toFixed(1)} ms`);
  ok(R.globMatch("/docs/", "docs/a/b.md") && !R.globMatch("/docs/", "docs") && R.globMatch("*.md", "x/y/z.md") && R.globMatch("src/**/api.ts", "src/api.ts") && R.globMatch("src/**/api.ts", "src/a/b/api.ts") && !R.globMatch("src/*/api.ts", "src/a/b/api.ts") && R.globMatch("docs", "docs/x") && R.globMatch("a?c", "abc") && R.globMatch("*", "anything/at/all") && R.globMatch("x".repeat(300), "x".repeat(300)) === "limit" && R.globMatch("*", "y".repeat(2000)) === "limit",
    "CODEOWNERS globs: anchoring, directories, *, **, ?, and the length caps");
  const t4 = performance.now(); const v = R.classifyComment(`**a**${" ".repeat(65000)}b c`).verdict; const t5 = performance.now() - t4;
  ok(v === "unclassified" && t5 < 50, "a long comment line is never fed to a verdict pattern (no quadratic bold match)", `${t5.toFixed(1)} ms`);
  const t6 = performance.now(); const tc = R.tagCommit(`${"a".repeat(200)}\n`.repeat(1000), "a{tag}b"); const t7 = performance.now() - t6;
  ok(tc === null && t7 < 200 && R.tagCommit("a: 1\nimage: reg/app:3f2a1c9e\n", "image: reg/app:{tag}") === "3f2a1c9e", "the environment template is matched as literal text in linear time (no regular expression from the settings)", `${t7.toFixed(1)} ms`);
  let nested = ""; try { cleanSettings({ environments: [{ name: "prod", detect: { kind: "file", repository: "o/r", path: "a.yaml", template: "image: (a|aa)+$" } }] }); } catch (e: any) { nested = e.message; }
  let nested2 = ""; try { cleanSettings({ environments: [{ name: "prod", detect: { kind: "file", repository: "o/r", path: "a.yaml", template: "{tag} and {tag}" } }] }); } catch (e: any) { nested2 = e.message; }
  ok(/exactly one \{tag\}/.test(nested) && /exactly one \{tag\}/.test(nested2) && cleanSettings({ environments: [{ name: "prod", detect: { kind: "file", repository: "o/r", path: "a.yaml", template: "image: r/a:{tag}" } }] }).environments[0].detect.kind === "file", "settings: the environment file detector takes a literal template with exactly one {tag}, never a regular expression");
  for (const neg of ["Result: didn't pass", "## Didn’t pass", "Verdict: does not pass", "## Not passed", "Result: wasn't passing", "## 沒通過", "## 没通过", "結論：沒有通過"]) ok(R.classifyComment(neg).verdict === "fail", `a negated pass is a fail: ${neg}`);
  ok(R.classifyComment("## Not yet passed").verdict === "unclassified" && R.classifyComment("## 尚未通過").verdict === "unclassified", "not yet: unclassified, never pass");
  const crlf = "Intro\r\nline two\r\n";
  const w = R.replaceBlock(crlf, R.renderBlock(["o/r#3"], "o/r"));
  ok(w.startsWith("Intro\r\nline two") && w.includes("\r\n\r\n<!-- crew-studio:depends -->\r\nDepends-on:") && !/[^\r]\n/.test(w), "a body with CRLF keeps its line endings; the block is written in them", JSON.stringify(w));
  const fake = "Keep <!-- crew-studio:depends -->this real text<!-- /crew-studio:depends --> end";
  let refusedFake = ""; try { R.replaceBlock(fake, R.renderBlock(["o/r#3"], "o/r")); } catch (e: any) { refusedFake = e.message; }
  ok(/other text than Depends-on/.test(refusedFake) && R.blockProblem(`${R.renderBlock(["o/r#3"], "o/r")}\n${R.renderBlock(["o/r#4"], "o/r")}`)?.includes("more than one") === true, "a marker pair around other text, or two blocks, is refused, never deleted unseen");
  const rul = R.mergeRules([{ type: "pull_request", parameters: { required_approving_review_count: 0, require_code_owner_review: true } }], "none", null, "o");
  const unr = R.approvalsOf(rul, [], { files: [], codeowners: null, teamMembers: new Map(), ownersUnreadable: { en: "CODEOWNERS could not be read", tw: "x" } });
  // round 3: approval after the last push, with the pusher inferred
  const lpRules = R.mergeRules([{ type: "pull_request", parameters: { required_approving_review_count: 1, require_last_push_approval: true } }], "none", null, "o");
  const head = { author: "hana", committer: "cody" }, ap1 = (rv: R.ReviewView[]) => R.approvalsOf(lpRules, rv, { files: [], codeowners: null, teamMembers: new Map(), author: "pat", headCommit: head });
  const rvw = (login: string, stale = false, author = false): R.ReviewView => ({ login, state: "APPROVED", stale, at: "", author });
  ok(ap1([rvw("zoe", true)]).counted === 0 && ap1([rvw("zoe", true)]).missing[0].kind === "count", "after the last push: an approval on an older commit is stale and does not count");
  ok(ap1([rvw("pat", false, true)]).counted === 0, "after the last push: the pull request author's approval on the head does not count");
  ok(ap1([rvw("cody")]).counted === 0 && ap1([rvw("hana")]).counted === 0, "after the last push: the head commit's committer or author does not count (the inferred pusher)");
  const other = ap1([rvw("zoe")]);
  ok(other.readable && other.counted === 1 && !other.missing.length && other.inferredPusher!.join() === "pat,hana,cody", "after the last push: someone else's approval on the head counts; the inferred pusher is shown", JSON.stringify(other));
  const noHead = R.approvalsOf(lpRules, [rvw("zoe")], { files: [], codeowners: null, teamMembers: new Map(), author: "pat", headCommit: null });
  ok(!noHead.readable && /head commit could not be read/.test((noHead.missing[0] as any).reason), "after the last push without the head commit: unreadable");
  // round 3: CODEOWNERS limits never read as "no owner"
  const coRules = R.mergeRules([{ type: "pull_request", parameters: { required_approving_review_count: 0, require_code_owner_review: true } }], "none", null, "o");
  const longFile = [...Array.from({ length: 2500 }, (_, i) => `/unused${i}/ @nobody`), "* @owner-past-the-cap"].join("\n");
  ok(!!R.codeownersOverLimit(longFile) && !R.codeownersOverLimit("* @a\n"), "a CODEOWNERS whose rule is past the line cap is over the limit (unreadable), never parsed short");
  const longPat = R.approvalsOf(coRules, [], { files: ["src/a.ts"], codeowners: [{ pattern: `src/${"x".repeat(300)}`, owners: ["@a"] }], teamMembers: new Map() });
  const longPath = R.approvalsOf(coRules, [], { files: [`src/${"d/".repeat(600)}a.ts`], codeowners: [{ pattern: "*", owners: ["@a"] }], teamMembers: new Map() });
  ok(!longPat.readable && !longPath.readable && longPat.missing[0].kind === "unreadable" && R.globMatch("x".repeat(300), "x") === "limit", "an over-long CODEOWNERS pattern or changed path: unreadable, not no owner", JSON.stringify([longPat.missing, longPath.missing]));
  // round 3: removing the block keeps paragraph breaks
  const B = R.renderBlock(["o/r#3"], "o/r");
  for (const eol of ["\n", "\r\n"]) {
    const mid = `First paragraph${eol}${eol}${B.split("\n").join(eol)}${eol}${eol}Second paragraph`;
    ok(R.removeBlock(mid) === `First paragraph${eol}${eol}Second paragraph`, `removing a block between paragraphs keeps one paragraph break (${eol === "\n" ? "LF" : "CRLF"})`, JSON.stringify(R.removeBlock(mid)));
    const tight = `First paragraph  ${eol}${eol}${B.split("\n").join(eol)}${eol}Second paragraph${eol}`;
    ok(R.removeBlock(tight) === `First paragraph  ${eol}${eol}Second paragraph${eol}`, `a block directly above a paragraph: the paragraph break and trailing spaces stay (${eol === "\n" ? "LF" : "CRLF"})`, JSON.stringify(R.removeBlock(tight)));
    const orig = `Intro${eol}more${eol}`, appended = R.replaceBlock(orig, B);
    ok(R.removeBlock(appended) === orig, `appending then removing the block gives the body back byte for byte (${eol === "\n" ? "LF" : "CRLF"})`, JSON.stringify(R.removeBlock(appended)));
  }
  // round 5: the tag template
  { const t0 = performance.now(), r1 = R.tagCommit("version: 1\n", '{tag}"'), ms = performance.now() - t0;
    ok(r1 === null && ms < 50 && /text that comes before \{tag\}/.test(R.templateProblem('{tag}"') ?? "") && /text that comes before/.test(R.templateProblem("  {tag}") ?? ""), "a template with nothing before {tag} is refused, and tagCommit returns at once instead of looping", `${ms.toFixed(1)} ms`);
    ok(R.tagCommit("image: reg/app:3f2a1c9e-amd64\n", "image: reg/app:{tag}-amd64") === "3f2a1c9e" && R.tagCommit("image: reg/app:v2-3f2a1c9e-amd64 # x\n", "image: reg/app:{tag}-amd64 #") === "3f2a1c9e", "a template with text after {tag} matches (the suffix is found first)");
    ok(R.tagCommit(`image: reg/app:${"a".repeat(130)}3f2a1c9e\n`, "image: reg/app:{tag}") === null && R.tagCommit(`image: reg/app:${"a".repeat(100)}-3f2a1c9e\n`, "image: reg/app:{tag}") === "3f2a1c9e", "a tag over 128 characters is no tag (never cut to its last hex)");
    ok(R.tagCommit("image: reg/app:20241112\n", "image: reg/app:{tag}") === null && R.tagCommit("image: reg/app:1.4.0-20241112\n", "image: reg/app:{tag}") === null && R.commitOfTag("app-3f2a1c9") === "3f2a1c9", "an all-digit tag (a date, a build number) is no commit"); }
  // round 5: Studio never writes a block it would refuse
  ok(R.renderBlock(Array.from({ length: 120 }, (_, i) => `o/r#${i + 1}`), "o/r").length > R.BLOCK_MAX, "120 dependencies render past the block limit (what the apply refuses)");
  // round 4
  { const lp0 = R.mergeRules([{ type: "pull_request", parameters: { required_approving_review_count: 0, require_last_push_approval: true } }], "none", null, "o");
    const none = R.approvalsOf(lp0, [], { files: [], codeowners: null, teamMembers: new Map(), author: "pat", headCommit: { author: "pat", committer: "pat" } });
    const byPusher = R.approvalsOf(lp0, [{ login: "pat", state: "APPROVED", stale: false, at: "", author: true }], { files: [], codeowners: null, teamMembers: new Map(), author: "pat", headCommit: { author: "pat", committer: "pat" } });
    const byOther = R.approvalsOf(lp0, [{ login: "zoe", state: "APPROVED", stale: false, at: "", author: false }], { files: [], codeowners: null, teamMembers: new Map(), author: "pat", headCommit: { author: "pat", committer: "pat" } });
    ok(none.missing[0]?.kind === "count" && byPusher.missing.length === 1 && !byOther.missing.length, "after the last push with no approval count: one approval on the head by someone other than the pusher is still needed"); }
  { const rules = Array.from({ length: 2000 }, (_, i) => ({ pattern: `**/a/**/a/**/a/**/a/**/a/**/b${i}`, owners: ["@x"] })), files = Array.from({ length: 300 }, (_, i) => `${"a/".repeat(30)}f${i}`);
    const co4 = R.mergeRules([{ type: "pull_request", parameters: { required_approving_review_count: 0, require_code_owner_review: true } }], "none", null, "o");
    const t0 = performance.now(), got = R.approvalsOf(co4, [], { files, codeowners: rules, teamMembers: new Map() }), ms = performance.now() - t0;
    ok(!got.readable && got.missing[0].kind === "unreadable" && ms < 3000, "CODEOWNERS work is bounded by a step budget per row: past it the owners are unreadable", `${ms.toFixed(0)} ms`);
    ok(R.globMatch("*", Array.from({ length: 33 }, () => "d").join("/")) === "limit", "a path over 32 segments is past the limit"); }
  { const blk = (inner: string) => `${R.BLOCK_START}\n${inner}\n${R.BLOCK_END}`;
    ok(R.blockProblem(blk("Depends-on: https://github.com/o/r/pull/3, o/r#4 #5")) === null && /naming pull requests/.test(R.blockProblem(blk("Depends-on: see the plan in the wiki")) ?? "") && /over 4000/.test(R.blockProblem(blk(`Depends-on: ${"#1 ".repeat(1400)}`)) ?? ""),
      "the block GitHub has must be Depends-on lines naming pull requests, and short enough for the card to show whole"); }
  ok(R.removeBlock(`a ${B} b`) === "a  b" && R.removeBlock(`${B}\n\nRest`) === "Rest", "a block inside a line goes alone; a block at the very start takes its separator");
  const rb = R.removeBlock(`Intro\n\n${R.renderBlock(["o/r#3"], "o/r")}\n`); ok(rb === "Intro\n", "removing the block keeps the rest of the body", JSON.stringify(rb));
  ok(!unr.readable && unr.missing[0].kind === "unreadable" && R.approvalsOf(rul, [], { files: ["a"], codeowners: null, teamMembers: new Map() }).readable, "code owners that cannot be checked are unreadable, distinct from no CODEOWNERS file");
}
{ // round 4: the ETag cache is bounded by bytes, keeps none over 256 KB, and drops the least recently used first
  const c = new EtagCache(700, 400);
  c.set("/a", "e1", "x".repeat(300)); c.set("/b", "e2", "y".repeat(300)); c.get("/a"); c.set("/c", "e3", "z".repeat(300)); c.set("/big", "e4", "w".repeat(500));
  ok(!!c.get("/a") && !c.get("/b") && !!c.get("/c") && !c.get("/big") && c.bytes <= 700, "the ETag cache holds at most its byte budget, keeps nothing over the entry cap, and evicts the least recently used", `${c.size} entries, ${c.bytes} bytes`); }
// ---------- settings and the API origin ----------
{
  let msg = ""; try { cleanSettings({ evidence: { accounts: ["bad name!"] } }); } catch (e: any) { msg = e.message; }
  ok(/not a GitHub account/.test(msg), "settings: an account name GitHub does not allow is refused");
  msg = ""; try { cleanSettings({ environments: [{ name: "prod", detect: { kind: "file", repository: "o/r", path: "../etc/passwd", template: "x:{tag}" } }] }); } catch (e: any) { msg = e.message; }
  ok(/plain path/.test(msg), "settings: a file path that climbs is refused");
  const keep = process.env.CREW_GITHUB_API;
  process.env.CREW_GITHUB_API = "https://evil.example"; let refused = false; try { apiBase(); } catch { refused = true; }
  process.env.CREW_GITHUB_API = ""; const def = apiBase(); process.env.CREW_GITHUB_API = keep;
  ok(refused && def === "https://api.github.com", "the API origin is api.github.com (a loopback test server only through CREW_GITHUB_API)");
}

// ---------- the module against the fictional GitHub ----------
const gh = prWatchGitHub();
const H = await harness([bundledText(`workflows/v2/${APPLY_WORKFLOW}.wf.yaml`)!]), E = H.engine;
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1";
// CREW_GH=0 (the firstmate dashboard's poller off) leaves this list on; only CREW_PR_WATCH=0 turns it off
process.env.CREW_GH = "0"; delete process.env.CREW_PR_WATCH;
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
  // no settings yet: the environments are each repository's own, and evidence offers who may post it
  { await until(() => !!W.snapshot.at, 10000); await call("/api/prs/refresh", {}); const v0 = (await call("/api/prs")).body, envOf = (id: string) => row(v0, id).envs.map((e: any) => `${e.name}:${e.on}${e.auto ? "" : "!"}${e.production ? "P" : ""}`).join();
    ok(envOf("northwind/checkout-api#17") === "dev:false,staging:true,preproduction:false" && envOf("northwind/checkout-api#19") === "dev:true,staging:false,preproduction:false" && row(v0, "northwind/web-app#30").envs.length === 0,
      "no environments set: a repository's GitHub environments that have a successful deployment (production, never deployed, is left out), on when the newest successful one (not a newer failed one) contains the head", JSON.stringify([envOf("northwind/checkout-api#17"), envOf("northwind/checkout-api#19")]));
    ok(v0.rows.every((r: any) => r.next.rule !== "environment"), "a repository's own environments are shown only: they never make the next step deploy for testing");
    ok(v0.suggest.evidenceAccounts[0]?.login === "qa-lin" && !v0.suggest.evidenceAccounts.some((x: any) => ["skipper", "review-bot", "ana", "bo", "rel-ray"].includes(x.login)) && v0.rows.every((r: any) => r.evidence === null),
      "no evidence source set: no evidence is guessed, and the people who commented without authoring or reviewing are offered", JSON.stringify(v0.suggest)); }
  ok((await call("/api/prs/settings", { settings: fixtureSettings })).status === 200, "settings saved");
  await until(() => !!W.snapshot.at, 10000); await call("/api/prs/refresh", {});
  let v = (await call("/api/prs")).body;
  ok(v.enabled === true && v.connected === true && v.rows.length > 0, "CREW_GH=0 does not turn the list off: it reads GitHub with the token");
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
  ok(a18.required === 2 && a18.counted === 1 && a18.missing.some((m: any) => m.kind === "count" && m.n === 1) && a18.missing.some((m: any) => m.kind === "owner" && m.who.join() === "@dana") && a18.missing.some((m: any) => m.kind === "team" && m.who === "@northwind/release"),
    "missing approvals from the ruleset: the count (the author's own approval ignored, a stale one counted as the rules allow), a code owner, a required team", JSON.stringify(a18));
  ok(row(v, "northwind/checkout-api#18").reviews.some((r: any) => r.login === "bo" && r.stale), "the approval given on an older head shows stale");
  const a30 = row(v, "northwind/web-app#30").approvals;
  ok(a30.counted === 0 && a30.missing[0]?.n === 1 && a30.sources.join() === "protection", "classic protection that dismisses stale approvals: the stale approval does not count", JSON.stringify(a30));
  const a40 = row(v, "northwind/ledger#40").approvals;
  ok(a40.readable && /admin/.test(a40.unread?.[0]?.en ?? "") && a40.missing.some((m: any) => m.kind === "count" && m.n === 1) && a40.missing.some((m: any) => m.kind === "team" && m.who === "@northwind/finance")
    && nx("northwind/ledger#40").who.includes("@northwind/finance") && a40.github?.mergeState === "BLOCKED" && a40.github?.requested.join() === "@northwind/finance",
    "branch protection that needs admin: the readable ruleset still decides (a team named only by id gets its name), with GitHub's merge box beside it", JSON.stringify(a40));
  { const g18 = row(v, "northwind/checkout-api#18").approvals.groups, g19 = row(v, "northwind/checkout-api#19").approvals.groups;
    ok(g18.some((g: any) => g.kind === "team" && g.who === "@northwind/release" && !g.ok) && g18.some((g: any) => g.kind === "owner" && g.who === "@dana" && !g.ok)
      && g19.every((g: any) => g.ok) && g19.some((g: any) => g.who === "@northwind/release" && g.by.join() === "rel-ray"), "each approval group shows met or not and by whom", JSON.stringify([g18, g19])); }
  ok(row(v, "northwind/checkout-api#19").ci === "SUCCESS" && row(v, "northwind/checkout-api#20") === undefined && (row(v, "northwind/mobile#5").ci === "SUCCESS") && row(v, "northwind/web-app#30").ci === "FAILURE" && row(v, "northwind/ledger#40").ci === null, "CI is GitHub's combined state for the head (none when GitHub's last commit is another one)", JSON.stringify(row(v, "northwind/checkout-api#19").ci));
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
  { gh.data.find("northwind/web-app", 30)!.github!.ci = "SUCCESS"; // a refresh may still be running from the calls above: refresh until it is read
    for (let i = 0; i < 20 && W.snapshot.rows.find((r) => r.id === "northwind/web-app#30")?.ci !== "SUCCESS"; i++) { await call("/api/prs/refresh", {}); await new Promise((r) => setTimeout(r, 250)); }
    const vc = (await call("/api/prs")).body, ch = row(vc, "northwind/web-app#30").changed;
    ok(row(vc, "northwind/web-app#30").ci === "SUCCESS" && ch?.what.some((w: any) => w.k === "ci" && w.state === "SUCCESS") && ch.what.every((w: any) => w.k !== "head"), "CI that turns green on the same head marks the row changed", JSON.stringify(ch)); }
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
  ok(card?.captainOnly && card.body.includes("<!-- crew-studio:depends -->\nDepends-on: https://github.com/northwind/checkout-api/pull/15\n<!-- /crew-studio:depends -->") && card.body.includes("Repository / 儲存庫: northwind/checkout-api") && card.body.includes("No block on GitHub yet"), "the captain-only card shows the exact block, the target repository and what is there now", card?.body);
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
  // round 2: a CODEOWNERS that cannot be read is not "no owners"; a 304 reuses the kept answer; evidence that names no
  // commit counts for a head Studio saw before it; a write GitHub kept differently is reported; a cancelled Task stops
  gh.knobs.codeownersFail = true; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body; gh.knobs.codeownersFail = false;
  ok(!row(v, "northwind/checkout-api#18").approvals.readable && row(v, "northwind/checkout-api#18").next.rule === "approvals" && /CODEOWNERS/.test(row(v, "northwind/checkout-api#18").approvals.missing[0].reason), "CODEOWNERS that cannot be read: the approvals are unreadable, never ready", JSON.stringify(row(v, "northwind/checkout-api#18").approvals));
  const nm0 = gh.notModified; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(gh.notModified > nm0 + 20, "a refresh asks with If-None-Match and reuses the answers GitHub says did not change (304)", `${gh.notModified - nm0}`);
  const mb = gh.data.find("northwind/mobile", 5)!;
  ok(row(v, "northwind/mobile#5").evidence === null, "precondition: no evidence on the single pull request");
  mb.comments = [{ user: "qa-lin", body: "## PASS", at: new Date(Date.now() + 1000).toISOString() }];
  await new Promise((r) => setTimeout(r, 1100)); await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(row(v, "northwind/mobile#5").evidence?.covers === "head", "a comment naming no commit, written after Studio saw the head, covers the head", JSON.stringify(row(v, "northwind/mobile#5").evidence));
  const p17 = gh.data.find("northwind/checkout-api", 17)!; p17.comments!.push({ user: "qa-lin", body: "# PASS", at: "2026-11-01T09:00:00Z" });
  await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body; p17.comments!.pop();
  ok(row(v, "northwind/checkout-api#17").evidence?.covers === "unknown" && row(v, "northwind/checkout-api#17").next.rule === "evidence", "a comment naming no commit, older than when Studio saw the head: unknown, test again", JSON.stringify(row(v, "northwind/checkout-api#17").evidence));
  await call("/api/prs/deps", { pr: "northwind/web-app#30", on: ["northwind/checkout-api#19"] });
  gh.knobs.tamper = true; const before5 = writes().length;
  const apT = await call("/api/prs/apply", { prs: ["northwind/web-app#30"] }); await until(() => !!E.cards.list({ run: apT.body.task }).find((c: any) => c.status === "open"), 10000);
  await E.answer((E.cards.list({ run: apT.body.task }).find((c: any) => c.status === "open") as any).id, { choice: "apply", by: "captain" });
  await until(() => E.list().find((r: any) => r.id === apT.body.task)!.status === "succeeded", 10000); gh.knobs.tamper = false;
  const noteT = String(E.list().find((r: any) => r.id === apT.body.task)!.nodes?.write?.note ?? "");
  ok(writes().length === before5 + 1 && /differs from what Studio wrote/.test(noteT) && !W.state.applied["northwind/web-app#30"], "a body GitHub kept differently from what Studio wrote is reported, not recorded as applied", noteT);
  gh.data.find("northwind/web-app", 30)!.body = "";
  gh.knobs.slowPull = { path: "/repos/northwind/web-app/pulls/30", ms: 800 };
  const apC = await call("/api/prs/apply", { prs: ["northwind/web-app#30"] }); await until(() => !!E.cards.list({ run: apC.body.task }).find((c: any) => c.status === "open"), 10000);
  const before6 = writes().length;
  await E.answer((E.cards.list({ run: apC.body.task }).find((c: any) => c.status === "open") as any).id, { choice: "apply", by: "captain" });
  await new Promise((r) => setTimeout(r, 200)); E.cancel(apC.body.task); await new Promise((r) => setTimeout(r, 1200)); gh.knobs.slowPull = null;
  ok(writes().length === before6, "a Task cancelled while GitHub answers writes nothing after", JSON.stringify(writes().slice(before6)));
  // round 2, the other review threads: a failed branch deployment runs nothing; removing the last dependency removes the
  // block through the card; a watch removed while a refresh runs stays removed
  gh.data.deployments[1].state = "failure"; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body; gh.data.deployments[1].state = "success";
  ok(row(v, "northwind/checkout-api#17").envs.find((e: any) => e.name === "staging")?.on === false, "a branch whose latest deployment failed does not run the head");
  await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(row(v, "northwind/checkout-api#17").envs.find((e: any) => e.name === "staging")?.on === true, "precondition back: the successful deployment runs it");
  const has14 = String(gh.data.find("northwind/checkout-api", 14)!.body);
  ok(!!R.findBlock(has14), "precondition: #14's body has the block");
  await call("/api/prs/deps", { pr: "northwind/checkout-api#14", on: [] });
  const apR = await call("/api/prs/apply", { prs: ["northwind/checkout-api#14"] }); await until(() => !!E.cards.list({ run: apR.body.task }).find((c: any) => c.status === "open"), 10000);
  const cR: any = E.cards.list({ run: apR.body.task }).find((c: any) => c.status === "open");
  ok(apR.status === 200 && /the block is removed/.test(cR.body), "with no dependency left the card offers to remove the block", JSON.stringify(apR.body));
  await E.answer(cR.id, { choice: "apply", by: "captain" }); await until(() => E.list().find((r: any) => r.id === apR.body.task)!.status === "succeeded", 10000);
  const after14b = String(gh.data.find("northwind/checkout-api", 14)!.body);
  ok(!R.findBlock(after14b) && after14b.trim() === R.stripBlock(has14).trim() && !Object.keys(W.state.applied).some((k) => k.toLowerCase() === "northwind/checkout-api#14"), "the block is gone from GitHub and from Studio's record; the rest of the body kept", JSON.stringify(after14b));
  gh.knobs.slowPull = { path: "/repos/northwind/mobile/pulls/5", ms: 600 };
  const running = call("/api/prs/refresh", {}); await new Promise((r) => setTimeout(r, 150));
  await call("/api/prs/unwatch", { repo: "northwind/ledger" }); await running; gh.knobs.slowPull = null; v = (await call("/api/prs")).body;
  ok(!row(v, "northwind/ledger#40") && !W.snapshot.rows.some((r) => r.id === "northwind/ledger#40"), "a repository removed while a refresh runs does not come back with it");
  await call("/api/prs/watch", { url: "https://github.com/northwind/ledger" }); await call("/api/prs/refresh", {});
  // round 3: classic protection asking for an approval after the last push, against the fixture
  const wa = gh.data.rules["northwind/web-app"].protection.body.required_pull_request_reviews; wa.require_last_push_approval = true;
  const p30 = gh.data.find("northwind/web-app", 30)!, h30 = gh.data.head(p30), keepReviews = [...p30.reviews!];
  p30.reviews!.push({ user: "skipper", state: "APPROVED", commit: h30, at: "2026-11-02T10:00:00Z" }, { user: "zoe", state: "APPROVED", commit: h30, at: "2026-11-02T10:01:00Z" });
  await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  const a30b = row(v, "northwind/web-app#30").approvals;
  ok(a30b.readable && a30b.lastPush && a30b.counted === 1 && !a30b.missing.length && a30b.inferredPusher.includes("skipper"), "after the last push (fixture): ana's older approval is stale, the author's is not counted, zoe's on the head counts; the pusher is shown as inferred", JSON.stringify(a30b));
  wa.require_last_push_approval = false; p30.reviews = keepReviews;
  // round 4: GitHub handing the body back normalised (CRLF, trailing spaces) is still a good write
  gh.data.find("northwind/web-app", 30)!.body = "Line one  \r\nLine two\r\n"; await call("/api/prs/deps", { pr: "northwind/web-app#30", on: ["northwind/checkout-api#19"] });
  gh.knobs.normalizeOnPatch = true;
  const apN = await call("/api/prs/apply", { prs: ["northwind/web-app#30"] }); await until(() => !!E.cards.list({ run: apN.body.task }).find((c: any) => c.status === "open"), 10000);
  await E.answer((E.cards.list({ run: apN.body.task }).find((c: any) => c.status === "open") as any).id, { choice: "apply", by: "captain" });
  await until(() => E.list().find((r: any) => r.id === apN.body.task)!.status === "succeeded", 10000); gh.knobs.normalizeOnPatch = false;
  ok(Object.keys(W.state.applied).some((k) => k.toLowerCase() === "northwind/web-app#30"), "a body GitHub normalised (line endings, trailing spaces) still counts as written", String(E.list().find((r: any) => r.id === apN.body.task)!.nodes?.write?.note));
  // round 5: a block over the limit is refused before any card
  const many = Array.from({ length: 80 }, (_, i) => `northwind/other#${i + 1}`);
  W.state.deps["northwind/checkout-api#19"] = { on: many, by: "captain", at: "2026-11-12T00:00:00Z" };
  const big = await call("/api/prs/apply", { prs: ["northwind/checkout-api#19"] });
  ok(big.status === 400 && /at most 4000 fit/.test(big.body.error), "too many dependencies for the block: the apply is refused with the reason, nothing is written", JSON.stringify(big.body));
  delete W.state.deps["northwind/checkout-api#19"];
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
  // a repository's own environments are for show: past their read cap the refresh still succeeds, without them
  { const dir = mkdtempSync(join(tmpdir(), "pr-watch-cap-")), p2 = new GitHubPoller(), W2 = createPrWatch({ dataDir: dir, poller: p2, notify: () => {}, limits: { autoReads: 2 } });
    try { const u = new URL("http://127.0.0.1/api/prs/watch"); await W2.handle(new Request(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://github.com/northwind/checkout-api" }) }), u, { kind: "desktop" }, true);
      await until(() => !!W2.snapshot.at, 10000); const r17 = W2.snapshot.rows.find((r) => r.id === "northwind/checkout-api#17");
      ok(!!r17 && r17.envs.length === 0 && !W2.snapshot.errors.some((e) => /budget/i.test(e.en)), "past the cap on reads for a repository's own environments the refresh still reads the rows, with no environments", JSON.stringify(r17?.envs));
    } finally { W2.stop(); p2.stop(); rmSync(dir, { recursive: true, force: true }); } }
  { process.env.CREW_PR_WATCH = "0"; const off = (await call("/api/prs")).body, r = (await call("/api/prs/refresh", {})).body; delete process.env.CREW_PR_WATCH;
    ok(off.enabled === false && off.connected === false && String(r.error?.en ?? "").includes("CREW_PR_WATCH=0"), "CREW_PR_WATCH=0 is the list's own off switch, and the refresh says so", JSON.stringify(r.error)); }
} finally { W.stop(); poller.stop(); gh.stop(); H.stop(); }

{ // round 5: a bad template saved by an older Studio is dropped on load, with a message, never run
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
  const dd = mkdtempSync(join(tmpdir(), "prw-saved-")); mkdirSync(join(dd, "pr-watch"));
  writeFileSync(join(dd, "pr-watch", "state.json"), JSON.stringify({ schema: 1, settings: { environments: [{ name: "prod", production: true, repos: [], detect: { kind: "file", repository: "o/r", path: "a.yaml", template: '{tag}"' } }, { name: "qa", production: false, repos: [], detect: { kind: "check", name: "deploy/qa" } }] }, watch: { repos: [], prs: [], excluded: [] }, order: null, deps: {}, applied: {}, groups: {} }));
  const p2 = new GitHubPoller(), W2 = createPrWatch({ dataDir: dd, poller: p2 }), v2 = W2.view();
  ok(v2.settings.environments.map((e: any) => e.name).join() === "qa" && /prod/.test(v2.settingsWarning?.en ?? ""), "a saved template that fails the checks is dropped on load and the page says which", JSON.stringify(v2.settingsWarning));
  W2.stop(); p2.stop(); }
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
