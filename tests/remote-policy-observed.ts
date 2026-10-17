import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Branch protection GitHub will not show (a private repository on a free plan answers 403 "Upgrade to GitHub
// Pro or make this repository public"): the required checks become every check reported on the PR head, a
// notice is recorded, and the Task reaches the merge-on-GitHub card instead of "Remote verification
// stopped". Real failures keep their own typed cards: a red check, a closed pull request, refused access.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { GitHubPrAdapter } from "../src/adapters/github";
import { requiredPolicy, inspectRemote, grantIdentity } from "../src/domain/remote-ci";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";

const { ok, end } = suite("remote-policy-observed");
const temp = checkedTempDir("remote-observed-"); setGitHome(join(temp, "git-home"));
const repo = join(temp, "source"), bare = join(temp, "remote.git"); mkdirSync(repo); assertTempRepo(repo);
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]); must(repo, ["remote", "add", "origin", "https://github.com/fixture/project.git"]);
must(temp, ["clone", "--bare", "-q", repo, bare]);
const baseCommit = must(repo, ["rev-parse", "HEAD"]);
const sim = githubSimulator(bare);
const PLAN = { message: "Upgrade to GitHub Pro or make this repository public to enable this feature.", documentation_url: "https://docs.github.com/rest/branches/branch-protection" };
const POLICY = "/branches/main/protection/required_status_checks";
const grant: any = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-17T00:00:00Z", approvalId: "test" };
const adapter = new GitHubPrAdapter(grant, () => "fake-token", 3000);
const commit = (text: string) => { writeFileSync(join(repo, "file"), text); must(repo, ["commit", "-qam", text]); return must(repo, ["rev-parse", "HEAD"]); };
const rows = (head: string, checks: any[], statuses: any[] = []) => { sim.expect("GET", `/commits/${head}/check-runs?filter=all&per_page=100&page=1`, { total_count: checks.length, check_runs: checks }); sim.expect("GET", `/commits/${head}/status?per_page=100&page=1`, { sha: head, total_count: statuses.length, statuses }); };
const run1 = (head: string, over: any = {}) => ({ id: 1, name: "test", app: { id: 15368 }, head_sha: head, status: "completed", conclusion: "success", ...over });

