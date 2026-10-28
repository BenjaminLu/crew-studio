import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// "Check again" on a remote-stop card only reads GitHub. A pull request behind its base, on a project with an operations
// grant, a real Task worktree and a bound review (everything the normal remote-ready path needs to update the branch on
// GitHub), stops on a card offering Update / Check again / Close: no update-branch PUT, no update round.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { Worktrees } from "../src/worktrees";
import { git, must, setGitHome } from "../src/git";
import { GitHubPrAdapter } from "../src/adapters/github";
import { githubSimulator } from "./lib/github-simulator";

const { ok, end } = suite("remote-stop-readonly");
const temp = checkedTempDir("remote-readonly-"), repo = join(temp, "repo"), bare = join(temp, "bare.git");
mkdirSync(repo); assertTempRepo(repo); setGitHome(join(temp, "git"));
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "base"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]);
const base = must(repo, ["rev-parse", "HEAD"]);
must(temp, ["clone", "--bare", "-q", repo, bare]);

const H = await harness([Y({ id: "readonly", name: "Read only", roles: [], nodes: [
  { id: "setup", kind: "hook", do: "fixture.setup", label: "Setup", x: 0, y: 0 }, { id: "remote-ready", kind: "hook", do: "remote.ready", label: "Remote readiness", x: 1, y: 0 },
  { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 2, y: 1 }],
  edges: [["setup", "remote-ready"], ["remote-ready", "done", "ok"], ["remote-ready", "closed", "close"]] })]);
const E = H.engine, W = new Worktrees(H.data), rec = W.ensure({ project: "fixture", task: "task", repo, base: "main", branchPrefix: "crew/", run: "fixture" });
const round = await W.startRound("fixture", "task", "fixture-build", { write: true, install: null });
writeFileSync(join(rec.path, "task"), "task");
const old = W.handBack("fixture", "task", { run: "fixture", node: "build", round: 1, agent: "fixture", message: "task" }).head;
round.release();
// main moves on GitHub: the Task's pull request is behind its base
writeFileSync(join(repo, "advance"), "advance"); must(repo, ["add", "advance"]); must(repo, ["commit", "-qm", "advance"]);
must(repo, ["push", "-q", bare, `${must(repo, ["rev-parse", "HEAD"])}:refs/heads/main`]);
const sim = githubSimulator(bare);
const adapter = new GitHubPrAdapter({ mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-15T00:00:00Z", approvalId: "fixture",
  operations: { version: 1, repository: "fixture/project", approvalId: "fixture-op", approvedAt: "2026-10-15T00:00:00Z", mergeMethod: "merge" } } as any, () => "fake-token", 2000);
mkdirSync(join(temp, "record"));
const pr = await adapter.open({ repo, base: "main", branch: rec.branch, head: old, title: "Fixture", body: "Fixture" }, join(temp, "record"));
// the normal path's write is ready to be accepted: only its absence proves Check again stayed read only
sim.expect("PUT", `/pulls/${pr.id}/update-branch`, { message: "Accepted" }, { expected_head_sha: old }, 202);
sim.expect("GET", "/branches/main/protection/required_status_checks", { strict: true, checks: [], contexts: [] });
sim.pulls.get(Number(pr.id)).mergeable = null; // remote-ready first stops: mergeability unknown
installCode(E, { dataDir: H.data, projects: new Projects(H.data), adapter, mergeabilityRetryMs: [20, 20] });
E.actions["fixture.setup"] = (x) => {
  Object.assign(x.ctx, { repo, worktree: rec.path, wt: { project: "fixture", task: "task" }, head: old, base: "main", baseCommit: base, branch: rec.branch, pr, spec: { scope: ["task"], done: ["task exists"] } });
  E.record(x, "fixture-review", { check: "firstmate/review-verdict", head: old, verdict: "pass", data: { binding: { version: 1, head: old, base, patch: git(repo, ["patch-id", "--stable"], git(repo, ["diff", "--binary", base, old]).out).out.split(" ")[0] } } } as any);
  return "ok";
};
const ids = (c: any) => (c?.options ?? []).map((o: any) => o.id).join();
const openCard = (r: any) => E.cards.list({ run: r.id, open: true })[0];
const writes = (from: number) => sim.calls.slice(from).filter((k: any) => k.method !== "GET");
try {
  const r = E.start({ workflow: "readonly" });
  await until(() => !!openCard(r) && !E.busy(r.id), 10000);
  const c = openCard(r);
  ok(c?.node === "remote-ready" && ids(c) === "check,close" && /was not proved/.test(c.body), "remote-ready stops on unknown mergeability with Check again", `${c?.node} ${ids(c)} ${c?.body}`);
  Object.assign(sim.pulls.get(Number(pr.id)), { mergeable: true, mergeable_state: "behind" });
  const before = sim.calls.length;
  await E.answer(c.id, { choice: "check", by: "captain" } as any);
  await until(() => (!!openCard(r) && openCard(r).id !== c.id && !E.busy(r.id)) || ["succeeded", "failed"].includes(r.status) || r.nodes["remote-ready"].waiting === "external", 15000);
  const b = openCard(r);
  ok(!writes(before).length && !E.trusted(r.id).entries.some((e: any) => e.record === "remote-update-request") && r.ctx.pr.head === old,
    "Check again on a pull request behind its base sends no update-branch PUT and starts no update round", JSON.stringify(writes(before)));
  ok(b?.node === "remote-ready" && ids(b) === "update,check,close" && b.title.en === "The pull request is behind its base branch: update it on GitHub, check again or close this task?",
    "it stops on a card that resolves it: update the branch (the captain's go-ahead), check again, or close", `${b?.title?.en} | ${ids(b)}`);
  E.cancel(r.id); await until(() => !E.busy(r.id), 8000);
} catch (e: any) { ok(false, "unexpected error", e.stack); } finally { H.stop(); sim.stop(); rmSync(temp, { recursive: true, force: true }); }
end();