try {
  // ---------- the policy read: the plan 403 is "not readable on this plan", a bare 403 stays an authorization failure ----------
  sim.expect("GET", POLICY, PLAN, undefined, 403);
  const policy = await requiredPolicy(adapter);
  ok(policy.observed === "plan" && !policy.checks.length && !policy.contexts.length, "a 403 'Upgrade to GitHub Pro' policy read is branch protection not readable on this plan", JSON.stringify(policy));
  sim.expect("GET", POLICY, { message: "Branch not protected" }, undefined, 404);
  ok((await requiredPolicy(adapter)).observed === "none", "a 404 'Branch not protected' is no protection: every check on the head is required");
  sim.expect("GET", POLICY, { message: "Resource not accessible by integration" }, undefined, 403);
  let refused = ""; try { await requiredPolicy(adapter); } catch (e: any) { refused = e.message; }
  ok(refused === "GitHub 403", "any other 403 stays an authorization failure (no vendor text)", refused);

  // ---------- inspection on the observed policy: every check reported on the head must be green ----------
  const h0 = commit("inspect"); must(repo, ["checkout", "-qb", "crew/inspect"]);
  mkdirSync(join(temp, "rec0")); const pr0 = await adapter.open({ repo, base: "main", branch: "crew/inspect", head: h0, title: "Inspect", body: "b" }, join(temp, "rec0"));
  sim.expect("GET", POLICY, PLAN, undefined, 403);
  const state = async (checks: any[], statuses: any[] = []) => { rows(h0, checks, statuses); return (await inspectRemote(adapter, pr0, policy)).state; };
  ok(await state([]) === "pending", "no check reported on the head yet: pending, never a vacuous pass");
  ok(await state([run1(h0, { status: "in_progress", conclusion: null })]) === "pending", "a running check is pending");
  ok(await state([run1(h0)]) === "pass", "every reported check green: pass");
  ok(await state([run1(h0), run1(h0, { id: 2, name: "lint", conclusion: "failure" })]) === "fail", "any reported check red: fail");
  ok(await state([run1(h0, { conclusion: "failure" }), run1(h0, { id: 5 })]) === "pass", "a re-run's latest result counts");
  ok(await state([run1(h0)], [{ id: 9, context: "ci/legacy", state: "failure" }]) === "fail", "a red commit status fails too");
  must(repo, ["checkout", "-q", "main"]);

  // ---------- the Task: the pull request opens, remote CI waits on the observed policy, the merge-on-GitHub card follows ----------
  const flow = Y({ id: "obs-flow", name: "Observed flow", roles: [], nodes: [
    { id: "seed", kind: "hook", do: "fixture.seed", label: "Seed", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Review request", x: 1, y: 0 },
    { id: "merge-card", kind: "card", label: "Merge card", args: { body_from: "merge", card_kind: "merge" }, x: 2, y: 0 },
    { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 3, y: 1 }],
    edges: [["seed", "pr-open"], ["pr-open", "merge-card", "ok"], ["pr-open", "closed", "close"], ["merge-card", "closed", "close"]] });
  const H = await harness([flow]), E = H.engine;
  installCode(E, { dataDir: H.data, projects: new Projects(H.data), adapter });
  E.actions["fixture.seed"] = (x) => {
    const branch = x.run.params.branch; must(repo, ["checkout", "-qb", branch, "main"]); const head = commit(branch); must(repo, ["checkout", "-q", "main"]);
    Object.assign(x.ctx, { repo, worktree: repo, base: "main", baseCommit, head, branch, door: { door: "two-way" }, spec: { title: "Observed", what: "w", why: ["y"], done: ["d"], scope: ["file"] } });
    must(repo, ["checkout", "-q", branch]); return "ok";
  };
  const start = async (branch: string) => { const r = E.start({ workflow: "obs-flow", text: "observed", params: { branch } }); await until(() => !!E.cards.list({ run: r.id, open: true }).length || ["succeeded", "failed"].includes(r.status), 15000); return r; };
  const openCard = (r: any) => E.cards.list({ run: r.id, open: true })[0];
  const headOf = (branch: string) => must(repo, ["rev-parse", branch]);
  try {
    // green: the observed policy carries the Task to the merge-on-GitHub card, with the notice
    sim.expect("GET", POLICY, PLAN, undefined, 403);
    const seed = E.actions["fixture.seed"];
    const pre = (_branch: string, checks: (h: string) => any[]) => (x: any) => { const r = seed(x); rows(x.ctx.head, checks(x.ctx.head)); return r; };
    E.actions["fixture.seed"] = pre("crew/green", (h) => [run1(h)]);
    const green = await start("crew/green"); const gc = openCard(green);
    ok(gc?.title.en === `Pull request #${green.ctx.pr?.id} is open: merge it on GitHub` && !/Remote verification stopped/.test(gc.title.en) && gc.body.includes(`PR #${green.ctx.pr.id} is open at ${green.ctx.pr.url}; merging from Studio is off`),
      "a free-plan private repository reaches the merge-on-GitHub card, not 'Remote verification stopped'", `${gc?.title?.en} | ${gc?.body?.slice(0, 200)}`);
    ok(gc.body.includes("GitHub does not show branch protection for this private repository on its current plan") && gc.body.includes("私有儲存庫"), "the merge card carries the notice (en and zh-TW)", gc.body);
    ok(E.trusted(green.id).entries.some((e: any) => e.record === "remote-policy-notice" && e.data?.observed === "plan" && e.head === headOf("crew/green")) && E.trusted(green.id).entries.some((e: any) => e.record === "external-ci" && e.verdict === "pass"),
      "the notice is recorded in the ledger and remote CI passed on every reported check");
    await E.answer(gc.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(green.status), 8000);

    // red: a failing check is its own typed card
    E.actions["fixture.seed"] = pre("crew/red", (h) => [run1(h, { conclusion: "failure" })]);
    const red = await start("crew/red"); const rc = openCard(red);
    ok(rc?.title.en === "Checks failed on the pull request: check again or close this task?" && rc.body.includes("check test did not succeed") && rc.options.map((o: any) => o.id).join() === "check,close", "a red check raises the typed 'Checks failed' card (re-run it on GitHub, then check again)", rc?.title?.en);
    await E.answer(rc.id, { choice: "close", by: "captain" } as any);

    // refused access: a plain 403 on the policy read is the typed authorization card
    sim.expect("GET", POLICY, { message: "Resource not accessible by integration" }, undefined, 403);
    E.actions["fixture.seed"] = pre("crew/denied", (h) => [run1(h)]);
    const denied = await start("crew/denied"); const dc = openCard(denied);
    ok(dc?.title.en === "GitHub refused the project's access: check again or close this task?" && dc.body.includes("(authorization)") && dc.sections?.["zh-TW"]?.why?.includes("授權"), "a refused policy read raises the typed authorization card", dc?.title?.en);
    await E.answer(dc.id, { choice: "close", by: "captain" } as any);
    E.actions["fixture.seed"] = seed;
  } finally { H.stop(); }

  // ---------- an operations grant on an observed policy: Studio never merges; the card and the merge hook both refuse ----------
  // (the required checks are only what Studio saw on the head, not what GitHub enforces, so no Merge option, no PUT, and no
  // merge attempt recorded that would lock the head)
  const ops = new GitHubPrAdapter({ ...grant, operations: { version: 1, repository: "fixture/project", approvalId: "fixture-op", approvedAt: "2026-10-17T00:00:00Z", mergeMethod: "merge" } }, () => "fake-token", 3000);
  {
    const H2 = await harness([flow]), E2 = H2.engine; let dir = "";
    installCode(E2, { dataDir: H2.data, projects: new Projects(H2.data), adapter: ops });
    const seedOps = E.actions["fixture.seed"]; E2.actions["fixture.seed"] = (x) => { dir = x.dir; const r = seedOps(x); rows(x.ctx.head, [run1(x.ctx.head)]); return r; };
    try {
      sim.expect("GET", POLICY, PLAN, undefined, 403); const before = sim.calls.length;
      const r = E2.start({ workflow: "obs-flow", text: "observed", params: { branch: "crew/ops-card" } });
      await until(() => !!E2.cards.list({ run: r.id, open: true }).length || ["succeeded", "failed"].includes(r.status), 15000);
      const c = E2.cards.list({ run: r.id, open: true })[0];
      ok(c?.title.en === `Pull request #${r.ctx.pr?.id} is open: merge it on GitHub` && !c.options.some((o: any) => o.id === "merge") && c.body.includes("only observed") && c.options.map((o: any) => o.id).join() === "close,changes",
        "operations grant + observed policy: the merge card offers no Merge option; the green pull request is the captain's to merge on GitHub", `${c?.title?.en} | ${JSON.stringify(c?.options?.map((o: any) => o.id))}`);
      ok(!sim.calls.slice(before).some((k: any) => k.method === "PUT") && !existsSync(join(dir, "remote-merge-attempts.json")), "no PUT and no merge attempt recorded", dir);
    } finally { H2.stop(); }
  }
  {
    must(repo, ["checkout", "-qb", "crew/ops-merge", "main"]); const h = commit("ops-merge"); must(repo, ["checkout", "-q", "main"]);
    mkdirSync(join(temp, "rec-ops")); const pr = await ops.open({ repo, base: "main", branch: "crew/ops-merge", head: h, title: "Ops", body: "b" }, join(temp, "rec-ops"));
    sim.expect("GET", POLICY, PLAN, undefined, 403); const observed = await requiredPolicy(ops);
    const H3 = await harness([Y({ id: "ops-merge", name: "Ops merge", roles: [], nodes: [{ id: "n", kind: "hook", do: "fixture.merge", label: "Merge", x: 0, y: 0 }], edges: [] })]), E3 = H3.engine;
    installCode(E3, { dataDir: H3.data, projects: new Projects(H3.data), adapter: ops }); let message = "", dir = "";
    E3.actions["fixture.merge"] = async (x) => {
      dir = x.dir; Object.assign(x.ctx, { repo, worktree: repo, head: h, baseCommit, base: "main", branch: pr.branch, pr, gatedHead: h, door: { door: "two-way" }, spec: { title: "Ops", what: "w", why: ["y"], done: ["d"] }, remoteCI: { state: "pass", head: h, policyHash: observed.hash, grant: grantIdentity(ops) } });
      for (const name of ["branch", "rebase", "scope", "failfirst", "ci", "approval", "design"]) E3.record(x, "fixture-gate", { check: `firstmate/gate-${name}`, head: h, verdict: "pass" } as any);
      E3.record(x, "remote-merge-request", { head: h, data: { version: 1, card: "fixture-card", grant: grantIdentity(ops), repository: ops.grant.repository, pr: pr.id, branch: pr.branch, base: pr.base, baseHead: baseCommit, head: h, method: "merge", policyHash: observed.hash } } as any);
      E3.record(x, "card-answer", { head: h, actor: "captain", data: { card: "fixture-card", kind: "merge", choice: "merge" } } as any);
      must(repo, ["checkout", "-q", pr.branch]); sim.expect("GET", POLICY, PLAN, undefined, 403); rows(h, [run1(h)]);
      try { await E3.actions["git.merge"](x); } catch (e: any) { message = e.message; } must(repo, ["checkout", "-q", "main"]); return "ok";
    };
    const before = sim.calls.length; const r = E3.start({ workflow: "ops-merge" }); await until(() => ["succeeded", "failed"].includes(r.status), 15000);
    ok(/only observed/.test(message) && !r.ctx.merged, "operations grant + observed policy: the merge hook refuses", message);
    ok(!sim.calls.slice(before).some((k: any) => k.method === "PUT") && !existsSync(join(dir, "remote-merge-attempts.json")), "the merge hook sends no PUT and records no merge attempt (the head is not locked)", dir);
    H3.stop();
  }
} catch (e: any) { ok(false, "unexpected error", e.stack); } finally { sim.stop(); }
end();
